/**
 * How this plugin is registered. See `webp-only/descriptor.ts` for why the
 * entrypoint has to live in a descriptor rather than in `definePlugin`.
 *
 * No admin surface: what each field accepts is declared in seed/seed.json, and
 * the only feedback is the refusal message on save. EmDash's rich-text toolbar
 * is not configurable, so there is nothing to add to it.
 */

import { fileURLToPath } from "node:url";

export function portableTextPolicy() {
	return {
		id: "portable-text-policy",
		version: "0.0.0",
		capabilities: ["content:write", "schema:read"],
		entrypoint: fileURLToPath(new URL("./index.ts", import.meta.url)),
	};
}
