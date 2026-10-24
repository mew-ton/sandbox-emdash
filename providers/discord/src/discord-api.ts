/**
 * Minimal Discord REST client: only the calls the provider needs.
 */

import type { DiscordConfig } from "./config.js";

export interface DiscordUser {
	id: string;
	username: string;
	global_name?: string | null;
	email?: string | null;
	verified?: boolean;
	avatar?: string | null;
}

export interface DiscordGuildMember {
	roles: string[];
	nick?: string | null;
}

export class DiscordApiError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
		this.name = "DiscordApiError";
	}
}

/** Discord answers 404 (Unknown Guild / Unknown Member) when the user is not in the guild. */
export const NOT_A_MEMBER = Symbol("not-a-member");

async function getJson<T>(url: string, authorization: string): Promise<T | typeof NOT_A_MEMBER> {
	const res = await fetch(url, { headers: { Authorization: authorization } });
	if (res.status === 404) return NOT_A_MEMBER;
	if (!res.ok) throw new DiscordApiError(res.status, `GET ${new URL(url).pathname} → ${res.status}`);
	return (await res.json()) as T;
}

export async function exchangeCode(
	config: DiscordConfig,
	code: string,
	redirectUri: string,
	codeVerifier: string,
): Promise<string> {
	const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
	if (config.pkce) body.set("code_verifier", codeVerifier);
	const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
	const res = await fetch(`${config.apiBase}/oauth2/token`, {
		method: "POST",
		headers: {
			Authorization: `Basic ${basic}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body,
	});
	if (!res.ok) throw new DiscordApiError(res.status, `token exchange → ${res.status}`);
	const json = (await res.json()) as { access_token?: string };
	if (!json.access_token) throw new DiscordApiError(500, "token exchange: no access_token");
	return json.access_token;
}

export async function fetchCurrentUser(config: DiscordConfig, accessToken: string): Promise<DiscordUser> {
	const user = await getJson<DiscordUser>(`${config.apiBase}/users/@me`, `Bearer ${accessToken}`);
	if (user === NOT_A_MEMBER) throw new DiscordApiError(404, "users/@me → 404");
	return user;
}

/** Guild membership of the signed-in user (scope `guilds.members.read`). */
export function fetchOwnMembership(config: DiscordConfig, accessToken: string) {
	return getJson<DiscordGuildMember>(
		`${config.apiBase}/users/@me/guilds/${config.guildId}/member`,
		`Bearer ${accessToken}`,
	);
}

/** Guild membership of any user, looked up with the bot token (used for live-session re-checks). */
export function fetchMembershipAsBot(config: DiscordConfig, discordUserId: string) {
	if (!config.botToken) throw new Error("DISCORD_BOT_TOKEN is not set");
	return getJson<DiscordGuildMember>(
		`${config.apiBase}/guilds/${config.guildId}/members/${discordUserId}`,
		`Bot ${config.botToken}`,
	);
}
