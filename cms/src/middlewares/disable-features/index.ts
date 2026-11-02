/**
 * Apply this deployment's decisions about EmDash's features.
 *
 * Writes to a *disabled* feature's API are refused with 403 `FEATURE_DISABLED`,
 * for every caller including operators, so an unused subsystem cannot grow
 * state that nothing reads. 403 rather than 404 because the route exists and
 * the caller is authenticated: what an operator needs to be told is that the
 * feature is off, not that it is missing.
 *
 * Sidebar entries are hidden for disabled features and for *rehomed* ones
 * alike — in the first case so nobody is led to a screen that will refuse them,
 * in the second so two routes to the same data do not sit side by side. Only
 * the entries differ; nothing is refused for a rehomed feature.
 *
 * Reads are never refused, and EmDash's own screens stay reachable by URL.
 *
 * The decisions are in `disabled-features.ts`; how each feature is addressed is
 * in `emdash-features.ts`.
 */

import { defineMiddleware } from "astro:middleware";

import { withAdminStyle } from "../admin-style";
import { DISABLED_FEATURES, REHOMED_FEATURES } from "./disabled-features";
import { navSelector, servesPath } from "./emdash-features";

/** Methods that change state. A disabled feature refuses exactly these. */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Hide the heading of a sidebar group whose every entry is disabled.
 *
 * No feature owns this: the group is emptied by the whole set. It is matched
 * through a link the group contains rather than by its label, which is
 * localized. If EmDash later adds a live screen to that group, the heading
 * stays hidden and the new entry shows without one — ugly, and therefore
 * noticeable.
 */
const EMPTIED_GROUP_CSS =
	'[data-sidebar="group"]:has(> ul > li > a[href="/_emdash/admin/comments"])' +
	' > [data-sidebar="group-label"]{display:none}';

const NAV_CSS =
	[...DISABLED_FEATURES, ...REHOMED_FEATURES]
		.map((feature) => `${navSelector(feature)}{display:none}`)
		.join("") + EMPTIED_GROUP_CSS;

export const disableFeatures = defineMiddleware(async (context, next) => {
	// Checked before anything else: it applies to every caller, so it needs no
	// session read.
	if (WRITE_METHODS.has(context.request.method)) {
		const disabled = DISABLED_FEATURES.find((feature) =>
			servesPath(feature, context.url.pathname),
		);
		if (disabled) {
			return Response.json(
				{
					error: {
						code: "FEATURE_DISABLED",
						message: `The "${disabled}" feature is disabled for this deployment`,
					},
				},
				{ status: 403 },
			);
		}
	}

	return withAdminStyle(context, await next(), "disable-features", NAV_CSS);
});
