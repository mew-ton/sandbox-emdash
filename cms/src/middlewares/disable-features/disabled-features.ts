/**
 * What this deployment does with EmDash's features.
 *
 * Two decisions, kept apart because they are not the same decision:
 *
 * - `DISABLED_FEATURES` — not used at all. Writes are refused and the sidebar
 *   entry is hidden.
 * - `REHOMED_FEATURES` — still used, but reached through something of ours
 *   instead of EmDash's own screen. Only the sidebar entry is hidden; the API
 *   stays open, because our screen is what calls it.
 *
 * Both are picks from `emdash-features.ts`, which describes every feature and
 * how to address it. Nothing here says *how*: `index.ts` refuses the writes a
 * disabled feature's `api` covers and hides the entries either list's `nav`
 * selects.
 *
 * The lists were one list until a rehomed entry needed to be in it without
 * being refused — which worked only because that entry happened to declare no
 * `api`. Saying which decision applies beats inferring it from missing data.
 *
 * The route-by-route classification is in reports/05-security.md.
 */

import type { EmDashFeature } from "./emdash-features";

/** Features this deployment does not use: writes refused, sidebar entry hidden. */
export const DISABLED_FEATURES: readonly EmDashFeature[] = [
	// The public site is built from site/ and renders no comment form.
	"comments",
	// Public-site chrome: navigation, widget areas, reusable sections.
	"menus",
	"widgets",
	"sections",
	// The public site's host owns redirects, and the 404 log that feeds them.
	"redirects",
	// Classification uses `select` fields declared in the collection schema,
	// which keeps "add a new value" at `schema:manage` (Admin) rather than
	// `taxonomies:manage`, which every Editor holds — and every Discord member is
	// an Editor.
	"taxonomies",
	// Bylines are standalone display-name records (`_emdash_bylines`), not CMS
	// users and not the last editor. Nothing publishes an author name: a cast
	// member who leaves would otherwise stay credited on published posts.
	"bylines",
	// The migration source is MicroCMS, so the WordPress importer never applies.
	"import",
];

/**
 * Features reached through one of our own admin pages instead of EmDash's.
 *
 * Their APIs stay open — our pages call them. Only the sidebar entry goes, so
 * two routes to the same data do not sit next to each other. EmDash's own
 * screens stay reachable by URL: a plugin page can be pointed to, but a
 * built-in screen cannot be replaced or closed.
 */
export const REHOMED_FEATURES: readonly EmDashFeature[] = [
	// EmDash's social links are a fixed list of six services (twitter, github,
	// facebook, instagram, linkedin, youtube) enforced by a zod schema, so booth
	// has nowhere to go and "twitter" is the old name for X. Every external link
	// lives in the `metadata` collection's `links` repeater instead, where adding
	// a service needs no schema change. Not refused: these values share the
	// Settings API with the title, SEO and everything else.
	"socialSettings",
];
