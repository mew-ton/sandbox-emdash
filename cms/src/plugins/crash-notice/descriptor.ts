/**
 * Registration for astro.config.mjs.
 *
 * Everything else is in index.ts: the plugin has no hooks and no admin pages,
 * and its work is done when EmDash imports the entrypoint and calls
 * createPlugin().
 */

import { fileURLToPath } from "node:url";

export function crashNotice() {
	return {
		id: "crash-notice",
		version: "0.0.0",
		capabilities: [],
		entrypoint: fileURLToPath(new URL("./index.ts", import.meta.url)),
	};
}
