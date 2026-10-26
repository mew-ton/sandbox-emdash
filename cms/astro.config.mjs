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
			// Security posture baked into the build, not left to deploy-time env
			// (so a VPS can't silently ship without it). reports/05-security.md.
			// Trust the reverse proxy's forwarded IP so the login rate limits
			// work by default (5-5). REQUIRES the Node port to be reachable only
			// through the proxy — bind to 127.0.0.1 / firewall it — or a client
			// could spoof this header to pollute rate-limit buckets.
			trustedProxyHeaders: ["x-forwarded-for"],
		}),
	],
	devToolbar: { enabled: false },
});
