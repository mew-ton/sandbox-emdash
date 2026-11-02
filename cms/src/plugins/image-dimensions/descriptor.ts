/**
 * How this plugin is registered. See `webp-only/descriptor.ts` for why the
 * entrypoint has to live in a descriptor rather than in `definePlugin`.
 *
 * No admin surface: the rules come from each field's `options` in
 * seed/seed.json, and the only feedback is the refusal message on save.
 */

import { fileURLToPath } from "node:url";

export function imageDimensions() {
	return {
		id: "image-dimensions",
		version: "0.0.0",
		capabilities: ["content:write", "schema:read", "media:read"],
		entrypoint: fileURLToPath(new URL("./index.ts", import.meta.url)),
	};
}
