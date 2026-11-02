/**
 * Native plugin: hold image fields to an exact pixel size.
 *
 * Cast photos are shot to fixed frames ("face", "full body") so the subject's
 * position is consistent across the site. Cropping at build time cannot produce
 * that — it can only fit a frame around whatever was uploaded — so the
 * constraint has to hold where the entry is saved.
 *
 * EmDash has no declarative form for it: an `image` field validates only
 * `allowedMimeTypes`, the 17 field types cannot be extended, and
 * `media:beforeUpload` sees a file's name, type and size but not its
 * dimensions. It does have the two pieces this needs, and both are documented:
 * `content:beforeSave` may reject a save with a message meant for the editor,
 * and `media:read` returns a media record's dimensions.
 *
 * Which fields are constrained, and to what, is declared in the seed:
 *
 *   { "slug": "avatar", "type": "image",
 *     "options": { "width": 800, "height": 800 } }
 *
 * The plugin takes no configuration of its own. `options` is free-form per
 * field and reaches both ends of the enforcement — this hook through
 * `schema:read`, and the field's editor as a prop — so the seed stays the only
 * place the numbers are written.
 *
 * Nothing here touches the stored format; `webp-only` covers that, and the two
 * are independent — this is a decision about photography, that one about what
 * the server can afford to store.
 *
 * Note that a media record's dimensions are supplied by whoever uploaded it —
 * the admin measures the file, but a direct API caller states them. Treat this
 * as a guard against mistakes, not against a determined caller.
 */

import { ContentSaveRejectedError, definePlugin } from "emdash";

/** An exact size an image field must match, as declared in the seed. */
interface Size {
	readonly width: number;
	readonly height: number;
}

const isPositiveInt = (n: unknown): n is number =>
	typeof n === "number" && Number.isInteger(n) && n > 0;

/** The size a field requires, or null when the seed does not constrain it. */
function requiredSize(options: Record<string, unknown> | undefined): Size | null {
	if (!options) return null;
	const { width, height } = options;
	if (!isPositiveInt(width) || !isPositiveInt(height)) return null;
	return { width, height };
}

/** A media field value: `{ provider, id, … }`, or a bare id/URL string. */
function mediaIdOf(value: unknown): string | null {
	if (typeof value === "string") return value.trim() === "" ? null : value;
	if (value === null || typeof value !== "object") return null;
	const id = (value as { id?: unknown }).id;
	return typeof id === "string" && id !== "" ? id : null;
}

/** Whether a value came from a provider other than the local media library. */
function isExternal(value: unknown): boolean {
	if (typeof value === "string") return true;
	if (typeof value !== "object" || value === null) return false;
	const provider = (value as { provider?: unknown }).provider;
	return typeof provider === "string" && provider !== "local";
}

export function createPlugin() {
	return definePlugin({
		id: "image-dimensions",
		version: "0.0.0",
		// content:write — what content:beforeSave requires. Without it the host logs
		//   "declares ... without ... capability — skipping" and the hook never runs.
		//   content:read is the requirement for the after* hooks (build-trigger uses
		//   content:afterSave); declaring that here disabled every check below.
		// schema:read  — ctx.schema.getCollection() carries each field's `options`.
		// media:read   — ctx.media.get() returns the record's width and height.
		capabilities: ["content:write", "schema:read", "media:read"],
		hooks: {
			"content:beforeSave": async (event, ctx) => {
				// Both are absent unless the host granted the capability, and the list
				// above can lose an entry without this hook changing, so
				// the two can fall out of step. A rule that cannot be checked must not
				// report success, so this refuses rather than passing the save through.
				const { schema, media } = ctx;
				if (!schema || !media) {
					throw new ContentSaveRejectedError(
						"Image sizes cannot be checked: the image-dimensions plugin is missing the schema:read or media:read capability.",
					);
				}

				const collection = await schema.getCollection(event.collection);
				if (!collection) return;

				for (const field of collection.fields) {
					if (field.type !== "image") continue;
					const size = requiredSize(field.options);
					if (!size) continue;

					// On an update `content` carries only the submitted fields, so a
					// field that is absent was not touched and must not be re-checked:
					// doing so would block edits to other fields of an entry whose
					// picture predates this rule.
					if (!(field.slug in event.content)) continue;

					const value = event.content[field.slug];
					// Clearing the field is allowed; `required` in the schema is what
					// decides whether it may be empty.
					if (value == null || value === "") continue;

					// An external provider's record is not in EmDash's media library, so
					// there is nothing to measure. Refuse rather than wave it through:
					// skipping silently would make the rule look enforced while leaving
					// a way around it.
					if (isExternal(value)) {
						throw new ContentSaveRejectedError(
							`"${field.label}" must come from the media library, because its size has to be ${size.width}x${size.height}px and an external image cannot be measured.`,
						);
					}

					const id = mediaIdOf(value);
					if (id === null) {
						throw new ContentSaveRejectedError(
							`"${field.label}" has an image this plugin cannot identify, so its size could not be checked. Re-pick it from the media library.`,
						);
					}

					const item = await media.get(id);
					if (!item) {
						throw new ContentSaveRejectedError(
							`"${field.label}" points at an image that is no longer in the media library. Re-pick it.`,
						);
					}

					// Dimensions are optional on the record: absent for a non-image, and
					// for anything still processing. Either way the size is unknown, and
					// unknown is not a pass.
					if (item.width == null || item.height == null) {
						throw new ContentSaveRejectedError(
							`"${field.label}" has no recorded dimensions, so it cannot be checked against the required ${size.width}x${size.height}px. It may not be an image, or it may still be processing.`,
						);
					}

					if (item.width !== size.width || item.height !== size.height) {
						throw new ContentSaveRejectedError(
							`"${field.label}" must be exactly ${size.width}x${size.height}px. "${item.filename}" is ${item.width}x${item.height}px.`,
						);
					}
				}
			},
		},
	});
}

export default createPlugin;
