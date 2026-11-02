/**
 * Hide the unused sections of the entry editor's settings panel.
 *
 * Which sections, and why, is in `sections.ts`; this assembles the CSS and
 * injects it.
 *
 * Separate from `disable-features/` because the panel is its own axis: one of
 * its sections holds a field with no route of its own (the entry slug), and the
 * one that does belong to a disabled feature — bylines — is refused there
 * already. Nothing here refuses anything; the fields are still submitted and
 * still accepted.
 */

import { defineMiddleware } from "astro:middleware";

import { withAdminStyle } from "../admin-style";
import { HIDDEN_SECTIONS } from "./sections";

const PANEL = 'aside[data-sidebar="sidebar"]';

/** "A section that is none of the hidden ones", i.e. one that stays visible. */
const KEPT_SECTION = `section${HIDDEN_SECTIONS.map((s) => `:not(:has(${s.match}))`).join("")}`;

/**
 * Hide each unused section, then the panel itself once nothing else is left.
 *
 * The panel rule asks whether a *kept* section exists instead of listing the
 * sections that remain. CSS cannot see that an element computed to
 * `display: none`, but a hiding rule is itself a selector, so it can be
 * negated. The useful consequence: a section EmDash adds, or one never listed
 * in `sections.ts`, brings the panel back on its own rather than being
 * swallowed — which matters because `publish` carries scheduling and
 * `revisions` the history.
 */
const CSS =
	HIDDEN_SECTIONS.map((s) => `${PANEL} section:has(${s.match}){display:none}`).join("") +
	`${PANEL}:not(:has(${KEPT_SECTION})){display:none}`;

export const hideAsideContents = defineMiddleware(async (context, next) => {
	return withAdminStyle(context, await next(), "hide-aside-contents", CSS);
});
