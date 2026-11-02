/**
 * Close the routes EmDash serves to anonymous visitors that a headless CMS does
 * not need.
 *
 * Refused with 404 so they are indistinguishable from routes that were never
 * injected. Only anonymous requests are refused: the admin UI itself uses some
 * of these — the image service, search, device-flow approval — with a session.
 *
 * The full classification is in reports/05-security.md and is re-checked by
 * verify/item5-security.mjs.
 */

import type { APIContext } from "astro";
import { defineMiddleware } from "astro:middleware";

/** Path prefixes refused to anonymous callers. */
export const CLOSED_TO_ANONYMOUS = [
	// MCP / CLI OAuth (operators use API tokens issued in the admin instead)
	"/.well-known/oauth-authorization-server",
	"/.well-known/oauth-protected-resource",
	"/_emdash/.well-known/",
	"/_emdash/api/oauth/",
	"/_emdash/oauth/",
	// Public-site features (the public site is built elsewhere)
	"/_emdash/api/comments/",
	"/_emdash/api/search",
	"/_emdash/api/visual-editing/",
	"/_emdash/api/snapshot",
	"/_emdash/api/site/domain-proof",
	"/sitemap",
	// Astro image service and server islands
	"/_image",
	"/_server-islands/",
];

async function isAnonymous(context: APIContext): Promise<boolean> {
	if (context.locals.user) return false;
	if (context.request.headers.has("authorization")) return false;
	// Routes outside /_emdash/ do not run EmDash's auth middleware.
	const sessionUser = await context.session?.get("user").catch(() => undefined);
	return !sessionUser;
}

export const publicSurface = defineMiddleware(async (context, next) => {
	const path = context.url.pathname;
	const closed = CLOSED_TO_ANONYMOUS.some((p) => path === p || path.startsWith(p));

	if (closed && (await isAnonymous(context))) {
		return new Response("Not found", { status: 404 });
	}

	return next();
});
