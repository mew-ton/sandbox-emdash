/**
 * Values the provider keeps in the Astro session next to EmDash's `user` key.
 */

export const OAUTH_STATE_KEY = "discord:oauth";
export const SESSION_KEY = "discord:session";

export interface PendingAuthorization {
	state: string;
	codeVerifier: string;
	redirectUri: string;
	expiresAt: number;
}

export interface DiscordSession {
	discordId: string;
	/** When the session was created through Discord (epoch ms). */
	issuedAt: number;
	/** Last time membership was confirmed (epoch ms). */
	verifiedAt: number;
}

export function randomToken(bytes = 32): string {
	return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}

export async function pkceChallenge(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return Buffer.from(digest).toString("base64url");
}
