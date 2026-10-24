/**
 * User provisioning and the per-user Discord membership record.
 *
 * Accounts are linked only by Discord user ID (`oauth_accounts`). Unlike the
 * built-in OAuth providers, an existing EmDash user is never auto-linked by
 * email: a Discord account carrying an operator's email address must not be
 * able to sign in as that operator.
 */

import type { RoleLevel, User } from "@emdash-cms/auth";
import { Role } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import { getAuthProviderStorage } from "emdash/api/route-utils";

import { DISCORD_PROVIDER_ID, DISCORD_STORAGE } from "./index.js";
import type { Tier } from "./roles.js";

export interface MemberRecord {
	discordId: string;
	tier: Tier;
	discordRoleIds: string[];
	verifiedAt: string;
}

// The EmDash Database type and the auth adapter's AuthTables differ only in
// Kysely's Generated<> wrappers; the built-in routes pass the same handle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Auth adapter over EmDash's database handle (same cast the built-in routes rely on). */
export function authAdapter(db: Db) {
	return createKyselyAdapter(db);
}

export function memberStore(db: Db) {
	return getAuthProviderStorage(db, DISCORD_PROVIDER_ID, DISCORD_STORAGE).members as unknown as {
		get(id: string): Promise<MemberRecord | null>;
		put(id: string, data: MemberRecord): Promise<void>;
		delete(id: string): Promise<boolean>;
	};
}

export class LoginRefused extends Error {
	constructor(
		public code: string,
		message: string,
	) {
		super(message);
		this.name = "LoginRefused";
	}
}

export interface DiscordProfile {
	discordId: string;
	email: string;
	name: string;
	avatarUrl: string | null;
}

/**
 * Find the EmDash user linked to this Discord account, creating it on first
 * login, and overwrite its role with the one derived from Discord.
 */
export async function upsertDiscordUser(db: Db, profile: DiscordProfile, role: RoleLevel): Promise<User> {
	const adapter = authAdapter(db);
	const linked = await adapter.getOAuthAccount(DISCORD_PROVIDER_ID, profile.discordId);

	if (linked) {
		const user = await adapter.getUserById(linked.userId);
		if (!user) throw new LoginRefused("user_not_found", "Linked user no longer exists");
		if (user.role >= Role.ADMIN) {
			throw new LoginRefused("admin_via_discord", "Operators sign in with a passkey");
		}
		if (user.disabled) throw new LoginRefused("account_disabled", "Account disabled");
		const changes: Record<string, unknown> = {};
		if (user.role !== role) changes.role = role;
		if (user.name !== profile.name) changes.name = profile.name;
		if (user.email !== profile.email && !(await adapter.getUserByEmail(profile.email))) {
			changes.email = profile.email;
		}
		if (Object.keys(changes).length > 0) await adapter.updateUser(user.id, changes);
		return { ...user, ...changes } as User;
	}

	if (await adapter.getUserByEmail(profile.email)) {
		throw new LoginRefused(
			"email_in_use",
			"An account with this email already exists and is not linked to Discord",
		);
	}

	const user = await adapter.createUser({
		email: profile.email,
		name: profile.name,
		avatarUrl: profile.avatarUrl,
		role,
		emailVerified: true,
	});
	await adapter.createOAuthAccount({
		provider: DISCORD_PROVIDER_ID,
		providerAccountId: profile.discordId,
		userId: user.id,
	});
	return user;
}
