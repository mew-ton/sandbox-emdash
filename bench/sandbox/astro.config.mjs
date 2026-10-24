// Scenario 4-7 only: cms/astro.config.mjs plus the workerd plugin sandbox and
// one sandboxed plugin. bench/prepare.sh copies this over the cms config in a
// staging copy; the cms/ app itself never loads the sandbox.
import { fileURLToPath } from "node:url";

import node from "@astrojs/node";
import react from "@astrojs/react";
import { discord } from "@sandbox/emdash-auth-discord";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";

export default defineConfig({
	output: "server",
	adapter: node({ mode: "standalone" }),
	integrations: [
		react(),
		emdash({
			database: sqlite({ url: "file:./data.db" }),
			storage: local({ directory: "./uploads", baseUrl: "/_emdash/api/media/file" }),
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
			sandboxRunner: "@emdash-cms/sandbox-workerd",
			sandboxed: [
				{
					id: "bench-hello",
					version: "0.0.0",
					format: "standard",
					capabilities: ["content:read"],
					hooks: ["content:afterSave"],
					entrypoint: fileURLToPath(new URL("./sandbox/hello-plugin/sandbox-entry.mjs", import.meta.url)),
				},
			],
			registry: false,
			updateCheck: false,
			fonts: false,
		}),
	],
	devToolbar: { enabled: false },
});
