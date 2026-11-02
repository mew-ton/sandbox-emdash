/**
 * How this plugin is registered.
 *
 * Kept with the plugin rather than written out in `astro.config.mjs`, so
 * everything the plugin needs is in one folder and the config only names it.
 *
 * `entrypoint` and `adminEntry` cannot move into `definePlugin`: the
 * integration generates static imports from them for the server bundle and the
 * admin bundle, so they have to be module specifiers it can see before anything
 * runs. Everything else — capabilities, hooks, the sidebar page — is declared
 * in `index.ts`, because for a native plugin the manifest is built from what
 * `createPlugin()` returns, not from this descriptor.
 */

import { fileURLToPath } from "node:url";

export function webpOnly() {
	return {
		id: "webp-only",
		version: "0.0.0",
		capabilities: ["media:write"],
		entrypoint: fileURLToPath(new URL("./index.ts", import.meta.url)),
		adminEntry: fileURLToPath(new URL("./admin.tsx", import.meta.url)),
	};
}
