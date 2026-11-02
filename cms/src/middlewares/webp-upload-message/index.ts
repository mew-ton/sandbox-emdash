/**
 * Tell someone uploading a non-WebP file why it was refused.
 *
 * The `webp-only` plugin already stops these uploads, but EmDash turns a
 * `media:beforeUpload` throw into `500 UPLOAD_ERROR "Upload failed"` and drops
 * the message (reports/findings.md F-26). An editor who cannot convert a file
 * themselves is then stopped with nothing to act on, and the converter page
 * this CMS ships for them goes unmentioned — which is what requirement 6-3
 * asks for.
 *
 * So the same rule is applied here, before the route, where a refusal can carry
 * a status and a message. The rule itself lives in the plugin
 * (plugins/webp-only/rule.ts); this file decides nothing about what is allowed.
 *
 * Uploads from a field in the entry editor are already refused by EmDash with
 * `400 INVALID_TYPE`, because the form carries a fieldId and the seed declares
 * casts.avatar.validation.allowedMimeTypes. This covers the media page, which
 * sends no fieldId and therefore falls back to EmDash's hardcoded global
 * allowlist — a list that includes PNG and that no setting can change.
 */

import { defineMiddleware } from "astro:middleware";

import { refusal } from "../../plugins/webp-only/rule.ts";

/** The multipart route the media page and the entry editor both post to. */
const UPLOAD = "/_emdash/api/media";
/** The route that hands out a URL to upload to directly, used for large files. */
const UPLOAD_URL = "/_emdash/api/media/upload-url";

function refuse(why: string): Response {
	return new Response(JSON.stringify({ success: false, error: { code: "INVALID_TYPE", message: why } }), {
		status: 400,
		headers: { "content-type": "application/json", "cache-control": "no-store" },
	});
}

export const webpUploadMessage = defineMiddleware(async (context, next) => {
	const { request } = context;
	if (request.method !== "POST") return next();
	const path = context.url.pathname;

	if (path === UPLOAD_URL) {
		// JSON, so the name and type are readable without touching the bytes.
		let body: { filename?: unknown; contentType?: unknown };
		try {
			body = await request.clone().json();
		} catch {
			return next();
		}
		if (typeof body.filename !== "string") return next();
		const why = refusal(body.filename, typeof body.contentType === "string" ? body.contentType : null);
		return why ? refuse(why) : next();
	}

	if (path === UPLOAD || path === `${UPLOAD}/`) {
		// The body has to be read to see the file, and reading it here would leave
		// the route with an empty stream, so this reads a clone. Both copies are
		// buffered for the length of the check; EmDash buffers the whole file
		// anyway (`await file.arrayBuffer()`), so the shape of the cost is the
		// same, not a new one.
		let form: FormData;
		try {
			form = await request.clone().formData();
		} catch {
			return next();
		}
		const file = form.get("file");
		if (!(file instanceof File)) return next();
		const why = refusal(file.name, file.type);
		return why ? refuse(why) : next();
	}

	return next();
});
