/**
 * Server-side guards that make Discord the only sign-in path for community
 * members. Use as (part of) the project's `src/middleware.ts`; Astro runs it
 * after EmDash's own middleware, so `locals.user` is already resolved.
 *
 * 1. Setup gate        `/_emdash/api/setup/*` needs EMDASH_SETUP_TOKEN until setup is done.
 * 2. Login paths       passkey/magic-link/invite/signup/built-in OAuth/token issuance are
 *                      closed to non-operators. Magic link opens only in cold-standby mode.
 * 3. Live sessions     Discord sessions expire after DISCORD_SESSION_MAX_AGE_SECONDS and are
 *                      re-checked against the guild every DISCORD_REVALIDATE_SECONDS
 *                      when DISCORD_BOT_TOKEN is set (role changes apply immediately).
 * 4. Delete policy     the "member" tier may not DELETE anything.
 *
 * Environment:
 *   EMDASH_SETUP_TOKEN      secret for the setup wizard (send as `?setup_token=` once; kept in a cookie)
 *   EMDASH_COLD_STANDBY     "on" enables magic-link sign-in (Discord outage). Anything else: off
 *   EMDASH_ALLOW_INVITES    "on" opens invite acceptance (to onboard another operator)
 */

import { Role } from "@emdash-cms/auth";
import type { APIContext, MiddlewareNext } from "astro";
import { OptionsRepository } from "emdash/api/route-utils";

import { readDiscordConfig } from "./config.js";
import { fetchMembershipAsBot, NOT_A_MEMBER } from "./discord-api.js";
import { authAdapter, memberStore } from "./members.js";
import { resolveTier, TIER_ROLE } from "./roles.js";
import { SESSION_KEY, type DiscordSession } from "./session.js";

const SETUP_COOKIE = "sandbox_setup_token";

const flag = (name: string) => process.env[name]?.trim().toLowerCase() === "on";

/** Routes that are never available (built-in self-service sign-in and sign-up). */
const ALWAYS_CLOSED = [
	"/_emdash/api/auth/signup/",
	"/_emdash/api/auth/oauth/",
	"/_emdash/api/auth/dev-bypass",
	"/_emdash/api/setup/dev-bypass",
	"/_emdash/api/setup/dev-reset",
];

/** Routes only an operator (Admin) may use. */
const OPERATOR_ONLY = [
	"/_emdash/api/auth/passkey/register/",
	"/_emdash/api/auth/handover",
	"/_emdash/api/oauth/device/authorize",
	"/_emdash/oauth/authorize",
];

const MAGIC_LINK = "/_emdash/api/auth/magic-link/";
const INVITE_ACCEPT = [
	"/_emdash/api/auth/invite/accept",
	"/_emdash/api/auth/invite/complete",
	"/_emdash/api/auth/invite/register-options",
];
const PASSKEY_SIGN_IN = "/_emdash/api/auth/passkey/verify";

/** DELETE endpoints that release state rather than remove content. */
const DELETE_ALLOWED_FOR_MEMBERS = [/\/lock$/, /\/schedule$/];

const startsWithAny = (path: string, prefixes: string[]) => prefixes.some((p) => path.startsWith(p));

function deny(context: APIContext, status: 401 | 403, code: string, message: string): Response {
	if (context.url.pathname.startsWith("/_emdash/api/") || context.request.method !== "GET") {
		return Response.json({ error: { code, message } }, { status });
	}
	return context.redirect(`/_emdash/admin/login?error=${code}&message=${encodeURIComponent(message)}`);
}

async function endSession(context: APIContext, code: string, message: string) {
	context.session?.destroy();
	return deny(context, 401, code, message);
}

/** Accept `?setup_token=` on any admin URL and remember it in a cookie. */
function captureSetupToken(context: APIContext) {
	const expected = process.env.EMDASH_SETUP_TOKEN?.trim();
	const fromQuery = context.url.searchParams.get("setup_token");
	if (!expected || fromQuery !== expected) return;
	context.cookies.set(SETUP_COOKIE, fromQuery, {
		path: "/_emdash/",
		httpOnly: true,
		sameSite: "strict",
		secure: context.url.protocol === "https:",
	});
}

async function setupGate(context: APIContext, next: MiddlewareNext) {
	const db = context.locals.emdash?.db;
	const done = db ? await new OptionsRepository(db).get("emdash:setup_complete") : undefined;
	if (done === true || done === "true") return next();
	const expected = process.env.EMDASH_SETUP_TOKEN?.trim();
	const presented =
		context.url.searchParams.get("setup_token") ?? context.cookies.get(SETUP_COOKIE)?.value;
	if (expected && presented === expected) return next();
	return deny(context, 403, "SETUP_LOCKED", "Setup requires EMDASH_SETUP_TOKEN");
}

/** Re-check a Discord-issued session. Returns a Response to stop the request, or null to continue. */
async function checkDiscordSession(context: APIContext, user: { id: string; role: number }) {
	const config = readDiscordConfig();
	const session = context.session;
	const ds = (await session?.get(SESSION_KEY)) as DiscordSession | undefined;

	if (!ds) {
		// Not created by Discord: only cold-standby (magic link) sessions qualify,
		// and they lapse as soon as cold-standby is switched off.
		if (flag("EMDASH_COLD_STANDBY")) return null;
		return endSession(context, "session_revoked", "Please sign in with Discord");
	}
	if (!config) return endSession(context, "discord_not_configured", "Discord login is not configured");

	const now = Date.now();
	if (now - ds.issuedAt > config.sessionMaxAgeSeconds * 1000) {
		return endSession(context, "session_expired", "Session expired. Please sign in again.");
	}
	if (!config.botToken || now - ds.verifiedAt < config.revalidateSeconds * 1000) return null;

	let membership;
	try {
		membership = await fetchMembershipAsBot(config, ds.discordId);
	} catch (error) {
		// Discord unreachable: keep the session until its hard expiry.
		console.warn("[discord-guard] membership re-check failed:", error);
		return null;
	}
	const db = context.locals.emdash!.db;
	const tier = membership === NOT_A_MEMBER ? null : resolveTier(config, membership.roles);
	if (!tier) {
		await memberStore(db).delete(user.id);
		return endSession(context, "membership_revoked", "Your community membership could not be confirmed");
	}
	const role = TIER_ROLE[tier];
	if (role !== user.role) {
		await authAdapter(db).updateUser(user.id, { role });
		user.role = role;
	}
	await memberStore(db).put(user.id, {
		discordId: ds.discordId,
		tier,
		discordRoleIds: (membership as { roles: string[] }).roles,
		verifiedAt: new Date(now).toISOString(),
	});
	session!.set(SESSION_KEY, { ...ds, verifiedAt: now });
	return null;
}

export async function discordGuard(context: APIContext, next: MiddlewareNext): Promise<Response> {
	const path = context.url.pathname;
	if (!path.startsWith("/_emdash/")) return next();
	captureSetupToken(context);

	if (path.startsWith("/_emdash/api/setup/")) return setupGate(context, next);

	if (startsWithAny(path, ALWAYS_CLOSED)) {
		return deny(context, 403, "LOGIN_PATH_CLOSED", "This sign-in method is disabled");
	}
	if (path.startsWith(MAGIC_LINK) && !flag("EMDASH_COLD_STANDBY")) {
		return deny(context, 403, "LOGIN_PATH_CLOSED", "Email sign-in is disabled");
	}
	if (INVITE_ACCEPT.includes(path) && !flag("EMDASH_ALLOW_INVITES")) {
		return deny(context, 403, "LOGIN_PATH_CLOSED", "Invitations are disabled");
	}

	const user = context.locals.user as { id: string; role: number } | undefined | null;
	const isOperator = !!user && user.role >= Role.ADMIN;

	if (startsWithAny(path, OPERATOR_ONLY) && !isOperator) {
		return deny(context, 403, "OPERATOR_ONLY", "Only operators may use this endpoint");
	}

	if (path === PASSKEY_SIGN_IN) {
		const response = await next();
		const signedIn = (await context.session?.get("user")) as { id: string } | undefined;
		if (response.ok && signedIn) {
			const signedInUser = await authAdapter(context.locals.emdash!.db).getUserById(signedIn.id);
			if (!signedInUser || signedInUser.role < Role.ADMIN) {
				return endSession(context, "LOGIN_PATH_CLOSED", "Passkey sign-in is for operators only");
			}
		}
		return response;
	}

	// Session-authenticated community members (API tokens are operator-issued only).
	// `tokenScopes` is set by EmDash's auth middleware for bearer-token requests;
	// it is not part of the public Locals type.
	const viaToken = (context.locals as { tokenScopes?: string[] }).tokenScopes !== undefined;
	if (user && !isOperator && !viaToken) {
		const stop = await checkDiscordSession(context, user);
		if (stop) return stop;

		if (
			context.request.method === "DELETE" &&
			path.startsWith("/_emdash/api/") &&
			!DELETE_ALLOWED_FOR_MEMBERS.some((re) => re.test(path))
		) {
			const record = await memberStore(context.locals.emdash!.db).get(user.id);
			if (record?.tier !== "leader") {
				return deny(context, 403, "FORBIDDEN", "Members may not delete");
			}
		}
	}

	return next();
}
