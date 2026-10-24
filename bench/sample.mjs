/**
 * 1 s sampler for a running container (cgroup v1, cgroupfs driver).
 *
 *   const s = await startSampler(containerId, "results/raw/4-1.csv"); … s.mark("phase"); … await s.stop()
 *
 * Columns:
 *   t_s            seconds since start
 *   stats_mib      what `docker stats` shows: usage − total_inactive_file
 *   rss_mib        cgroup total_rss (anonymous memory)
 *   swap_mib       cgroup total_swap
 *   vmrss_mib      VmRSS of the node process (/proc/<pid>/status)
 *   vmhwm_mib      VmHWM of the node process: peak RSS since the current phase started
 *   procs_rss_mib  sum of VmRSS over every process in the container (node + children such as workerd)
 *   oom_kill       cumulative OOM kills in the cgroup
 *   mark           phase label (set by the scenario)
 * Every 10 s `docker stats --no-stream` is also recorded for cross-checking.
 */

import { execFileSync } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const MiB = 1024 * 1024;
const read = (p) => readFileSync(p, "utf8");
const statFile = (dir) =>
	Object.fromEntries(
		read(`${dir}/memory.stat`)
			.trim()
			.split("\n")
			.map((l) => l.split(" "))
			.map(([k, v]) => [k, Number(v)]),
	);
const procStatus = (pid) => {
	const s = read(`/proc/${pid}/status`);
	const kb = (k) => Number(new RegExp(`${k}:\\s+(\\d+)`).exec(s)?.[1] ?? NaN) * 1024;
	return { vmrss: kb("VmRSS"), vmhwm: kb("VmHWM") };
};

export function containerInfo(id) {
	const [full, pid] = execFileSync("docker", ["inspect", "-f", "{{.Id}} {{.State.Pid}}", id], { encoding: "utf8" }).trim().split(" ");
	return { full, pid: Number(pid), cg: `/sys/fs/cgroup/memory/docker/${full}` };
}

export async function startSampler(id, file) {
	mkdirSync(dirname(file), { recursive: true });
	const outFile = createWriteStream(file);
	outFile.write("t_s,stats_mib,rss_mib,swap_mib,vmrss_mib,vmhwm_mib,procs_rss_mib,oom_kill,docker_stats,mark\n");
	let { pid, cg } = containerInfo(id);
	const t0 = Date.now();
	let mark = "";
	const rows = [];
	let n = 0;
	const tick = () => {
		try {
			const st = statFile(cg);
			const usage = Number(read(`${cg}/memory.usage_in_bytes`));
			const oom = Number(/oom_kill (\d+)/.exec(read(`${cg}/memory.oom_control`))?.[1] ?? 0);
			let p;
			try {
				p = procStatus(pid);
			} catch {
				({ pid } = containerInfo(id)); // restarted
				p = { vmrss: NaN, vmhwm: NaN };
			}
			let procsRss = 0;
			for (const p2 of read(`${cg}/cgroup.procs`).trim().split("\n").filter(Boolean)) {
				try {
					procsRss += procStatus(p2).vmrss || 0;
				} catch {}
			}
			let ds = "";
			if (n++ % 10 === 0) {
				try {
					ds = execFileSync("docker", ["stats", "--no-stream", "--format", "{{.MemUsage}}", id], { encoding: "utf8" }).trim().split(" / ")[0];
				} catch {}
			}
			const row = {
				t: (Date.now() - t0) / 1000,
				stats: (usage - (st.total_inactive_file ?? 0)) / MiB,
				rss: st.total_rss / MiB,
				swap: (st.total_swap ?? 0) / MiB,
				vmrss: p.vmrss / MiB,
				vmhwm: p.vmhwm / MiB,
				procs: procsRss / MiB,
				oom,
				mark,
			};
			rows.push(row);
			outFile.write(
				`${row.t.toFixed(1)},${row.stats.toFixed(1)},${row.rss.toFixed(1)},${row.swap.toFixed(1)},${row.vmrss.toFixed(1)},${row.vmhwm.toFixed(1)},${row.procs.toFixed(1)},${oom},${ds},${mark}\n`,
			);
		} catch (e) {
			outFile.write(`${((Date.now() - t0) / 1000).toFixed(1)},,,,,,,,error ${String(e.message).replaceAll(",", ";")}\n`);
		}
	};
	tick();
	const timer = setInterval(tick, 1000);
	return {
		rows,
		/** Start a phase. VmHWM is reset (clear_refs 5) so it reports the peak of this phase only. */
		mark: (m) => {
			tick();
			mark = m;
			try {
				writeFileSync(`/proc/${pid}/clear_refs`, "5");
			} catch {}
			tick();
		},
		stop: () =>
			new Promise((r) => {
				clearInterval(timer);
				tick();
				outFile.end(r);
			}),
	};
}

/** Summary of the rows carrying a given mark (or all rows). */
export function summarize(rows, mark) {
	const sel = rows.filter((r) => (mark === undefined || r.mark === mark) && Number.isFinite(r.vmrss));
	if (sel.length === 0) return null;
	const max = (k) => Math.max(...sel.map((r) => r[k]));
	const tail = sel.slice(-Math.min(sel.length, 300)); // last 5 minutes
	const mean = (k, xs) => xs.reduce((n, r) => n + r[k], 0) / xs.length;
	return {
		samples: sel.length,
		durationS: Math.round(sel[sel.length - 1].t - sel[0].t),
		peakVmRssMiB: +max("vmrss").toFixed(1),
		peakVmHwmMiB: +max("vmhwm").toFixed(1),
		peakDockerStatsMiB: +max("stats").toFixed(1),
		peakSwapMiB: +max("swap").toFixed(1),
		peakAllProcsRssMiB: +max("procs").toFixed(1),
		steadyVmRssMiB: +mean("vmrss", tail).toFixed(1),
		steadyDockerStatsMiB: +mean("stats", tail).toFixed(1),
		steadyAllProcsRssMiB: +mean("procs", tail).toFixed(1),
		oomKills: max("oom"),
	};
}
