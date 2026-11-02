/**
 * Native plugin: keep everything but WebP off the disk, and give editors a way
 * to comply.
 *
 * The driver is storage. This runs on a personal server whose disk is the
 * binding constraint, and a 4K PNG screenshot is several times the size of the
 * same picture as WebP.
 *
 * Separate from `image-dimensions` on purpose: that one enforces the pixel size
 * each field was designed around, which is a decision about photography. This
 * one is about what the server can afford to store. Either could be dropped
 * without the other.
 *
 * `media:beforeUpload` is the only point that covers every route in. A field's
 * `allowedMimeTypes` governs what that field may hold, but an upload made from
 * the media library page has no field context and falls back to EmDash's
 * default allowlist — which accepts any image, video, audio or PDF, and is not
 * configurable. Roles cannot separate the two either: both paths are the same
 * endpoint and the same `media:upload` permission.
 *
 * Refusing costs nothing: the hook receives a file's name, type and size, never
 * its bytes, so nothing is decoded here. Converting on the server instead would
 * cost ~236 MiB of peak RSS for a 4K image, which this deployment cannot spare;
 * the conversion happens in the browser, on the page in `admin.tsx`.
 */

import { definePlugin } from "emdash";

const ALLOWED = "image/webp";

export function createPlugin() {
	return definePlugin({
		id: "webp-only",
		version: "0.0.0",
		// media:read — media hooks are skipped unless the plugin declares read
		// access, the same way content hooks need content:read.
		capabilities: ["media:read"],
		/**
		 * The sidebar entry for the converter page.
		 *
		 * Declared here, not only on the descriptor in astro.config.mjs: the
		 * descriptor's `adminPages` is read for `format: "standard"` and sandboxed
		 * plugins, whose metadata the integration serialises into the generated
		 * plugins module. A native plugin is only imported and called, so what the
		 * manifest knows comes from this object — and the sidebar is built from
		 * the manifest. Declaring it in only one of the two places leaves the page
		 * reachable by URL with no way to get to it, silently: a nav entry whose
		 * manifest or module half is missing is skipped without an error.
		 */
		admin: {
			pages: [{ path: "/convert", label: "Convert images", group: "Tools", icon: "image" }],
		},
		hooks: {
			/**
			 * The message names the way through. An editor who cannot convert a file
			 * themselves is otherwise simply stopped, which is why this plugin ships
			 * the converter page alongside the refusal.
			 */
			"media:beforeUpload": async (event) => {
				const { type, name } = event.file;
				if (type === ALLOWED) return;
				throw new Error(
					`"${name}" is ${type || "of an unknown type"}. Only WebP is stored, to keep the server's disk use down — convert it first on Tools → Convert images, which does it in your browser.`,
				);
			},
		},
	});
}

export default createPlugin;
