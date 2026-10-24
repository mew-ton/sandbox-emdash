#!/usr/bin/env node
/**
 * Regenerate the CMS response types. Never edit src/generated/ by hand.
 *
 *   CMS_URL=http://localhost:4321 CMS_SCHEMA_TOKEN=<operator token with the admin scope> pnpm gen
 *
 * 1. OpenAPI document  → schema/openapi.json → src/generated/openapi.ts (openapi-typescript)
 * 2. Collection fields → src/generated/collections.ts (`emdash types`)
 *
 * The OpenAPI route has no scope rule of its own, so EmDash requires the
 * `admin` scope for it. Use a short-lived operator token and revoke it after.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.CMS_URL;
const token = process.env.CMS_SCHEMA_TOKEN;
if (!url || !token) {
	console.error("CMS_URL and CMS_SCHEMA_TOKEN are required");
	process.exit(1);
}

const res = await fetch(new URL("/_emdash/api/openapi.json", url), { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok) throw new Error(`openapi.json → ${res.status}`);
mkdirSync(join(root, "schema"), { recursive: true });
writeFileSync(join(root, "schema/openapi.json"), JSON.stringify(await res.json(), null, 2) + "\n");

const bin = (name) => join(root, "node_modules/.bin", name);
execFileSync(bin("openapi-typescript"), ["schema/openapi.json", "-o", "src/generated/openapi.ts"], { cwd: root, stdio: "inherit" });
execFileSync(bin("emdash"), ["types", "--url", url, "--token", token, "--output", "src/generated/collections.ts"], { cwd: root, stdio: "inherit" });
console.log("types regenerated");
