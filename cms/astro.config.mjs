import { fileURLToPath } from "node:url";

import node from "@astrojs/node";
import react from "@astrojs/react";
import { discord } from "@sandbox/emdash-auth-discord";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";

import { imageDimensions } from "./src/plugins/image-dimensions/descriptor.ts";
import { portableTextPolicy } from "./src/plugins/portable-text-policy/descriptor.ts";
import { webpOnly } from "./src/plugins/webp-only/descriptor.ts";

// Paths are resolved at runtime relative to the working directory, so the same
// build runs from `cms/` locally and from `/app` in the benchmark container.
export default defineConfig({
	output: "server",
	server: { host: true, allowedHosts: ["mewton.local"] },
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
				// Exact pixel sizes for image fields, which EmDash cannot express
				// declaratively. reports/01-headless.md.
				imageDimensions(),
				// Only WebP reaches the disk, because storage is the binding constraint
				// on this server, plus the page that converts for editors in their
				// browser. Apart from image-dimensions: that one is a decision about
				// photography, this one about capacity. reports/04-memory.md.
				webpOnly(),
				// Rich text limited to what each field declares in seed/seed.json.
				// EmDash's editor toolbar is hardcoded — it offers code blocks, raw
				// HTML, iframes and tables to every Editor — so this refuses on save
				// rather than hiding controls. reports/01-headless.md.
				portableTextPolicy(),
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
