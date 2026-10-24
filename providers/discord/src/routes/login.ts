/**
 * GET /_emdash/api/auth/discord/login
 *
 * Starts the Authorization Code + PKCE flow and redirects to Discord.
 */

import type { APIRoute } from "astro";
import { getPublicOrigin } from "emdash/api/route-utils";

import { readDiscordConfig } from "../config.js";
import { OAUTH_STATE_KEY, pkceChallenge, randomToken, type PendingAuthorization } from "../session.js";

export const prerender = false;

/** identify + email + guilds.members.read: user ID, email for cold-standby, and own roles in the guild. */
const SCOPES = ["identify", "email", "guilds.members.read"];
const STATE_TTL_MS = 10 * 60 * 1000;

export const GET: APIRoute = async ({ request, locals, session, redirect }) => {
	const config = readDiscordConfig();
	if (!config || !session) {
		return redirect(
			`/_emdash/admin/login?error=discord_not_configured&message=${encodeURIComponent("Discord login is not configured")}`,
		);
	}

	const origin = getPublicOrigin(new URL(request.url), locals.emdash?.config);
	const pending: PendingAuthorization = {
		state: randomToken(),
		codeVerifier: randomToken(48),
		redirectUri: `${origin}/_emdash/api/auth/discord/callback`,
		expiresAt: Date.now() + STATE_TTL_MS,
	};
	session.set(OAUTH_STATE_KEY, pending);

	const url = new URL(config.authorizeUrl);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", config.clientId);
	url.searchParams.set("scope", SCOPES.join(" "));
	url.searchParams.set("redirect_uri", pending.redirectUri);
	url.searchParams.set("state", pending.state);
	if (config.pkce) {
		url.searchParams.set("code_challenge", await pkceChallenge(pending.codeVerifier));
		url.searchParams.set("code_challenge_method", "S256");
	}
	return redirect(url.toString());
};
