/**
 * Close routes EmDash serves to anonymous visitors that a headless CMS does
 * not need (public site features, MCP / CLI OAuth discovery, image service).
 *
 * Only anonymous requests are refused: the admin UI itself uses some of these
 * routes (image service, search, device-flow approval) with a session.
 * The full classification of anonymous routes is in reports/05-security.md and
 * is re-checked by verify/item5-security.mjs.
 */

import type { APIContext, MiddlewareNext } from "astro";

/** Path prefixes refused to anonymous callers with 404. */
export const CLOSED_TO_ANONYMOUS = [
	// MCP / CLI OAuth (operators use API tokens issued in the admin instead)
	"/.well-known/oauth-authorization-server",
	"/.well-known/oauth-protected-resource",
	"/_emdash/.well-known/",
	"/_emdash/api/oauth/",
	"/_emdash/oauth/",
	// Public-site features (the public site is built elsewhere)
	"/_emdash/api/search",
	"/_emdash/api/comments/",
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

export async function publicSurface(context: APIContext, next: MiddlewareNext): Promise<Response> {
	const path = context.url.pathname;
	if (CLOSED_TO_ANONYMOUS.some((p) => path === p || path.startsWith(p)) && (await isAnonymous(context))) {
		return new Response("Not found", { status: 404 });
	}
	return next();
}
