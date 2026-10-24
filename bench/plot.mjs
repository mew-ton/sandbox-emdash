/**
 * Render a memory timeline (SVG) from bench/results/<project>/samples.csv.
 *
 *   node bench/plot.mjs bench/results/bench-noswap reports/assets/04-noswap.svg "No swap (memswap 350m)"
 *
 * One y-axis (MiB). Lines: node VmRSS, the docker-stats value (usage − inactive
 * file) and, when recorded, the RSS of every process in the container.
 * Reference lines: 350 MiB memory limit and the 250 MiB steady-state criterion.
 * Shaded bands mark the scenario phases.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const [dir, outFile, title = ""] = process.argv.slice(2);
const lines = readFileSync(join(dir, "samples.csv"), "utf8").trim().split("\n");
const head = lines[0].split(",");
const col = (name) => head.indexOf(name);
const rows = lines
	.slice(1)
	.map((l) => l.split(","))
	.filter((c) => c[col("vmrss_mib")] !== "" && Number.isFinite(Number(c[col("vmrss_mib")])))
	.map((c) => ({
		t: Number(c[col("t_s")]),
		vmrss: Number(c[col("vmrss_mib")]),
		stats: Number(c[col("stats_mib")]),
		procs: col("procs_rss_mib") >= 0 ? Number(c[col("procs_rss_mib")]) : NaN,
		mark: c[col("mark")] ?? "",
	}));

const W = 960, H = 420, L = 56, R = 150, T = 48, B = 44;
const tMax = Math.max(...rows.map((r) => r.t));
const yMax = 400;
const x = (t) => L + (t / tMax) * (W - L - R);
const y = (v) => T + (1 - v / yMax) * (H - T - B);
const hasProcs = rows.some((r) => Number.isFinite(r.procs) && r.procs > 0);
const series = [
	{ key: "vmrss", label: "node VmRSS", cls: "s1" },
	{ key: "stats", label: "docker stats", cls: "s2" },
	...(hasProcs ? [{ key: "procs", label: "all processes", cls: "s3" }] : []),
];

// phase bands
const phases = [];
for (const r of rows) {
	const last = phases[phases.length - 1];
	if (!last || last.mark !== r.mark) phases.push({ mark: r.mark, t0: r.t, t1: r.t });
	else last.t1 = r.t;
}
const fmtT = (s) => (tMax > 7200 ? `${(s / 3600).toFixed(1)}h` : tMax > 900 ? `${Math.round(s / 60)}m` : `${(s / 60).toFixed(1)}m`);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const path = (key) =>
	rows
		.filter((r) => Number.isFinite(r[key]))
		.map((r, i) => `${i ? "L" : "M"}${x(r.t).toFixed(1)},${y(r[key]).toFixed(1)}`)
		.join("");

const gridY = [0, 100, 200, 300, 400];
const ticksX = Array.from({ length: 6 }, (_, i) => (tMax / 5) * i);
const lastOf = (key) => [...rows].reverse().find((r) => Number.isFinite(r[key]))?.[key] ?? 0;

// direct labels, nudged apart vertically
const labels = series.map((s) => ({ ...s, v: lastOf(s.key), y: y(lastOf(s.key)) })).sort((a, b) => a.y - b.y);
for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(title)}: memory over time">
<style>
  svg { --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --grid:#e4e3df; --band:#f1f0ec; --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --limit:#e34948; --crit:#52514e; }
  @media (prefers-color-scheme: dark) {
    svg { --surface:#1a1a19; --ink:#f0efec; --ink2:#c3c2b7; --grid:#33332f; --band:#242422; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --limit:#e66767; --crit:#c3c2b7; }
  }
  text { font: 12px system-ui, sans-serif; fill: var(--ink2); }
  .title { font-size: 14px; font-weight: 600; fill: var(--ink); }
  .line { fill: none; stroke-width: 2; stroke-linejoin: round; }
  .s1 { stroke: var(--s1); } .s2 { stroke: var(--s2); } .s3 { stroke: var(--s3); }
  .d1 { fill: var(--s1); } .d2 { fill: var(--s2); } .d3 { fill: var(--s3); }
</style>
<rect width="${W}" height="${H}" fill="var(--surface)"/>
<text class="title" x="${L}" y="20">${esc(title)}</text>
${phases
	.map((p, i) =>
		i % 2 === 0 && p.mark
			? `<rect x="${x(p.t0).toFixed(1)}" y="${T}" width="${Math.max(1, x(p.t1) - x(p.t0)).toFixed(1)}" height="${H - T - B}" fill="var(--band)"/>`
			: "",
	)
	.join("\n")}
${gridY.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)" stroke-width="1"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join("\n")}
<text x="${L - 8}" y="${T - 10}" text-anchor="end">MiB</text>
${ticksX.map((t) => `<text x="${x(t)}" y="${H - B + 18}" text-anchor="middle">${fmtT(t)}</text>`).join("\n")}
<line x1="${L}" x2="${W - R}" y1="${y(350)}" y2="${y(350)}" stroke="var(--limit)" stroke-width="1.5" stroke-dasharray="6 4"/>
<text x="${W - R + 6}" y="${y(350) + 4}">limit 350</text>
<line x1="${L}" x2="${W - R}" y1="${y(250)}" y2="${y(250)}" stroke="var(--crit)" stroke-width="1" stroke-dasharray="2 4"/>
<text x="${W - R + 6}" y="${y(250) + 4}">criterion 250</text>
${series.map((s) => `<path class="line ${s.cls}" d="${path(s.key)}"/>`).join("\n")}
${labels.map((s) => `<text x="${W - R + 6}" y="${(s.y + 4).toFixed(1)}" style="fill:var(--ink)">${s.label} ${s.v.toFixed(0)}</text>`).join("\n")}
${series.map((s, i) => `<rect x="${L + i * 150}" y="${H - 14}" width="14" height="4" rx="2" class="d${i + 1}"/><text x="${L + i * 150 + 20}" y="${H - 9}">${s.label}</text>`).join("\n")}
${phases
	.filter((p) => p.mark && x(p.t1) - x(p.t0) > 40)
	.map((p) => `<text x="${((x(p.t0) + x(p.t1)) / 2).toFixed(1)}" y="${T + 14}" text-anchor="middle">${esc(p.mark.split(" ")[0])}</text>`)
	.join("\n")}
</svg>
`;
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, svg);
console.log(`wrote ${outFile} (${rows.length} samples)`);
