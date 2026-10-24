/**
 * Discord role → EmDash role mapping.
 *
 * EmDash has no built-in role that may edit everyone's content but may not
 * delete it: `content:edit_any` and `content:delete_any` both start at Editor.
 * Both tiers therefore map to Editor, and the guard middleware refuses delete
 * operations for the "member" tier (see `guard.ts`).
 *
 * Discord never grants Admin. Operators sign in with a passkey instead.
 */

import { Role, type RoleLevel } from "@emdash-cms/auth";

import type { DiscordConfig } from "./config.js";

export type Tier = "leader" | "member";

export const TIER_ROLE: Record<Tier, RoleLevel> = {
	leader: Role.EDITOR,
	member: Role.EDITOR,
};

/** Highest tier granted by the member's Discord roles, or null when none applies. */
export function resolveTier(config: DiscordConfig, discordRoleIds: string[]): Tier | null {
	if (discordRoleIds.some((id) => config.leaderRoleIds.includes(id))) return "leader";
	if (discordRoleIds.some((id) => config.memberRoleIds.includes(id))) return "member";
	return null;
}
