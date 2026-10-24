/**
 * Item 3: cms-client on EmDash — REST wrapper (3b) vs live-collection wrapper (3a).
 *
 *   node verify/item3-cms-client.mjs [--out reports/generated/03-cms-client.md]
 *
 * Needs: cms/dist built; cms-client, site, experiments/3a-live-collection/site-3a
 * and verify/pocketbase-standin/cms-client installed (pnpm install in each).
 */

import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { Results, ROOT, startCms, startMockDiscord } from "./lib.mjs";
import { createSubscriberToken, setupAdmin } from "./setup-admin.mjs";
import { seedSiteContent } from "./fixtures.mjs";

const require_ = createRequire(import.meta.url);
const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
const R = new Results("Item 3 — cms-client on EmDash (generated)");
const CLIENT = join(ROOT, "cms-client");
const SITE = join(ROOT, "site");
const SITE3A = join(ROOT, "experiments/3a-live-collection/site-3a");
const PB = join(ROOT, "verify/pocketbase-standin");

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
const walk = (dir) =>
	readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
/** Disk usage as `du -sk` reports it (pnpm hard links counted once). */
const du = (dir) => Number(sh("du", ["-sk", dir]).split("\t")[0]) * 1024;
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const buildSite = (cwd, env) => {
	try {
		return { ok: true, log: sh("pnpm", ["-s", "build"], { cwd, env: { ...process.env, ...env } }) };
	} catch (e) {
		return { ok: false, log: `${e.stdout ?? ""}${e.stderr ?? ""}` };
	}
};
/** HTML of every page, with optimized-image file names normalized (they hash the source URL). */
const pages = (dist) =>
	Object.fromEntries(
		walk(dist)
			.filter((f) => f.endsWith(".html"))
			.map((f) => [relative(dist, f), readFileSync(f, "utf8").replace(/\/_astro\/[^"]+\.webp/g, "/_astro/IMG.webp")]),
	);

const mock = await startMockDiscord();
const cms = await startCms({ env: { EMDASH_ALLOW_INVITES: "on" } });
const setup = await setupAdmin(cms.base);
await setup.browser.close();
const admin = setup.client;

try {
	const fixtures = await seedSiteContent(admin);
	const { token } = await createSubscriberToken(cms.base, admin, { outbox: cms.outbox });

	// -------------------------------------------------------------------------
	// 3-3 REST wrapper: build cms-client, pack, install into site/ from the tarball
	// -------------------------------------------------------------------------
	sh("pnpm", ["-s", "typecheck"], { cwd: CLIENT });
	sh("pnpm", ["-s", "pack:site"], { cwd: CLIENT });
	// Fresh node_modules so the tarball just packed is what gets installed.
	rmSync(join(SITE, "node_modules"), { recursive: true, force: true });
	sh("pnpm", ["install", "--no-frozen-lockfile"], { cwd: SITE });
	const sitePkg = JSON.parse(readFileSync(join(SITE, "package.json"), "utf8"));
	const build3b = buildSite(SITE, { CMS_URL: cms.base, CMS_TOKEN: token });
	const dist3b = join(SITE, "dist");
	const html3b = build3b.ok ? pages(dist3b) : {};
	R.check("3-3a", "site/ builds with only the cms-client tarball as CMS dependency", build3b.ok && JSON.stringify(Object.keys(sitePkg.dependencies).sort()) === JSON.stringify(["astro", "cms-client"]), `deps=${JSON.stringify(sitePkg.dependencies)} pages=${Object.keys(html3b).length}${build3b.ok ? "" : ` log=${build3b.log.slice(-400)}`}`);
	const articlePages = Object.keys(html3b).filter((p) => /^articles\/[^/]+\/index\.html$/.test(p) && !p.startsWith("articles/page"));
	R.check("3-3b", "every published article (12) and no draft is built; pagination pages from totalPages", articlePages.length === 12 && !Object.values(html3b).some((h) => h.includes("Unpublished draft")) && Object.keys(html3b).filter((p) => p.startsWith("articles/page/")).length === 3, `${articlePages.length} article pages, ${Object.keys(html3b).filter((p) => p.startsWith("articles/page/")).length} list pages`);

	// -------------------------------------------------------------------------
	// 3-4 surface purity
	// -------------------------------------------------------------------------
	const dts = readFileSync(join(CLIENT, "dist/index.d.ts"), "utf8");
	const forbidden = ["emdash", "EmDash", "_emdash", "/api/", "portableText", "PortableText", "Bearer", "storageKey", "ec_pat"];
	const hits = forbidden.filter((w) => dts.includes(w));
	R.check("3-4a", "dist/index.d.ts has no EmDash types, REST paths or EmDash terms", hits.length === 0, hits.length ? `found: ${hits.join(", ")}` : `checked: ${forbidden.join(", ")}`);
	const siteModules = readdirSync(join(SITE, "node_modules/.pnpm"));
	const emdashInSite = siteModules.filter((m) => /emdash/i.test(m));
	R.check("3-4b", "site/node_modules contains no emdash package", emdashInSite.length === 0, `${siteModules.length} packages in site/node_modules/.pnpm; emdash-like: ${emdashInSite.join(",") || "none"}`);
	const imports = sh("grep", ["-rhoE", "from \"[^\"]+\"", join(SITE, "src")]).split("\n").filter(Boolean);
	R.check("3-4c", "site/src imports nothing CMS-specific (only cms-client and astro)", imports.every((i) => /"(cms-client|astro:assets|\.{1,2}\/[^"]+)"/.test(i)), [...new Set(imports)].join(" "));

	// -------------------------------------------------------------------------
	// 3-5 Raw → Domain conversions (checked through the public API and the built HTML)
	// -------------------------------------------------------------------------
	const client = await import(pathToFileURL(join(CLIENT, "dist/index.js")).href);
	const opts = { baseUrl: cms.base, token };
	const full = await client.fetchArticle(fixtures.articles[0].id, opts);
	const plain = await client.fetchArticle(fixtures.articles[1].id, opts);
	const alice = await client.fetchCast(fixtures.casts[0].id, opts);
	const bob = await client.fetchCast(fixtures.casts[1].id, opts);
	const conv = {
		keywords: JSON.stringify(full.keywords) === JSON.stringify(["alpha", "beta", "gamma"]),
		keywordsEmpty: Array.isArray(plain.keywords) && plain.keywords.length === 0,
		heroUrl: full.heroImageUrl.startsWith(cms.base) && plain.heroImageUrl === "",
		heroAlt: full.heroImageAlt === "Hero image alt" && plain.heroImageAlt === "",
		heroLabel: full.heroImageLabel === "Photo: sandbox" && !("heroImageLabel" in plain),
		bodyHtml: full.bodyHtml.includes("<strong>Hello &lt;world&gt; &amp; friends</strong>") && /<img src="[^"]+" alt="Inline image alt">/.test(full.bodyHtml),
		theme: full.themeColor === "green" && plain.themeColor === null,
		dates: [full.publishedAt, full.updatedAt].every((d) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(d)),
		castImages: alice.avatarUrl.startsWith(cms.base) && alice.bannerAlt === "Banner alt" && bob.avatarUrl === "",
		castLinks: JSON.stringify(alice.links) === JSON.stringify([{ label: "Site", url: "https://example.com/alice" }]) && bob.links.length === 0,
		castTheme: alice.themeColor === "purple" && bob.themeColor === null,
	};
	R.check("3-5a", "rich text→bodyHtml, media→URL, select→themeColor, comma list→keywords[], dates→ISO 8601", Object.values(conv).every(Boolean), JSON.stringify(conv));
	const gen = ["src/generated/openapi.ts", "src/generated/collections.ts"].map((f) => [f, readFileSync(join(CLIENT, f), "utf8").slice(0, 200)]);
	const rawTs = readFileSync(join(CLIENT, "src/raw.ts"), "utf8");
	R.check("3-5b", "response types come from generated files (OpenAPI + `emdash types`), not hand-written", gen.every(([, s]) => /generated|auto-generated|Do not make direct changes/i.test(s)) && rawTs.includes('from "./generated/openapi.js"') && rawTs.includes('from "./generated/collections.js"'), gen.map(([f, s]) => `${f}: ${s.split("\n")[0]}`).join(" | "));
	const cmsOrigin = new URL(cms.base);
	const directLinks = Object.entries(html3b).filter(([, h]) => h.includes(cmsOrigin.host) || h.includes("/_emdash/"));
	const localImgs = walk(dist3b).filter((f) => f.endsWith(".webp")).length;
	R.check("3-5c", "built pages contain no link to the CMS host; images are copied into dist/", directLinks.length === 0 && localImgs === 4, `pages linking to CMS: ${directLinks.length}; optimized images in dist: ${localImgs}`);
	const stopped = { ...opts, baseUrl: "http://127.0.0.1:9" };
	const offline = await client.fetchArticles({}, stopped).then(() => "ok", (e) => e.name);
	R.note("3-5d", "3b build when the CMS is unreachable", `fetchArticles → ${offline} (the build fails; it needs the CMS read API)`);

	// -------------------------------------------------------------------------
	// 3-6 same site/ code against the PocketBase stand-in
	// -------------------------------------------------------------------------
	const pbDataset = { token: "pb-token", collections: { articles: [], casts: [] }, files: {} };
	const all = async (fn) => (await fn({ page: 1, perPage: 100 }, opts)).items;
	const file = async (coll, id, url, name) => {
		if (!url) return "";
		pbDataset.files[`${coll}/${id}/${name}`] = Buffer.from(await (await fetch(url)).arrayBuffer()).toString("base64");
		return name;
	};
	for (const a of await all(client.fetchArticles)) {
		let body = a.bodyHtml;
		for (const [, src] of body.matchAll(/<img src="([^"]+)"/g)) {
			const name = `inline-${Object.keys(pbDataset.files).length}.png`;
			await file("pbc_articles", a.id, src, name);
			body = body.replace(src, `/api/files/pbc_articles/${a.id}/${name}`);
		}
		pbDataset.collections.articles.push({
			id: a.id,
			collectionId: "pbc_articles",
			title: a.title,
			description: a.description,
			keywords: a.keywords.join(", "),
			hero_image: await file("pbc_articles", a.id, a.heroImageUrl, "hero.png"),
			hero_image_alt: a.heroImageAlt,
			hero_image_label: a.heroImageLabel ?? "",
			body,
			theme_color: a.themeColor ?? "",
			published_at: a.publishedAt,
			updated: a.updatedAt,
		});
	}
	for (const c of await all(client.fetchCasts)) {
		pbDataset.collections.casts.push({
			id: c.id,
			collectionId: "pbc_casts",
			name: c.name,
			profile: c.profile,
			avatar: await file("pbc_casts", c.id, c.avatarUrl, "avatar.png"),
			avatar_alt: c.avatarAlt,
			banner: await file("pbc_casts", c.id, c.bannerUrl, "banner.png"),
			banner_alt: c.bannerAlt,
			links: c.links,
			theme_color: c.themeColor ?? "",
			published_at: c.publishedAt,
			updated: c.updatedAt,
		});
	}
	const pbDir = mkdtempSync(join(tmpdir(), "pb-standin-"));
	writeFileSync(join(pbDir, "dataset.json"), JSON.stringify(pbDataset));
	const pbServer = spawn(process.execPath, [join(PB, "mock-server.mjs"), join(pbDir, "dataset.json"), "4600"], { stdio: "ignore" });
	await new Promise((r) => setTimeout(r, 500));
	sh("pnpm", ["-s", "build"], { cwd: join(PB, "cms-client") });
	const pbDts = readFileSync(join(PB, "cms-client/dist/index.d.ts"), "utf8");
	// Copy of site/ (sources byte-identical) with the stand-in tarball under the same file name.
	const pbSite = join(pbDir, "site");
	mkdirSync(pbSite);
	for (const f of ["package.json", "astro.config.mjs", "tsconfig.json", "src"]) cpSync(join(SITE, f), join(pbSite, f), { recursive: true });
	mkdirSync(join(pbSite, "vendor"));
	sh("pnpm", ["pack", "--pack-destination", join(pbSite, "vendor")], { cwd: join(PB, "cms-client") });
	sh("pnpm", ["install"], { cwd: pbSite });
	const buildPb = buildSite(pbSite, { CMS_URL: "http://127.0.0.1:4600", CMS_TOKEN: "pb-token" });
	pbServer.kill();
	const htmlPb = buildPb.ok ? pages(join(pbSite, "dist")) : {};
	const srcDiff = (() => {
		try {
			sh("diff", ["-r", join(SITE, "src"), join(pbSite, "src")]);
			sh("diff", [join(SITE, "package.json"), join(pbSite, "package.json")]);
			return "none";
		} catch (e) {
			return e.stdout;
		}
	})();
	const differing = Object.keys(html3b).filter((k) => html3b[k] !== htmlPb[k]);
	R.check("3-6a", "public .d.ts of the EmDash build and the PocketBase stand-in are identical", pbDts === dts, pbDts === dts ? "identical" : "differs");
	R.check("3-6b", "site/ sources and package.json unchanged; both builds produce the same pages", buildPb.ok && srcDiff === "none" && differing.length === 0 && Object.keys(htmlPb).length === Object.keys(html3b).length, `source diff: ${srcDiff}; pages ${Object.keys(html3b).length}/${Object.keys(htmlPb).length}; differing: ${differing.join(",") || "none"} (optimized image file names normalized)${buildPb.ok ? "" : ` log=${buildPb.log.slice(-300)}`}`);

	// -------------------------------------------------------------------------
	// 3-1 / 3-2 live-collection wrapper (3a)
	// -------------------------------------------------------------------------
	const { DatabaseSync, backup } = require_("node:sqlite");
	const copyDir = mkdtempSync(join(tmpdir(), "cms-copy-"));
	const live = new DatabaseSync(join(cms.dir, "data.db"));
	await backup(live, join(copyDir, "data.db"));
	live.close();
	cpSync(join(cms.dir, "uploads"), join(copyDir, "uploads"), { recursive: true });
	await cms.stop(); // 3a reads the database file; the CMS process is not needed
	// Same page sources as site/; only config and the cms-client package differ.
	for (const d of ["pages", "lib"]) {
		rmSync(join(SITE3A, "src", d), { recursive: true, force: true });
		cpSync(join(SITE, "src", d), join(SITE3A, "src", d), { recursive: true });
	}
	sh("pnpm", ["pack", "--pack-destination", join(SITE3A, "vendor")], { cwd: join(ROOT, "experiments/3a-live-collection/cms-client-3a") });
	rmSync(join(SITE3A, "node_modules"), { recursive: true, force: true });
	sh("pnpm", ["install", "--no-frozen-lockfile"], { cwd: SITE3A });
	const build3a = buildSite(SITE3A, { CMS_DB_PATH: join(copyDir, "data.db"), CMS_UPLOADS_DIR: join(copyDir, "uploads") });
	const pkg3a = JSON.parse(readFileSync(join(SITE3A, "package.json"), "utf8"));
	const html3a = build3a.ok ? pages(join(SITE3A, "dist/client")) : {};
	const ids3a = Object.keys(html3a).filter((p) => /^articles\/[^/]+\/index\.html$/.test(p) && !p.startsWith("articles/page")).map((p) => p.split("/")[1]);
	const fullHtml3a = html3a["articles/full-article/index.html"] ?? "";
	R.check("3-1a", "3a builds static pages with the CMS process stopped (reads a copy of the SQLite file)", build3a.ok && Object.keys(html3a).length > 0, `${Object.keys(html3a).length} pages${build3a.ok ? "" : ` log=${build3a.log.slice(-400)}`}`);
	const warnHeaders = (build3a.log.match(/Astro\.request\.headers` was used/g) ?? []).length;
	R.note(
		"3-1b",
		"what site/ needs in addition for 3a",
		`dependencies: ${Object.keys(pkg3a.dependencies).filter((d) => !["astro", "cms-client"].includes(d)).join(", ")}; config: emdash() integration + react() + a server adapter (EmDash injects admin/API routes, a static build fails with NoAdapterInstalled) + src/live.config.ts; env: CMS_DB_PATH (SQLite file), CMS_UPLOADS_DIR (media files); build output: dist/client ${mb(du(join(SITE3A, "dist/client")))} (includes the admin bundle) + dist/server ${mb(du(join(SITE3A, "dist/server")))}; node_modules ${mb(du(join(SITE3A, "node_modules")))} vs ${mb(du(join(SITE, "node_modules")))} for 3b; ${warnHeaders} "Astro.request.headers on prerendered page" warnings`,
	);
	R.note(
		"3-1c",
		"behavioural differences observed in 3a",
		`article ids are slugs (${ids3a.slice(0, 2).join(", ")}…) instead of entry ids (${fixtures.articles[0].id}); hero image ${/<figure>/.test(fullHtml3a) ? "rendered" : "missing (image field carries no URL outside EmDash's own components)"}; inline image ${/Unknown block type/.test(fullHtml3a) ? "not rendered (Portable Text image needs EmDash components)" : "rendered"}; no total count from getEmDashCollection (counted by walking every entry)`,
	);
} catch (e) {
	console.error(e);
	R.check("error", "script error", false, e.stack?.split("\n").slice(0, 3).join(" "));
} finally {
	await cms.stop().catch(() => {});
	mock.stop();
}

if (out) R.write(out);
process.exit(R.rows.some((r) => r.ok === false) ? 1 : 0);
