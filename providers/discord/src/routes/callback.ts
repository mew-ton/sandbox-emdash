/**
 * GET /_emdash/api/auth/discord/callback
 *
 * Exchanges the code, confirms guild membership, maps Discord roles to an
 * EmDash role (overwriting the stored one), and opens a session.
 */

import type { APIRoute } from "astro";
import { OptionsRepository } from "emdash/api/route-utils";

import { readDiscordConfig } from "../config.js";
import {
	exchangeCode,
	fetchCurrentUser,
	fetchOwnMembership,
	NOT_A_MEMBER,
} from "../discord-api.js";
import { LoginRefused, memberStore, upsertDiscordUser } from "../members.js";
import { resolveTier, TIER_ROLE } from "../roles.js";
import {
	OAUTH_STATE_KEY,
	SESSION_KEY,
	type DiscordSession,
	type PendingAuthorization,
} from "../session.js";

export const prerender = false;

function fail(redirect: (path: string) => Response, code: string, message: string) {
	return redirect(`/_emdash/admin/login?error=${code}&message=${encodeURIComponent(message)}`);
}

export const GET: APIRoute = async ({ request, locals, session, redirect }) => {
	const config = readDiscordConfig();
	const db = locals.emdash?.db;
	if (!config || !session || !db) {
		return fail(redirect, "discord_not_configured", "Discord login is not configured");
	}

	const url = new URL(request.url);
	const pending = (await session.get(OAUTH_STATE_KEY)) as PendingAuthorization | undefined;
	session.delete(OAUTH_STATE_KEY);

	if (url.searchParams.get("error")) {
		return fail(redirect, "discord_denied", "Discord authorization was cancelled");
	}
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	if (!pending || !code || !state || state !== pending.state || pending.expiresAt < Date.now()) {
		return fail(redirect, "invalid_state", "Login session expired. Please try again.");
	}

	// The first account must be an operator created through the setup wizard
	// with a passkey; Discord never creates the initial Admin.
	const setupComplete = await new OptionsRepository(db).get("emdash:setup_complete");
	if (setupComplete !== true && setupComplete !== "true") {
		return fail(redirect, "setup_incomplete", "This site has not been set up yet");
	}

	try {
		const accessToken = await exchangeCode(config, code, pending.redirectUri, pending.codeVerifier);
		const discordUser = await fetchCurrentUser(config, accessToken);
		const membership = await fetchOwnMembership(config, accessToken);

		if (membership === NOT_A_MEMBER) {
			return fail(redirect, "not_a_member", "You are not a member of the community server");
		}
		const tier = resolveTier(config, membership.roles);
		if (!tier) {
			return fail(redirect, "no_role", "Your Discord roles do not grant access");
		}
		if (!discordUser.email || discordUser.verified !== true) {
			return fail(redirect, "email_unverified", "A verified email is required on your Discord account");
		}

		const user = await upsertDiscordUser(
			db,
			{
				discordId: discordUser.id,
				email: discordUser.email.toLowerCase(),
				name: membership.nick || discordUser.global_name || discordUser.username,
				avatarUrl: null,
			},
			TIER_ROLE[tier],
		);

		const now = Date.now();
		await memberStore(db).put(user.id, {
			discordId: discordUser.id,
			tier,
			discordRoleIds: membership.roles,
			verifiedAt: new Date(now).toISOString(),
		});

		session.regenerate();
		session.set("user", { id: user.id });
		const discordSession: DiscordSession = { discordId: discordUser.id, issuedAt: now, verifiedAt: now };
		session.set(SESSION_KEY, discordSession);
		return redirect("/_emdash/admin");
	} catch (error) {
		if (error instanceof LoginRefused) return fail(redirect, error.code, error.message);
		console.error("[discord-auth] callback failed:", error);
		return fail(redirect, "discord_error", "Discord login failed. Please try again.");
	}
};
