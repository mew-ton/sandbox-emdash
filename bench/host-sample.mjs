/**
 * Item 4-6 outside the container harness: does RSS keep climbing while the CMS
 * sits idle, under the same memory limit the VPS gives it?
 *
 *   node bench/host-sample.mjs [--seconds 21600] [--port 4342] [--mem 350M]
 *
 * `bench/run.mjs` cannot run here: it drives `docker compose` (podman-compose
 * rejects `ps -q <service>`) and reads cgroup v1 fields that do not exist on
 * this machine. This takes the same measurement through systemd-run, which puts
 * the server in a transient cgroup v2 scope with MemoryMax set.
 *
 * The limit is not a formality. Node sizes its heap from the memory it believes
 * it has, so the ceiling decides when a major GC runs and therefore what the
 * idle RSS curve looks like:
 *
 *   unconstrained on this host   V8 heap limit 4288 MiB
 *   MemoryMax=350M               V8 heap limit  259 MiB
 *
 * An unconstrained run let RSS climb 175.8 -> 188.7 MiB in 27 minutes
 * (+11.2 MiB/h, monotonic) while the 350 MiB container run moved +0.51 MiB/h.
 * That gap is heap sizing, not a leak, which is why this must run under a
 * limit to say anything about the VPS.
 *
 * Columns in samples.csv:
 *   t_s             seconds since the server answered /health
 *   vmrss_mib       VmRSS of the node process (/proc/<pid>/status)
 *   vmhwm_mib       VmHWM of that process: peak RSS since it started
 *   procs_rss_mib   VmRSS summed over every process in the scope
 *   current_mib     cgroup memory.current (anon + page cache + kernel)
 *   oom_kill        cumulative kills in the scope (cgroup memory.events)
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
		seconds: { type: "string", default: "21600" },
		port: { type: "string", default: "4342" },
		mem: { type: "string", default: "350M" },
		out: { type: "string", default: join(here, "results/host-6h") },
	},
});

const duration = Number(o.seconds);
const outDir = o.out;
mkdirSync(outDir, { recursive: true });
const log = (...a) => console.log(`[4-6 ${new Date().toISOString().slice(11, 19)}]`, ...a);

const readFile = (path) => {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
};

/** VmRSS / VmHWM of one process, in MiB. */
function procMem(pid) {
	const status = readFile(`/proc/${pid}/status`);
	if (status === null) return null;
	const kb = (field) => {
		const m = new RegExp(`^${field}:\\s+(\\d+) kB$`, "m").exec(status);
		return m ? Number(m[1]) / 1024 : null;
	};
	return { rss: kb("VmRSS"), hwm: kb("VmHWM") };
}

/** Least-squares slope in MiB/hour. */
function slope(rows) {
	const n = rows.length;
	if (n < 2) return null;
	const mt = rows.reduce((s, r) => s + r.t, 0) / n;
	const my = rows.reduce((s, r) => s + r.rss, 0) / n;
	let num = 0;
	let den = 0;
	for (const r of rows) {
		num += (r.t - mt) * (r.rss - my);
		den += (r.t - mt) ** 2;
	}
	return den === 0 ? null : (num / den) * 3600;
}

const unit = `emdash-4-6-${Date.now()}`;
log(`starting the production server in scope ${unit} (MemoryMax=${o.mem}) on port ${o.port}`);

// --scope moves systemd-run itself into the new cgroup before exec, so the
// child's own cgroup line names the scope and both the server and anything it
// spawns are accounted there.
const server = spawn(
	"systemd-run",
	[
		"--user",
		"--scope",
		"--quiet",
		`--unit=${unit}`,
		"-p",
		`MemoryMax=${o.mem}`,
		"-p",
		"MemorySwapMax=0",
		process.execPath,
		"--env-file-if-exists=.env",
		"./dist/server/entry.mjs",
	],
	{
		cwd: join(root, "cms"),
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
for (const sig of ["SIGINT", "SIGTERM"]) {
	process.on(sig, () => {
		stop();
		process.exit(sig === "SIGINT" ? 130 : 143);
	});
}

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
		if ((await fetch(`${base}/_emdash/api/health`)).ok) {
			healthy = true;
			break;
		}
	} catch {}
	await new Promise((r) => setTimeout(r, 1000));
}
if (!healthy) {
	stop();
	throw new Error(`no answer from /_emdash/api/health within 120s; see ${outDir}/server.log`);
}

const cgroupLine = readFile(`/proc/${server.pid}/cgroup`) ?? "";
const cgroupPath = /^0::(.*)$/m.exec(cgroupLine)?.[1];
if (!cgroupPath || !cgroupPath.includes(unit)) {
	stop();
	throw new Error(`the server is not in scope ${unit} (cgroup: ${cgroupLine.trim()})`);
}
const cgroupDir = join("/sys/fs/cgroup", cgroupPath);
const scopePids = () =>
	(readFile(join(cgroupDir, "cgroup.procs")) ?? "")
		.split("\n")
		.filter(Boolean)
		.map(Number);
const nodePid = scopePids().find((pid) => (readFile(`/proc/${pid}/comm`) ?? "").trim() === "node") ?? server.pid;

const heapLimit = readFile(join(cgroupDir, "memory.max"))?.trim();
log(`healthy (node pid ${nodePid}, memory.max=${heapLimit}); sampling for ${duration}s`);

const csv = createWriteStream(join(outDir, "samples.csv"));
csv.write("t_s,vmrss_mib,vmhwm_mib,procs_rss_mib,current_mib,oom_kill\n");
const rows = [];
const started = Date.now();

const writeSummary = (note) => {
	// The first 10 % is warm-up: lazy module loads, the FTS check EmDash defers
	// off cold start, and the heap before its first major GC. Reporting both
	// slopes is what separates that from growth that does not stop.
	const settled = rows.slice(Math.floor(rows.length * 0.1));
	const at = (pick) => (rows.length === 0 ? null : pick(rows.map((r) => r.rss)));
	const summary = {
		note,
		memory_max: heapLimit,
		samples: rows.length,
		seconds: rows.length === 0 ? 0 : Math.round(rows.at(-1).t),
		first_mib: rows[0]?.rss ?? null,
		last_mib: rows.at(-1)?.rss ?? null,
		min_mib: at((v) => Math.min(...v)),
		max_mib: at((v) => Math.max(...v)),
		peak_vmhwm_mib: rows.length === 0 ? null : Math.max(...rows.map((r) => r.hwm)),
		peak_procs_rss_mib: rows.length === 0 ? null : Math.max(...rows.map((r) => r.procs)),
		peak_current_mib: rows.length === 0 ? null : Math.max(...rows.map((r) => r.current)),
		oom_kill: rows.at(-1)?.oom ?? 0,
		slope_mib_per_hour_all: slope(rows),
		slope_mib_per_hour_after_warmup: slope(settled),
	};
	writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
	return summary;
};

const finish = (note, code) => {
	csv.end();
	const summary = writeSummary(note);
	log(note, JSON.stringify(summary));
	stop();
	process.exit(code);
};

const timer = setInterval(() => {
	const mem = procMem(nodePid);
	if (!mem || mem.rss === null) {
		clearInterval(timer);
		finish("server exited early", 1);
		return;
	}
	const procs = scopePids().reduce((sum, pid) => sum + (procMem(pid)?.rss ?? 0), 0);
	const current = Number(readFile(join(cgroupDir, "memory.current"))?.trim() ?? 0) / 1048576;
	const oom = Number(/^oom_kill (\d+)$/m.exec(readFile(join(cgroupDir, "memory.events")) ?? "")?.[1] ?? 0);

	const t = (Date.now() - started) / 1000;
	rows.push({ t, rss: mem.rss, hwm: mem.hwm, procs, current, oom });
	csv.write(
		`${t.toFixed(0)},${mem.rss.toFixed(1)},${mem.hwm.toFixed(1)},${procs.toFixed(1)},${current.toFixed(1)},${oom}\n`,
	);

	// A line every 30 min, so a long run leaves something readable in the log.
	if (rows.length % 1800 === 0) log(`${(t / 3600).toFixed(1)}h`, JSON.stringify(writeSummary("running")));
	if (t >= duration) {
		clearInterval(timer);
		finish("complete", 0);
	}
}, 1000);
