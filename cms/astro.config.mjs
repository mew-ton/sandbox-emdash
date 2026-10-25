import { fileURLToPath } from "node:url";

import node from "@astrojs/node";
import react from "@astrojs/react";
import { discord } from "@sandbox/emdash-auth-discord";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";

// Paths are resolved at runtime relative to the working directory, so the same
// build runs from `cms/` locally and from `/app` in the benchmark container.
export default defineConfig({
	output: "server",
	adapter: node({ mode: "standalone" }),
	integrations: [
		react(),
		emdash({
			database: sqlite({ url: "file:./data.db" }),
			storage: local({
				directory: "./uploads",
				baseUrl: "/_emdash/api/media/file",
			}),
			authProviders: [discord()],
			plugins: [
				{
					id: "build-trigger",
					version: "0.0.0",
					capabilities: ["content:read"],
					entrypoint: fileURLToPath(new URL("./src/plugins/build-trigger.ts", import.meta.url)),
				},
				{
					id: "email-outbox",
					version: "0.0.0",
					capabilities: ["hooks.email-transport:register"],
					entrypoint: fileURLToPath(new URL("./src/plugins/email-outbox.ts", import.meta.url)),
				},
			],
			updateCheck: false,
			// Admin UI uses system fonts: no Google Fonts fetch at build time or in the browser.
			fonts: false,
			// No MCP endpoint: agents and the CLI use API tokens issued in the admin.
			mcp: false,
		}),
	],
	devToolbar: { enabled: false },
});
