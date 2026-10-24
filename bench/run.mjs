/**
 * Item 4: memory benchmark runner.
 *
 *   node bench/run.mjs --project bench-noswap --memswap 350m --port 4321
 *   node bench/run.mjs --project bench-swap   --memswap 862m --port 4331
 *
 * Options (defaults in brackets):
 *   --scenarios 4-1,4-2,4-3,4-4,4-5,4-6   which phases to run [all but 4-6]
 *   --idle 600        4-1 idle seconds          --editing 1800   4-2 seconds
 *   --long 86400      4-6 seconds               --variant standard
 *   --node-options "" passed to the container as NODE_OPTIONS
 *
 * Phases run in order on one container (fresh volume) and are told apart by
 * the `mark` column of results/<project>/samples.csv.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { createEntry, png, upload } from "../verify/fixtures.mjs";
import { discordLogin, ENCRYPTION_KEY, startMockDiscord, USERS, ROLE_MEMBER } from "../verify/lib.mjs";
import { createSubscriberToken, setupAdmin } from "../verify/setup-admin.mjs";
import { startSampler, summarize } from "./sample.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const { values: o } = parseArgs({
	options: {
		project: { type: "string", default: "bench-noswap" },
		memswap: { type: "string", default: "350m" },
		port: { type: "string", default: "4321" },
		variant: { type: "string", default: "standard" },
		scenarios: { type: "string", default: "4-1,4-2,4-3,4-4,4-5" },
		idle: { type: "string", default: "600" },
		editing: { type: "string", default: "1800" },
		long: { type: "string", default: "86400" },
		"node-options": { type: "string", default: "" },
		"mock-port": { type: "string", default: "4400" },
	},
});
const scenarios = new Set(o.scenarios.split(","));
const outDir = join(here, "results", o.project);
mkdirSync(outDir, { recursive: true });
const base = `http://localhost:${o.port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const outbox = join(here, ".build", `outbox-${o.project}`);
mkdirSync(outbox, { recursive: true });
const env = {
	...process.env,
	OUTBOX_DIR: outbox,
	MOCK_PORT: o["mock-port"],
	PORT: o.port,
	MEMSWAP: o.memswap,
	VARIANT: o.variant,
	NODE_OPTIONS: o["node-options"],
	EMDASH_ENCRYPTION_KEY: ENCRYPTION_KEY,
};
const compose = (...args) => execFileSync("docker", ["compose", "-p", o.project, "-f", join(here, "compose.yaml"), ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const log = (...a) => console.log(`[${o.project} ${new Date().toISOString().slice(11, 19)}]`, ...a);

const summary = { project: o.project, memLimit: "350m", memswap: o.memswap, variant: o.variant, nodeOptions: o["node-options"], phases: {} };
const results = (phase, extra = {}) => {
	summary.phases[phase] = { ...summarize(sampler.rows, phase), ...extra };
	writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
	log(phase, JSON.stringify(summary.phases[phase]));
};

// Fresh container and volume
try {
	compose("down", "-v");
} catch {}
compose("build");
compose("up", "-d");
const id = compose("ps", "-q", "cms").trim();
const sampler = await startSampler(id, join(outDir, "samples.csv"));
const mock = await startMockDiscord({ host: "0.0.0.0", port: Number(o["mock-port"]) });

async function waitHealthy() {
	for (let i = 0; i < 120; i++) {
		try {
			if ((await fetch(`${base}/_emdash/api/health`)).ok) return;
		} catch {}
		await sleep(500);
	}
	throw new Error("container did not become healthy");
}

let admin;
try {
	// ---------------------------------------------------------------- 4-1
	sampler.mark("4-1 boot");
	await waitHealthy();
	sampler.mark("4-1 setup");
	const setup = await setupAdmin(base);
	await setup.browser.close();
	admin = setup.client;
	sampler.mark("4-1 idle");
	if (scenarios.has("4-1")) {
		await sleep(Number(o.idle) * 1000);
		summary.phases["4-1 boot+setup"] = summarize(sampler.rows.filter((r) => r.mark === "4-1 boot" || r.mark === "4-1 setup"));
		results("4-1 idle");
	}

	// ---------------------------------------------------------------- 4-2
	if (scenarios.has("4-2")) {
		sampler.mark("4-2 editing");
		const editors = [];
		for (let i = 0; i < 5; i++) {
			const u = { ...USERS.member, id: `21000000000000000${i}`, username: `editor${i}`, email: `editor${i}@example.com`, roles: [ROLE_MEMBER] };
			await mock.setUser(u, u);
			editors.push((await discordLogin(base, mock, u)).client);
		}
		const seedArticles = [];
		for (let i = 0; i < 20; i++) seedArticles.push(await createEntry(admin, "articles", { title: `Seed ${i}`, body: [{ _type: "block", _key: "k", style: "normal", markDefs: [], children: [{ _type: "span", _key: "s", text: "x".repeat(2000), marks: [] }] }] }));
		const adminAsset = /src="(\/_astro\/[^"]+\.js)"/.exec((await editors[0].get("/_emdash/admin")).text)?.[1];
		const stats = { ops: 0, errors: 0, byStatus: {} };
		const until = Date.now() + Number(o.editing) * 1000;
		await Promise.all(
			editors.map(async (c, n) => {
				let k = 0;
				while (Date.now() < until) {
					const step = async (p) => {
						const r = await p;
						stats.ops++;
						stats.byStatus[r.status] = (stats.byStatus[r.status] ?? 0) + 1;
						if (r.status >= 400) stats.errors++;
						return r;
					};
					try {
						await step(c.get("/_emdash/admin/content/articles"));
						if (adminAsset && k % 5 === 0) await step(c.get(adminAsset));
						const list = await step(c.get("/_emdash/api/content/articles?status=all&limit=50"));
						const items = list.json?.data?.items ?? [];
						const target = items[(n * 7 + k) % Math.max(1, items.length)];
						if (target) {
							const g = await step(c.get(`/_emdash/api/content/articles/${target.id}`));
							await step(c.put(`/_emdash/api/content/articles/${target.id}`, { data: { title: `${target.data.title.split(" #")[0]} #${k}` }, _rev: g.json?.data?._rev }));
							if (k % 3 === 0) await step(c.post(`/_emdash/api/content/articles/${target.id}/publish`, {}));
						}
						if (k % 10 === 0) await step(c.post("/_emdash/api/content/articles", { data: { title: `By editor ${n} (${k})` } }));
					} catch {
						stats.errors++;
					}
					k++;
					await sleep(1000 + Math.random() * 3000);
				}
			}),
		);
		results("4-2 editing", { requests: stats.ops, errors: stats.errors, byStatus: stats.byStatus });
	}

	// ---------------------------------------------------------------- 4-3
	if (scenarios.has("4-3")) {
		sampler.mark("4-3 upload");
		const big = png(1280, 1366, 42, { noise: true }); // ≈5 MiB
		const times = [];
		const statuses = [];
		for (let i = 0; i < 10; i++) {
			const t = Date.now();
			try {
				await upload(admin, `big-${i}.png`, png(1280, 1366, 100 + i, { noise: true }));
				statuses.push(201);
			} catch (e) {
				statuses.push(String(e.message).slice(0, 40));
			}
			times.push(Date.now() - t);
		}
		await sleep(5000);
		results("4-3 upload", { fileBytes: big.length, uploadMs: times, statuses });
	}

	// ---------------------------------------------------------------- seed for 4-4 / 4-5
	if (scenarios.has("4-4") || scenarios.has("4-5")) {
		sampler.mark("seed 100 casts + 500 images");
		const t = Date.now();
		const media = [];
		for (let i = 0; i < 500; i += 2) {
			media.push(...(await Promise.all([0, 1].map((j) => upload(admin, `img-${i + j}.png`, png(320, 240, 1000 + i + j, { noise: true }))))));
		}
		for (let i = 0; i < 100; i++) {
			await createEntry(admin, "casts", {
				name: `Cast ${String(i).padStart(3, "0")}`,
				profile: "profile ".repeat(50),
				avatar: { id: media[i * 2].id, alt: "avatar" },
				banner: { id: media[i * 2 + 1].id, alt: "banner" },
				links: [{ label: "Site", url: `https://example.com/${i}` }],
				theme_color: "blue",
			});
		}
		results("seed 100 casts + 500 images", { seconds: Math.round((Date.now() - t) / 1000), images: media.length, bytesPerImage: png(320, 240, 1, { noise: true }).length });
	}

	// ---------------------------------------------------------------- 4-4
	if (scenarios.has("4-4")) {
		const { token } = await createSubscriberToken(base, admin, { outbox });
		const client = await import(pathToFileURL(join(root, "cms-client/dist/index.js")).href);
		const opts = { baseUrl: base, token };
		sampler.mark("4-4 build fetch");
		const t = Date.now();
		let requests = 0;
		const pool = async (items, fn, n = 10) => {
			const queue = [...items];
			await Promise.all(Array.from({ length: n }, async () => {
				while (queue.length) await fn(queue.shift());
			}));
		};
		const pagesOf = async (fn) => {
			const first = await fn({ page: 1, perPage: 10 }, opts);
			requests++;
			const rest = Array.from({ length: first.totalPages - 1 }, (_, i) => i + 2);
			const out = [...first.items];
			await pool(rest, async (page) => {
				out.push(...(await fn({ page, perPage: 10 }, opts)).items);
				requests++;
			});
			return out;
		};
		const articles = await pagesOf(client.fetchArticles);
		const casts = await pagesOf(client.fetchCasts);
		await pool(articles, async (a) => (await client.fetchArticle(a.id, opts), requests++));
		await pool(casts, async (c) => (await client.fetchCast(c.id, opts), requests++));
		const urls = [...new Set([...articles.map((a) => a.heroImageUrl), ...casts.flatMap((c) => [c.avatarUrl, c.bannerUrl])].filter(Boolean))];
		let bytes = 0;
		await pool(urls, async (u) => {
			bytes += (await (await fetch(u)).arrayBuffer()).byteLength;
			requests++;
		});
		results("4-4 build fetch", { seconds: +((Date.now() - t) / 1000).toFixed(1), requests, articles: articles.length, casts: casts.length, images: urls.length, imageBytes: bytes });
	}

	// ---------------------------------------------------------------- 4-5
	if (scenarios.has("4-5")) {
		const tok = (await admin.post("/_emdash/api/admin/api-tokens", { name: "export", scopes: ["admin"] })).json.data.token;
		sampler.mark("4-5 site export");
		const t = Date.now();
		const outFile = join(outDir, "site.emdash");
		let ok = true;
		let err = "";
		try {
			execFileSync("pnpm", ["-s", "emdash", "site", "export", "--url", base, "--token", tok, "--output", outFile], { cwd: join(root, "cms"), stdio: ["ignore", "pipe", "pipe"] });
		} catch (e) {
			ok = false;
			err = String(e.stderr).slice(-300);
		}
		const size = (() => {
			try {
				return Number(execFileSync("stat", ["-c", "%s", outFile], { encoding: "utf8" }));
			} catch {
				return 0;
			}
		})();
		try {
			execFileSync("rm", ["-f", outFile]);
		} catch {}
		await sleep(5000);
		results("4-5 site export", { ok, err, seconds: +((Date.now() - t) / 1000).toFixed(1), packageBytes: size });
	}

	// ---------------------------------------------------------------- 4-7
	if (scenarios.has("4-7")) {
		// Run with --variant sandbox: the sandboxed plugin runs in a workerd child process.
		sampler.mark("4-7 sandbox hooks");
		for (let i = 0; i < 20; i++) await createEntry(admin, "articles", { title: `Sandbox hook ${i}` });
		await sleep(60_000);
		const procs = execFileSync("docker", ["top", id, "-eo", "pid,rss,args"], { encoding: "utf8" });
		results("4-7 sandbox hooks", { processes: procs.trim().split("\n").slice(1).map((l) => l.trim().replace(/\s+/g, " ").slice(0, 120)) });
	}

	// ---------------------------------------------------------------- 4-6
	if (scenarios.has("4-6")) {
		sampler.mark("4-6 long idle");
		const end = Date.now() + Number(o.long) * 1000;
		while (Date.now() < end) {
			await sleep(Math.min(60_000, end - Date.now()));
			// keep the summary current so a cut-short run still leaves data
			results("4-6 long idle");
		}
		const sel = sampler.rows.filter((r) => r.mark === "4-6 long idle" && Number.isFinite(r.vmrss));
		const n = sel.length;
		const mx = sel.reduce((s, r) => s + r.t, 0) / n;
		const my = sel.reduce((s, r) => s + r.vmrss, 0) / n;
		const slope = sel.reduce((s, r) => s + (r.t - mx) * (r.vmrss - my), 0) / sel.reduce((s, r) => s + (r.t - mx) ** 2, 0);
		results("4-6 long idle", { vmrssSlopeMiBPerHour: +(slope * 3600).toFixed(2) });
	}
} catch (e) {
	console.error(e);
	summary.error = String(e.stack ?? e);
} finally {
	const state = JSON.parse(execFileSync("docker", ["inspect", "-f", "{{json .State}}", id], { encoding: "utf8" }));
	summary.container = { oomKilled: state.OOMKilled, restarting: state.Restarting, running: state.Running, exitCode: state.ExitCode };
	summary.all = summarize(sampler.rows);
	await sampler.stop();
	writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
	mock?.stop();
	compose("logs", "--no-color", "cms");
	writeFileSync(join(outDir, "container.log"), compose("logs", "--no-color", "cms").slice(-20000));
	compose("down", "-v");
	log("done", JSON.stringify(summary.container));
}
