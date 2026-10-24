/**
 * Discord login provider for EmDash.
 *
 * The descriptor is serialized at build time, so it holds no secrets and no
 * server-specific IDs. Client credentials, the guild ID and the role mapping
 * are read from environment variables at request time (see `config.ts`).
 */

import type { AuthProviderDescriptor } from "emdash";

export const DISCORD_PROVIDER_ID = "discord";

/** Storage collections under the `auth:discord` namespace of `_plugin_storage`. */
export const DISCORD_STORAGE = {
	/** One record per EmDash user that signed in through Discord (key: EmDash user id). */
	members: { indexes: ["discordId"] },
};

export function discord(): AuthProviderDescriptor {
	return {
		id: DISCORD_PROVIDER_ID,
		label: "Discord",
		adminEntry: "@sandbox/emdash-auth-discord/admin",
		routes: [
			{
				pattern: "/_emdash/api/auth/discord/login",
				entrypoint: "@sandbox/emdash-auth-discord/routes/login.ts",
			},
			{
				pattern: "/_emdash/api/auth/discord/callback",
				entrypoint: "@sandbox/emdash-auth-discord/routes/callback.ts",
			},
		],
		publicRoutes: ["/_emdash/api/auth/discord/"],
		storage: DISCORD_STORAGE,
	};
}
