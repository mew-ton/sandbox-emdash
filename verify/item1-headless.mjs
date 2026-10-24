/**
 * Item 1: headless use of EmDash (admin + read API only).
 *
 *   node verify/item1-headless.mjs [--out reports/generated/01-headless.md]
 *
 * Starts mock Discord, a fresh cms/ instance, a mock CI dispatch receiver and,
 * for 1-7, a second empty instance. Prints PASS/FAIL per check.
 */

import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client, discordLogin, Results, ROOT, startCms, startMockDiscord, USERS } from "./lib.mjs";
import { createSubscriberToken, setupAdmin } from "./setup-admin.mjs";

const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
const R = new Results("Item 1 — headless operation (generated)");
const CMS_DIR = join(ROOT, "cms");

// ---------------------------------------------------------------------------
// Mock CI: receives repository_dispatch-shaped POSTs
// ---------------------------------------------------------------------------
const dispatches = [];
const ci = createServer((req, res) => {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		dispatches.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(body || "{}") });
		res.writeHead(204).end();
	});
});
await new Promise((r) => ci.listen(4500, "127.0.0.1", r));
const DISPATCH_TOKEN = "dispatch-token-from-env";

const mock = await startMockDiscord();
const cms = await startCms({
	env: {
		EMDASH_ALLOW_INVITES: "on",
		BUILD_DISPATCH_URL: "http://127.0.0.1:4500/repos/OWNER/site/dispatches",
		BUILD_DISPATCH_TOKEN: DISPATCH_TOKEN,
	},
});
const setup = await setupAdmin(cms.base);
const admin = setup.client;

const png = (w, h, seed) => {
	// Small valid PNG generated in-process (no binary fixtures in the repo).
	const zlib = require_("node:zlib");
	const crc = (buf) => {
		let c, crcTable = [];
		for (let n = 0; n < 256; n++) {
			c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			crcTable[n] = c >>> 0;
		}
		let x = 0xffffffff;
		for (const b of buf) x = crcTable[(x ^ b) & 0xff] ^ (x >>> 8);
		return (x ^ 0xffffffff) >>> 0;
	};
	const chunk = (type, data) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const td = Buffer.concat([Buffer.from(type), data]);
		const c = Buffer.alloc(4);
		c.writeUInt32BE(crc(td));
		return Buffer.concat([len, td, c]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr.set([8, 2, 0, 0, 0], 8);
	const rows = [];
	for (let y = 0; y < h; y++) {
		const row = Buffer.alloc(1 + w * 3);
		for (let x = 0; x < w; x++) row.set([(x * 4 + seed) & 255, (y * 5) & 255, seed & 255], 1 + x * 3);
		rows.push(row);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
		chunk("IEND", Buffer.alloc(0)),
	]);
};
import { createRequire } from "node:module";
const require_ = createRequire(import.meta.url);

async function upload(client, name, seed) {
	const fd = new FormData();
	fd.append("file", new Blob([png(40, 30, seed)], { type: "image/png" }), name);
	fd.append("alt", `alt of ${name}`);
	const r = await client.request("POST", "/_emdash/api/media", { body: fd });
	if (r.status !== 201) throw new Error(`upload failed ${r.status} ${r.text}`);
	return r.json.data.item;
}
const pt = (text) => [
	{ _type: "block", _key: "k1", style: "normal", markDefs: [], children: [{ _type: "span", _key: "s1", text, marks: [] }] },
];
async function createArticle(title, extra = {}) {
	const r = await admin.post("/_emdash/api/content/articles", { data: { title, body: pt(`${title} body`), ...extra } });
	if (r.status !== 201) throw new Error(`create failed ${r.status} ${r.text}`);
	return r.json.data.item;
}
const publish = (id) => admin.post(`/_emdash/api/content/articles/${id}/publish`, {});
// Hooks run after the response is sent; wait until no new dispatch arrives for 500 ms.
async function settled() {
	let last = -1;
	while (last !== dispatches.length) {
		last = dispatches.length;
		await new Promise((r) => setTimeout(r, 500));
	}
	return dispatches.length;
}

try {
	// -------------------------------------------------------------------------
	// 1-1 public routes removed, admin works
	// -------------------------------------------------------------------------
	const anon = new Client(cms.base);
	const publicProbe = {};
	for (const p of ["/", "/articles", "/posts/hello", "/sitemap.xml", "/robots.txt", "/_emdash/api/search?q=x", "/_emdash/api/manifest"]) {
		publicProbe[p] = (await anon.get(p)).status;
	}
	R.check("1-1a", "unused public pages return 404", publicProbe["/"] === 404 && publicProbe["/articles"] === 404 && publicProbe["/posts/hello"] === 404, JSON.stringify(publicProbe));
	const sitemap = await anon.get("/sitemap.xml");
	const robots = await anon.get("/robots.txt");
	R.check("1-1b", "remaining injected public routes are harmless (empty sitemap index, robots disallows /_emdash/)", !/<loc>/.test(sitemap.text) && /Disallow: \/_emdash\//.test(robots.text), `sitemap ${sitemap.status} robots ${robots.status}`);

	// admin UI smoke test in the browser that ran setup (operator session)
	const page = setup.page;
	const adminScreens = {};
	for (const p of ["/_emdash/admin", "/_emdash/admin/content/articles", "/_emdash/admin/content/casts", "/_emdash/admin/media", "/_emdash/admin/users", "/_emdash/admin/settings"]) {
		await page.goto(cms.base + p);
		await page.waitForLoadState("networkidle");
		const text = await page.locator("body").innerText();
		adminScreens[p] = /error|something went wrong/i.test(text.slice(0, 400)) ? "error" : "ok";
	}
	// create + publish through the UI editor
	await page.goto(`${cms.base}/_emdash/admin/content/articles/new`);
	await page.waitForLoadState("networkidle");
	// First visit shows a one-time welcome dialog.
	const welcome = page.getByRole("button", { name: "Get Started" });
	if (await welcome.isVisible().catch(() => false)) await welcome.click();
	await page.locator("#field-title").fill("Created in admin UI");
	await page.getByRole("button", { name: "Save" }).first().click();
	await page.waitForTimeout(2000);
	const list = await admin.get("/_emdash/api/content/articles?status=all");
	const uiCreate = list.json.data.items.some((i) => i.data.title === "Created in admin UI") ? "ok" : "not saved";
	R.check("1-1c", "admin screens load and an article can be created from the admin UI", Object.values(adminScreens).every((v) => v === "ok") && uiCreate === "ok", `${JSON.stringify(adminScreens)} uiCreate=${uiCreate}`);

	// -------------------------------------------------------------------------
	// fixtures
	// -------------------------------------------------------------------------
	const heroMedia = await upload(admin, "hero.png", 10);
	const draftMedia = await upload(admin, "draft-only.png", 20);
	const published = [];
	for (let i = 1; i <= 7; i++) {
		const a = await createArticle(`Published ${i}`, i === 1 ? { hero_image: { id: heroMedia.id, alt: "hero alt" }, keywords: "a, b", theme_color: "blue" } : {});
		await publish(a.id);
		published.push(a);
		await new Promise((r) => setTimeout(r, 20));
	}
	const draft = await createArticle("Draft only", { hero_image: { id: draftMedia.id } });
	const scheduled = await createArticle("Scheduled");
	await admin.post(`/_emdash/api/content/articles/${scheduled.id}/schedule`, { scheduledAt: new Date(Date.now() + 86_400_000).toISOString() });
	const trashed = await createArticle("Trashed");
	await publish(trashed.id);
	await admin.del(`/_emdash/api/content/articles/${trashed.id}`);
	// published entry with an unpublished edit
	const edited = published[1];
	const g = await admin.get(`/_emdash/api/content/articles/${edited.id}`);
	await admin.put(`/_emdash/api/content/articles/${edited.id}`, { data: { title: "UNPUBLISHED EDIT" }, _rev: g.json.data._rev });

	const hits = async (q) => {
		const r = await anon.get(`/_emdash/api/search?q=${encodeURIComponent(q)}`);
		return `${r.status}:${r.json?.data?.items?.length ?? r.json?.data?.results?.length ?? "?"}`;
	};
	R.note("1-1d", "unauthenticated search API stays reachable", `anonymous GET /_emdash/api/search q=Published → ${await hits("Published")}, q="Draft only" → ${await hits("Draft only")} (status:hits)`);

	// -------------------------------------------------------------------------
	// 1-2 read-only token
	// -------------------------------------------------------------------------
	// (a) token issued by the operator (Admin-owned), scopes content:read + media:read
	const adminTok = await admin.post("/_emdash/api/admin/api-tokens", { name: "naive", scopes: ["content:read", "media:read"] });
	const naive = new Client(cms.base, { bearer: adminTok.json.data.token });
	const naiveList = await naive.get("/_emdash/api/content/articles?limit=100");
	const naiveStatuses = [...new Set(naiveList.json.data.items.map((i) => i.status))];
	R.check("1-2a", "Admin-issued content:read token: default list excludes drafts/scheduled", !naiveStatuses.some((s) => s !== "published"), `statuses in response: ${naiveStatuses.join(",")} (token is evaluated with its owner's Admin role)`);

	// (b) token owned by a Subscriber service user
	const { token } = await createSubscriberToken(cms.base, admin, { outbox: cms.outbox });
	const bot = new Client(cms.base, { bearer: token });
	const titles = async (q) => (await bot.get(`/_emdash/api/content/articles${q}`)).json.data.items.map((i) => i.data.title);
	const listDefault = await titles("?limit=100");
	const listDraft = await titles("?status=draft&limit=100");
	const listAll = await titles("?status=all&limit=100");
	const leaked = [...listDefault, ...listDraft, ...listAll].filter((t) => ["Draft only", "Scheduled", "Trashed", "UNPUBLISHED EDIT", "Created in admin UI"].includes(t));
	const byId = {
		draft: (await bot.get(`/_emdash/api/content/articles/${draft.id}`)).status,
		scheduled: (await bot.get(`/_emdash/api/content/articles/${scheduled.id}`)).status,
		trashed: (await bot.get(`/_emdash/api/content/articles/${trashed.id}`)).status,
		trashList: (await bot.get(`/_emdash/api/content/articles/trash`)).status,
	};
	const editedLive = (await bot.get(`/_emdash/api/content/articles/${edited.id}`)).json.data.item.data.title;
	R.check("1-2b", "Subscriber-owned token: drafts, scheduled, trashed and unpublished edits never appear", leaked.length === 0 && byId.draft === 404 && byId.scheduled === 404 && byId.trashed === 404 && byId.trashList === 403 && editedLive === "Published 2", `leaked=${JSON.stringify(leaked)} byId=${JSON.stringify(byId)} liveTitle=${editedLive}`);
	const writes = {
		create: (await bot.post("/_emdash/api/content/articles", { data: { title: "x" } })).status,
		update: (await bot.put(`/_emdash/api/content/articles/${published[0].id}`, { data: { title: "x" } })).status,
		publish: (await bot.post(`/_emdash/api/content/articles/${draft.id}/publish`, {})).status,
		delete: (await bot.del(`/_emdash/api/content/articles/${published[0].id}`)).status,
		media: (await bot.request("POST", "/_emdash/api/media", { body: new FormData() })).status,
		schema: (await bot.post("/_emdash/api/schema/collections", { slug: "x", label: "x" })).status,
	};
	R.check("1-2c", "write APIs are refused for the read token", Object.values(writes).every((s) => s === 403), JSON.stringify(writes));
	const mediaList = await bot.get("/_emdash/api/media?limit=100");
	R.check("1-2d", "read token can list media", mediaList.status === 200 && mediaList.json.data.items.length >= 1, `status ${mediaList.status}, ${mediaList.json?.data?.items?.length} items`);

	// -------------------------------------------------------------------------
	// 1-3 pagination and sort
	// -------------------------------------------------------------------------
	const perPage = 3;
	const pages = [];
	let total;
	for (let page = 1; page <= 4; page++) {
		const r = await bot.get(`/_emdash/api/content/articles?page=${page}&limit=${perPage}&orderBy=publishedAt&order=desc`);
		total = r.json.data.total;
		pages.push(r.json.data.items.map((i) => i.publishedAt));
	}
	const flat = pages.flat();
	const sortedDesc = flat.every((v, i) => i === 0 || flat[i - 1] >= v);
	const totalPages = Math.ceil(total / perPage);
	R.check("1-3a", "page/limit/total → PaginatedResponse (totalItems, totalPages) can be built", total === 7 && totalPages === 3 && pages[0].length === 3 && pages[2].length === 1 && pages[3].length === 0, `total=${total} totalPages=${totalPages} pageSizes=${pages.map((p) => p.length)}`);
	R.check("1-3b", "orderBy=publishedAt&order=desc is honoured across pages", sortedDesc && new Set(flat).size === 7, flat.join(" > "));
	const asc = (await bot.get(`/_emdash/api/content/articles?limit=100&orderBy=title&order=asc`)).json.data.items.map((i) => i.data.title);
	R.check("1-3c", "orderBy on a user field (title asc)", asc.join() === [...asc].sort().join(), asc.join(", "));

	// -------------------------------------------------------------------------
	// 1-4 media
	// -------------------------------------------------------------------------
	const heroRef = (await bot.get(`/_emdash/api/content/articles/${published[0].id}`)).json.data.item.data.hero_image;
	const mediaUrl = mediaList.json.data.items.find((m) => m.id === heroRef.id)?.url;
	const fileRes = await fetch(new URL(mediaUrl, cms.base));
	const fileBytes = Buffer.from(await fileRes.arrayBuffer());
	R.check("1-4a", "image referenced by content is downloadable at build time (url from GET /media)", fileRes.status === 200 && fileBytes.length === heroMedia.size, `${mediaUrl} → ${fileRes.status} ${fileBytes.length} bytes`);
	const draftMediaUrl = `/_emdash/api/media/file/${draftMedia.storageKey}`;
	const anonDraftFile = await fetch(cms.base + draftMediaUrl);
	R.note("1-4b", "media file route requires no auth", `GET ${draftMediaUrl} (media used only by a draft) without credentials → ${anonDraftFile.status}. File keys are random ULIDs; anyone holding the URL can fetch it.`);

	// -------------------------------------------------------------------------
	// 1-5 build trigger hooks
	// -------------------------------------------------------------------------
	await settled();
	dispatches.length = 0;
	const h = await createArticle("Hook target");
	const n0 = await settled();
	await publish(h.id);
	const n1 = await settled();
	const hg = await admin.get(`/_emdash/api/content/articles/${h.id}`);
	await admin.put(`/_emdash/api/content/articles/${h.id}`, { data: { title: "Hook target (edit, not published)" }, _rev: hg.json.data._rev });
	const n2 = await settled();
	await publish(h.id);
	const n3 = await settled();
	await admin.post(`/_emdash/api/content/articles/${h.id}/unpublish`, {});
	const n4 = await settled();
	await publish(h.id);
	await admin.del(`/_emdash/api/content/articles/${h.id}`);
	const n5 = await settled();
	await admin.del(`/_emdash/api/content/articles/${h.id}/permanent`);
	const n6 = await settled();
	const actions = dispatches.map((d) => d.body.client_payload.action);
	R.check(
		"1-5a",
		"one dispatch per publish / unpublish / delete; none for create, unpublished edit, emptying trash",
		n0 === 0 && n1 === 1 && n2 === 1 && n3 === 2 && n4 === 3 && n5 === 5 && n6 === 5,
		`counts after create=${n0} publish=${n1} edit=${n2} republish=${n3} unpublish=${n4} publish+trash=${n5} permanent=${n6}; actions=${actions.join(",")}`,
	);
	R.check("1-5b", "dispatch token comes from env", dispatches.every((d) => d.auth === `Bearer ${DISPATCH_TOKEN}`) && dispatches[0].path === "/repos/OWNER/site/dispatches", dispatches[0]?.auth);

	// -------------------------------------------------------------------------
	// 1-6 schema as code
	// -------------------------------------------------------------------------
	const pnpm = (args, cwd = CMS_DIR) => execFileSync("pnpm", ["-s", "emdash", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	const schemaOf = (seed) =>
		JSON.stringify(
			(seed.collections ?? []).map((c) => ({ slug: c.slug, supports: [...(c.supports ?? [])].sort(), fields: c.fields.map((f) => ({ slug: f.slug, type: f.type, required: !!f.required, validation: f.validation ?? null })) })),
		);
	const repoSeed = JSON.parse(readFileSync(join(CMS_DIR, "seed/seed.json"), "utf8"));
	const exported1 = JSON.parse(pnpm(["export-seed", "-d", join(cms.dir, "data.db")]));
	R.check("1-6a", "export-seed of the running DB matches cms/seed/seed.json (collections and fields)", schemaOf(exported1) === schemaOf(repoSeed), schemaOf(exported1) === schemaOf(repoSeed) ? "identical" : `repo=${schemaOf(repoSeed)}\nexport=${schemaOf(exported1)}`);
	const adminCli = (await admin.post("/_emdash/api/admin/api-tokens", { name: "cli", scopes: ["schema:read", "schema:write"] })).json.data.token;
	pnpm(["schema", "add-field", "articles", "subtitle", "--type", "string", "--label", "Subtitle", "--url", cms.base, "--token", adminCli]);
	const exported2 = JSON.parse(pnpm(["export-seed", "-d", join(cms.dir, "data.db")]));
	const added = exported2.collections.find((c) => c.slug === "articles").fields.find((f) => f.slug === "subtitle");
	R.check("1-6b", "CLI schema change shows up as a seed-file diff", !!added && added.type === "string", JSON.stringify(added));
	const freshDir = mkdtempSync(join(tmpdir(), "emdash-seedapply-"));
	const seedFile = join(freshDir, "seed.json");
	writeFileSync(seedFile, JSON.stringify(exported2));
	pnpm(["seed", seedFile, "-d", join(freshDir, "data.db"), "--no-content"]);
	const reExported = JSON.parse(pnpm(["export-seed", "-d", join(freshDir, "data.db")]));
	R.check("1-6c", "applying the seed to an empty DB reproduces the same schema", schemaOf(reExported) === schemaOf(exported2), schemaOf(reExported) === schemaOf(exported2) ? "identical" : schemaOf(reExported));

	// -------------------------------------------------------------------------
	// 1-7 export / import
	// -------------------------------------------------------------------------
	const exportTok = (await admin.post("/_emdash/api/admin/api-tokens", { name: "export", scopes: ["admin"] })).json.data.token;
	// non-admins cannot export
	const { client: leader } = await discordLogin(cms.base, mock, USERS.leader);
	const leaderExport = await leader.post("/_emdash/api/admin/transfer/exports", {});
	const botExport = await bot.post("/_emdash/api/admin/transfer/exports", {});
	R.check("1-7a", "export is refused for non-admins (Editor session, read token)", leaderExport.status === 403 && botExport.status === 403, `editor=${leaderExport.status} readToken=${botExport.status}`);
	const pkg = join(mkdtempSync(join(tmpdir(), "emdash-export-")), "site.emdash");
	pnpm(["site", "export", "--url", cms.base, "--token", exportTok, "--output", pkg]);

	const target = await startCms({ port: 4322 });
	const tSetup = await setupAdmin(target.base, { email: "admin@example.com" });
	await tSetup.browser.close();
	const tAdmin = tSetup.client;
	const tTok = (await tAdmin.post("/_emdash/api/admin/api-tokens", { name: "import", scopes: ["admin"] })).json.data.token;
	const analyze = JSON.parse(pnpm(["site", "import", pkg, "--url", target.base, "--token", tTok, "--analyze", "--json"]));
	const plan = analyze.plan?.digest ?? analyze.planDigest ?? analyze.digest;
	pnpm(["site", "import", pkg, "--url", target.base, "--token", tTok, "--plan", plan, "--confirm", "--json"]);

	const allItems = async (c, coll) => (await c.get(`/_emdash/api/content/${coll}?status=all&limit=100`)).json.data.items;
	const srcItems = await allItems(admin, "articles");
	const dstItems = await allItems(tAdmin, "articles");
	const key = (i) => `${i.slug}|${i.status}|${i.data.title}`;
	const srcKeys = srcItems.map(key).sort();
	const dstKeys = dstItems.map(key).sort();
	const srcTrash = (await admin.get("/_emdash/api/content/articles/trash")).json.data.items.length;
	const dstTrash = (await tAdmin.get("/_emdash/api/content/articles/trash")).json.data.items.length;
	R.check("1-7b", "content comes back (all statuses incl. drafts/scheduled; trash)", JSON.stringify(srcKeys) === JSON.stringify(dstKeys) && srcTrash === dstTrash, `src=${srcKeys.length} dst=${dstKeys.length} trash ${srcTrash}/${dstTrash}`);
	const srcMedia = (await admin.get("/_emdash/api/media?limit=100")).json.data.items;
	const dstMedia = (await tAdmin.get("/_emdash/api/media?limit=100")).json.data.items;
	let mediaBytesOk = srcMedia.length === dstMedia.length;
	for (const m of srcMedia) {
		const d = dstMedia.find((x) => x.contentHash === m.contentHash);
		if (!d) { mediaBytesOk = false; continue; }
		const a = Buffer.from(await (await fetch(new URL(m.url, cms.base))).arrayBuffer());
		const b = Buffer.from(await (await fetch(new URL(d.url, target.base))).arrayBuffer());
		if (!a.equals(b)) mediaBytesOk = false;
	}
	R.check("1-7c", "media files come back byte-identical", mediaBytesOk, `src=${srcMedia.length} dst=${dstMedia.length}`);
	const srcUsers = (await admin.get("/_emdash/api/admin/users")).json.data.items.map((u) => u.email).sort();
	const dstUsers = (await tAdmin.get("/_emdash/api/admin/users")).json.data.items.map((u) => u.email).sort();
	R.check("1-7d", "users come back", JSON.stringify(srcUsers) === JSON.stringify(dstUsers), `source users=${srcUsers.join(",")} | target users=${dstUsers.join(",")} (site packages carry no users; authors are mapped to existing target users: ${JSON.stringify(analyze.plan?.decisions?.principalMappings ?? analyze.decisions?.principalMappings ?? {})})`);
	await target.stop();

	// Alternative: online SQLite backup + uploads directory, restored into a new instance.
	const { DatabaseSync, backup } = require_("node:sqlite");
	const restoreDir = mkdtempSync(join(tmpdir(), "emdash-restore-"));
	const live = new DatabaseSync(join(cms.dir, "data.db"));
	await backup(live, join(restoreDir, "data.db"));
	live.close();
	cpSync(join(cms.dir, "uploads"), join(restoreDir, "uploads"), { recursive: true });
	const restored = await startCms({ port: 4324, dir: restoreDir });
	const viaToken = new Client(restored.base, { bearer: exportTok });
	const rUsers = (await viaToken.get("/_emdash/api/admin/users")).json.data.items.map((u) => u.email).sort();
	const rItems = (await viaToken.get("/_emdash/api/content/articles?status=all&limit=100")).json.data.items.map(key).sort();
	R.check("1-7e", "SQLite online backup + uploads/ restores everything incl. users, credentials and tokens", JSON.stringify(rUsers) === JSON.stringify(srcUsers) && JSON.stringify(rItems) === JSON.stringify(srcKeys), `users=${rUsers.join(",")} items=${rItems.length} (operator token from the source still authenticates)`);
	await restored.stop();

	// -------------------------------------------------------------------------
	// 1-8 every API the build depends on is in the OpenAPI document
	// -------------------------------------------------------------------------
	const openapi = (await admin.get("/_emdash/api/openapi.json")).json;
	const anonOpenapi = (await anon.get("/_emdash/api/openapi.json")).status;
	const paths = Object.keys(openapi.paths);
	const deps = [
		["GET", "/_emdash/api/content/{collection}"],
		["GET", "/_emdash/api/content/{collection}/{id}"],
		["GET", "/_emdash/api/media"],
		["GET", "/_emdash/api/media/{id}"],
		["POST", "/_emdash/api/admin/api-tokens"],
		["POST", "/_emdash/api/auth/invite"],
		["PUT", "/_emdash/api/admin/users/{id}"],
		["POST", "/_emdash/api/admin/transfer/exports"],
		["GET", "/_emdash/api/media/file/{key}"],
	];
	const listed = deps.map(([m, p]) => [m, p, !!openapi.paths[p]?.[m.toLowerCase()]]);
	const missing = listed.filter((d) => !d[2]).map((d) => `${d[0]} ${d[1]}`);
	R.check("1-8a", "read path used by cms-client (content list/get, media list) is in OpenAPI", listed.slice(0, 3).every((d) => d[2]), listed.slice(0, 4).map((d) => `${d[0]} ${d[1]}=${d[2]}`).join("; "));
	R.check("1-8b", "operational endpoints relied on are in OpenAPI", missing.length === 0, `missing: ${missing.join(", ")}; openapi.json itself requires auth (anon → ${anonOpenapi}); ${paths.length} paths documented`);
	R.check("1-8c", "media file URL is taken from the documented `url` field, not built by the client", "url" in (openapi.components.schemas.MediaListReadItem?.properties ?? {}), "MediaListReadItem.url documented; the /media/file route itself is not");
} catch (e) {
	console.error(e);
	R.check("error", "script error", false, e.message);
} finally {
	await setup.browser.close();
	await cms.stop();
	mock.stop();
	ci.close();
}

if (out) R.write(out);
process.exit(R.rows.some((r) => r.ok === false) ? 1 : 0);
