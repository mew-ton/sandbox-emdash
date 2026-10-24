import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";

// Item 3a: the public site needs the EmDash integration and the CMS database.
// CMS_DB_PATH points at the CMS SQLite file; CMS_UPLOADS_DIR at its uploads.
export default defineConfig({
	output: "static",
	// EmDash injects server routes (admin, API); a static build still needs an adapter.
	adapter: node({ mode: "standalone" }),
	integrations: [
		react(),
		emdash({
			database: sqlite({ url: `file:${process.env.CMS_DB_PATH}` }),
			storage: local({ directory: process.env.CMS_UPLOADS_DIR ?? "./uploads", baseUrl: "/_emdash/api/media/file" }),
			fonts: false,
			updateCheck: false,
		}),
	],
});
