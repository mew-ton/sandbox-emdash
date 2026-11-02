/**
 * Add a stylesheet to the admin shell's `<head>`.
 *
 * The admin UI is a prebuilt React SPA (`@emdash-cms/admin`) and its `admin`
 * config option covers branding only (logo, siteName, footerLabel, favicon,
 * locales) — there is no way to drop a screen or a field, and no hook for extra
 * CSS. Injecting it into the response is the remaining way in, so the
 * middlewares that hide parts of the admin share this one copy of the rewrite.
 *
 * Anything hidden this way is hidden cosmetically: the page or field stays
 * reachable and its reads still work. A middleware that needs a change to
 * actually be refused has to refuse it itself.
 */

import type { APIContext } from "astro";

/**
 * Return `response` with `<style>` added, or unchanged when it is not an admin
 * shell document.
 *
 * `id` goes on the tag as `data-sandbox`, so each injected sheet is identifiable
 * when inspecting the page.
 */
export async function withAdminStyle(
	context: APIContext,
	response: Response,
	id: string,
	css: string,
): Promise<Response> {
	// Only the admin shell: every other route (API, public) is left untouched.
	if (!context.url.pathname.startsWith("/_emdash/admin")) return response;
	if (context.request.method !== "GET") return response;
	if (!response.headers.get("content-type")?.includes("text/html")) return response;

	// The shell is a thin SPA host, so buffering it is cheap. `</head>` is
	// emitted by Astro's document skeleton; if it is ever absent, pass the
	// response through rather than guess at another insertion point.
	const html = await response.text();
	const headEnd = html.indexOf("</head>");
	if (headEnd === -1) return new Response(html, response);

	const headers = new Headers(response.headers);
	// Buffering changed the length; a stale value would truncate the document.
	headers.delete("content-length");

	const style = `<style data-sandbox="${id}">${css}</style>`;
	return new Response(html.slice(0, headEnd) + style + html.slice(headEnd), {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
