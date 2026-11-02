/**
 * What may be stored, and what to tell someone who tried something else.
 *
 * The rule lives here because two things enforce it and neither owns it:
 *
 *   - the `media:beforeUpload` hook in ./index.ts, which covers every upload
 *     path including the ones that are not HTTP requests;
 *   - `middlewares/webp-upload-message/`, which covers the two HTTP routes so
 *     the person uploading is told why it was refused.
 *
 * The second exists only because EmDash discards the hook's message: a throw
 * from media:beforeUpload aborts the upload (errorPolicy defaults to "abort")
 * but surfaces as `500 UPLOAD_ERROR "Upload failed"`. Content has
 * ContentSaveRejectedError for exactly this; media has no equivalent. See
 * reports/findings.md F-26.
 */

export const ALLOWED_MIME = "image/webp";
export const ALLOWED_EXTENSION = ".webp";

/**
 * Why this file was refused, or null when it may be stored.
 *
 * The extension is checked as well as the declared type because EmDash falls
 * back to the filename when a browser sends an empty or generic type
 * (`resolveUploadMimeType`), so a `.png` with no stated type would otherwise
 * reach the allowlist as a PNG from one place and as nothing from here.
 */
export function refusal(name: string, type: string | null | undefined): string | null {
	const looksWebP = (type ?? "").toLowerCase() === ALLOWED_MIME;
	const namedWebP = name.toLowerCase().endsWith(ALLOWED_EXTENSION);
	if (looksWebP && namedWebP) return null;

	const described = type ? `is ${type}` : "has no stated type";
	return (
		`"${name}" ${described}. Only WebP is stored on this server, because disk space is ` +
		`the limit — convert the file first on Tools → Convert images, then upload the .webp it gives you.`
	);
}
