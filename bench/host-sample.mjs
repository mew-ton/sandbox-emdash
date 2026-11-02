/**
 * Item 4-6 on the host: does RSS keep climbing while the CMS sits idle?
 *
 *   node bench/host-sample.mjs [--seconds 86400] [--port 4341] [--out bench/results/host-24h]
 *
 * `bench/run.mjs` cannot run here: it drives `docker compose` and reads cgroup
 * v1 (`memory/.../memory.stat`, `total_rss`), while this machine has podman and
 * cgroup v2. Porting it would also make the numbers hard to compare with the
 * 2026-10-25 run, so 4-1..4-5 keep that run as their evidence.
 *
 * 4-6 asks only whether RSS grows without bound, which is a question about the
 * slope. That needs the process, not the container: this starts the production
 * server (`dist/server/entry.mjs`, the same entry `pnpm start` uses) and records
 * `VmRSS` and `VmHWM` from /proc every second. What it gives up is the 350 MiB
 * limit and OOM detection, both of which belong to 4-1..4-5.
 *
 * Absolute values sit slightly below the container run — no container overhead —
 * so compare the trend, not the level.
 */

import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const { values: o } = parseArgs({
	options: {
		seconds: { type: "string", default: "86400" },
		port: { type: "string", default: "4341" },
		out: { type: "string", default: join(here, "results/host-24h") },
	},
});

const duration = Number(o.seconds);
const outDir = o.out;
mkdirSync(outDir, { recursive: true });

const log = (...a) => console.log(`[host-24h ${new Date().toISOString().slice(11, 19)}]`, ...a);

/** VmRSS and VmHWM in MiB, or null once the process is gone. */
function readMem(pid) {
	try {
		const status = readFileSync(`/proc/${pid}/status`, "utf8");
		const kb = (field) => {
			const m = new RegExp(`^${field}:\\s+(\\d+) kB$`, "m").exec(status);
			return m ? Number(m[1]) / 1024 : null;
		};
		return { rss: kb("VmRSS"), hwm: kb("VmHWM") };
	} catch {
		return null;
	}
}

/** Least-squares slope in MiB/hour over `rows` (t_s, rss_mib). */
function slope(rows) {
	const n = rows.length;
	if (n < 2) return null;
	const meanT = rows.reduce((s, r) => s + r.t, 0) / n;
	const meanY = rows.reduce((s, r) => s + r.rss, 0) / n;
	let num = 0;
	let den = 0;
	for (const r of rows) {
		num += (r.t - meanT) * (r.rss - meanY);
		den += (r.t - meanT) ** 2;
	}
	if (den === 0) return null;
	return (num / den) * 3600;
}

log(`starting the production server on port ${o.port}`);
const server = spawn(
	process.execPath,
	["--env-file-if-exists=.env", "./dist/server/entry.mjs"],
	{
		cwd: join(root, "cms"),
		// PORT is what the Node adapter's standalone entry reads. HOST stays
		// loopback: nothing should reach this while it is meant to be idle.
		env: { ...process.env, PORT: o.port, HOST: "127.0.0.1" },
		stdio: ["ignore", "pipe", "pipe"],
	},
);
const serverLog = createWriteStream(join(outDir, "server.log"));
server.stdout.pipe(serverLog);
server.stderr.pipe(serverLog);
let exited = null;
server.on("exit", (code, signal) => {
	exited = { code, signal };
	log(`server exited: code=${code} signal=${signal}`);
});

const stop = () => {
	if (!server.killed) server.kill("SIGTERM");
};
process.on("SIGINT", () => {
	stop();
	process.exit(130);
});
process.on("SIGTERM", () => {
	stop();
	process.exit(143);
});

// Wait for it to answer before the clock starts, so migrations and the first
// requests are not counted as idle.
const base = `http://127.0.0.1:${o.port}`;
let healthy = false;
for (let i = 0; i < 120; i++) {
	// The port may already be taken (a leftover container, a dev server). Without
	// this, the health check passes against that other server while our own child
	// is already dead, and the run then samples a pid that no longer exists.
	if (exited) {
		throw new Error(`server exited before answering (code=${exited.code} signal=${exited.signal}); see ${outDir}/server.log`);
	}
	try {
		const res = await fetch(`${base}/_emdash/api/health`);
		if (res.ok) {
			healthy = true;
			break;
		}
	} catch {}
	await new Promise((r) => setTimeout(r, 1000));
}
if (!healthy) {
	stop();
	throw new Error(`server did not answer /_emdash/api/health within 120s; see ${outDir}/server.log`);
}
log(`healthy (pid ${server.pid}); sampling for ${duration}s`);

const csv = createWriteStream(join(outDir, "samples.csv"));
csv.write("t_s,vmrss_mib,vmhwm_mib\n");
const rows = [];
const started = Date.now();

const writeSummary = (note) => {
	// The first 10 % is warm-up: lazy module loads, the FTS check EmDash defers
	// off cold start, and the heap before its first major GC. Reporting both
	// slopes is what separates that from growth that does not stop.
	const settled = rows.slice(Math.floor(rows.length * 0.1));
	writeSummary.last = {
		note,
		samples: rows.length,
		seconds: rows.length === 0 ? 0 : Math.round(rows.at(-1).t),
		first_mib: rows[0]?.rss ?? null,
		last_mib: rows.at(-1)?.rss ?? null,
		min_mib: rows.length === 0 ? null : Math.min(...rows.map((r) => r.rss)),
		max_mib: rows.length === 0 ? null : Math.max(...rows.map((r) => r.rss)),
		peak_vmhwm_mib: rows.length === 0 ? null : Math.max(...rows.map((r) => r.hwm)),
		slope_mib_per_hour_all: slope(rows),
		slope_mib_per_hour_after_warmup: slope(settled),
	};
	writeFileSync(join(outDir, "summary.json"), JSON.stringify(writeSummary.last, null, 2));
	return writeSummary.last;
};

const timer = setInterval(() => {
	const mem = readMem(server.pid);
	if (!mem || mem.rss === null) {
		clearInterval(timer);
		csv.end();
		log("process gone; stopping", JSON.stringify(writeSummary("server exited early")));
		process.exit(1);
	}
	const t = (Date.now() - started) / 1000;
	rows.push({ t, rss: mem.rss, hwm: mem.hwm });
	csv.write(`${t.toFixed(0)},${mem.rss.toFixed(1)},${mem.hwm.toFixed(1)}\n`);

	// A line every 30 min, so a long run leaves something readable in the log.
	if (rows.length % 1800 === 0) log(`${(t / 3600).toFixed(1)}h`, JSON.stringify(writeSummary("running")));

	if (t >= duration) {
		clearInterval(timer);
		csv.end();
		const summary = writeSummary("complete");
		log("done", JSON.stringify(summary));
		stop();
		process.exit(0);
	}
}, 1000);
