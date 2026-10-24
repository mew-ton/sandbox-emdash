/**
 * Runtime configuration, read from environment variables on every call so the
 * built server never embeds secrets.
 *
 * DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET   OAuth2 application credentials
 * DISCORD_GUILD_ID                            Server whose membership is required
 * DISCORD_LEADER_ROLE_IDS                     Comma-separated Discord role IDs → tier "leader"
 * DISCORD_MEMBER_ROLE_IDS                     Comma-separated Discord role IDs → tier "member"
 * DISCORD_BOT_TOKEN                           Optional. Enables membership re-checks on live sessions
 * DISCORD_REVALIDATE_SECONDS                  Re-check interval for live sessions (default 600)
 * DISCORD_SESSION_MAX_AGE_SECONDS             Hard limit for a Discord session (default 43200)
 * DISCORD_API_BASE / DISCORD_AUTHORIZE_URL    Overrides for the local mock (default: discord.com)
 * DISCORD_PKCE                                "off" drops PKCE (code_challenge / code_verifier). Default on
 */

export interface DiscordConfig {
	clientId: string;
	clientSecret: string;
	guildId: string;
	leaderRoleIds: string[];
	memberRoleIds: string[];
	botToken: string | undefined;
	revalidateSeconds: number;
	sessionMaxAgeSeconds: number;
	apiBase: string;
	authorizeUrl: string;
	pkce: boolean;
}

function env(name: string): string | undefined {
	const value = process.env[name];
	return value && value.trim() !== "" ? value.trim() : undefined;
}

function list(name: string): string[] {
	return (env(name) ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

function seconds(name: string, fallback: number): number {
	const raw = env(name);
	if (raw === undefined) return fallback;
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function readDiscordConfig(): DiscordConfig | null {
	const clientId = env("DISCORD_CLIENT_ID");
	const clientSecret = env("DISCORD_CLIENT_SECRET");
	const guildId = env("DISCORD_GUILD_ID");
	if (!clientId || !clientSecret || !guildId) return null;
	return {
		clientId,
		clientSecret,
		guildId,
		leaderRoleIds: list("DISCORD_LEADER_ROLE_IDS"),
		memberRoleIds: list("DISCORD_MEMBER_ROLE_IDS"),
		botToken: env("DISCORD_BOT_TOKEN"),
		revalidateSeconds: seconds("DISCORD_REVALIDATE_SECONDS", 600),
		sessionMaxAgeSeconds: seconds("DISCORD_SESSION_MAX_AGE_SECONDS", 12 * 60 * 60),
		apiBase: (env("DISCORD_API_BASE") ?? "https://discord.com/api/v10").replace(/\/$/, ""),
		authorizeUrl: env("DISCORD_AUTHORIZE_URL") ?? "https://discord.com/oauth2/authorize",
		pkce: env("DISCORD_PKCE")?.toLowerCase() !== "off",
	};
}
