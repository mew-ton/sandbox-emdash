/**
 * The features EmDash 1.3.1 exposes in the admin, and how to address each one.
 *
 * A description of EmDash, not a decision about it: every feature is listed
 * whether or not this deployment uses it. What to switch off is a separate
 * statement — see `disabled-features.ts`.
 *
 * Per feature:
 *
 * - `nav` selects its admin sidebar entry. Sidebar entries all have the same
 *   shape, so a feature usually just names its `href` and gets the selector
 *   built for it; `navSelector` lets a feature override that when its entry
 *   needs addressing differently. Keyed on `href` rather than on classes or
 *   child position because the URL is part of EmDash's routing contract, while
 *   the markup is Tailwind output that can change in any release.
 * - `api` lists the paths the feature is served on, each either a prefix or,
 *   for a route carrying ids that no prefix can match, a pattern. It is filled
 *   in as a feature needs it; a feature nothing acts on may list `href` alone.
 *
 * Content collections are absent: their sidebar entries are generated per
 * collection (`/_emdash/admin/content/<slug>`), so they are not a fixed set.
 *
 * Re-check this against the admin on every EmDash update (reports/00-summary.md,
 * D6). An `href` that changes silently stops matching.
 */

export interface EmDashFeatureDescriptor {
	/** Sidebar `href`s, exactly as EmDash renders them. */
	readonly href: readonly string[];
	/** CSS selecting the sidebar entries. Defaults to matching on `href`. */
	readonly nav?: string;
	/** Paths the feature's API is served on: a prefix, or a pattern for id-carrying routes. */
	readonly api?: readonly (string | RegExp)[];
}

/** Select a sidebar entry by the `href` of the link it contains. */
const byHref = (...hrefs: readonly string[]) =>
	hrefs.map((href) => `[data-sidebar="menu-item"]:has(> a[href="${href}"])`).join(",");

export const EMDASH_FEATURES = {
	dashboard: { href: ["/_emdash/admin/"] },
	calendar: { href: ["/_emdash/admin/calendar"] },
	media: { href: ["/_emdash/admin/media"] },
	comments: {
		href: ["/_emdash/admin/comments"],
		api: ["/_emdash/api/comments/", "/_emdash/api/admin/comments"],
	},
	menus: {
		href: ["/_emdash/admin/menus"],
		api: ["/_emdash/api/menus"],
	},
	redirects: {
		href: ["/_emdash/admin/redirects"],
		api: ["/_emdash/api/redirects"],
	},
	widgets: {
		href: ["/_emdash/admin/widgets"],
		api: ["/_emdash/api/widget-areas", "/_emdash/api/widget-components"],
	},
	sections: {
		href: ["/_emdash/admin/sections"],
		api: ["/_emdash/api/sections"],
	},
	taxonomies: {
		// Two sidebar entries, one per built-in taxonomy, on one API.
		href: ["/_emdash/admin/taxonomies/category", "/_emdash/admin/taxonomies/tag"],
		api: [
			"/_emdash/api/taxonomies",
			// `/_emdash/api/content/<collection>/<id>/terms/<taxonomy>` attaches a
			// term to an entry — the one taxonomy route that lives under `/content/`.
			/^\/_emdash\/api\/content\/[^/]+\/[^/]+\/terms\//,
		],
	},
	bylines: {
		// The byline list and the editor for the fields a byline carries; they sit
		// in different sidebar groups.
		href: ["/_emdash/admin/bylines", "/_emdash/admin/byline-schema"],
		api: ["/_emdash/api/admin/bylines", "/_emdash/api/admin/byline-fields"],
	},
	contentTypes: { href: ["/_emdash/admin/content-types"] },
	users: { href: ["/_emdash/admin/users"] },
	plugins: { href: ["/_emdash/admin/plugins-manager"] },
	import: {
		href: ["/_emdash/admin/import/wordpress"],
		api: ["/_emdash/api/import/"],
	},
	settings: { href: ["/_emdash/admin/settings"] },
	socialSettings: {
		// A page of its own under Settings, not a section of one, so its link
		// lives in the Settings navigation rather than the main sidebar and needs
		// its own selector. Both shapes are covered: the link itself, and the list
		// item around it when there is one, so nothing is left holding its padding.
		href: ["/_emdash/admin/settings/social"],
		nav:
			'a[href="/_emdash/admin/settings/social"],' +
			'li:has(> a[href="/_emdash/admin/settings/social"])',
		// No `api`: these values are written through `/_emdash/api/settings`, which
		// also carries the title, SEO and everything else. Refusing that path would
		// break Settings entirely, so this entry only hides the link.
	},
} as const satisfies Record<string, EmDashFeatureDescriptor>;

/** The name of a feature EmDash exposes in the admin. */
export type EmDashFeature = keyof typeof EMDASH_FEATURES;

/** CSS selecting a feature's sidebar entries. */
export function navSelector(feature: EmDashFeature): string {
	const descriptor: EmDashFeatureDescriptor = EMDASH_FEATURES[feature];
	return descriptor.nav ?? byHref(...descriptor.href);
}

/** Whether a request path is served by this feature's API. */
export function servesPath(feature: EmDashFeature, path: string): boolean {
	const descriptor: EmDashFeatureDescriptor = EMDASH_FEATURES[feature];
	return (descriptor.api ?? []).some((matcher) =>
		typeof matcher === "string" ? path === matcher || path.startsWith(matcher) : matcher.test(path),
	);
}
