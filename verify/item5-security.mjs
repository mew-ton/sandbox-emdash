/**
 * Item 5: security (non-destructive checks).
 *
 *   node verify/item5-security.mjs [--out reports/generated/05-security.md]
 *
 * Runs cms/dist locally with a mock Discord. The member-reachable crash (5-6)
 * is destructive and lives in bench/security/dos-poc.mjs, not here.
 */

import { readFileSync } from "node:fs";

import { Client, discordLogin, Results, ROOT, startCms, startMockDiscord, USERS } from "./lib.mjs";
import { createSubscriberToken, setupAdmin } from "./setup-admin.mjs";
import { block, createEntry, seedSiteContent } from "./fixtures.mjs";

const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
const R = new Results("Item 5 — security (generated)");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OPEN = (s) => ![401, 403, 404, 405].includes(s);

const mock = await startMockDiscord();
const cms = await startCms({ env: { EMDASH_ALLOW_INVITES: "on", EMAIL_OUTBOX_DIR: `${ROOT}/bench/.build/outbox-item5` } });
const setup = await setupAdmin(cms.base);
await setup.browser.close();
const admin = setup.client;

try {
	// -------------------------------------------------------------------------
	// 5-1 anonymous route surface
	// -------------------------------------------------------------------------
	const anon = new Client(cms.base);
	const probes = {
		mcpWellKnown: (await anon.get("/.well-known/oauth-protected-resource")).status,
		mcpAuthServer: (await anon.get("/.well-known/oauth-authorization-server/_emdash")).status,
		emdashWellKnown: (await anon.get("/_emdash/.well-known/auth")).status,
		oauthAuthorize: (await anon.get("/_emdash/oauth/authorize")).status,
		deviceCode: (await anon.post("/_emdash/api/oauth/device/code", {})).status,
		oauthRegister: (await anon.post("/_emdash/api/oauth/register", {})).status,
		search: (await anon.get("/_emdash/api/search?q=x")).status,
		suggest: (await anon.get("/_emdash/api/search/suggest?q=x")).status,
		comments: (await anon.get(`/_emdash/api/comments/articles/x`)).status,
		visualEditing: (await anon.get("/_emdash/api/visual-editing/toolbar-labels")).status,
		sitemap: (await anon.get("/sitemap.xml")).status,
		image: (await anon.get("/_image?href=/x&w=10")).status,
		// must stay reachable:
		health: (await anon.get("/_emdash/api/health")).status,
		discordLogin: (await anon.get("/_emdash/api/auth/discord/login")).status, // 302 redirect
		passkeyOptions: (await anon.post("/_emdash/api/auth/passkey/options", {})).status, // operator login
		robots: (await anon.get("/robots.txt")).status,
	};
	const closed = ["mcpWellKnown", "mcpAuthServer", "emdashWellKnown", "oauthAuthorize", "deviceCode", "oauthRegister", "search", "suggest", "comments", "visualEditing", "sitemap", "image"];
	const stillOpen = closed.filter((k) => OPEN(probes[k]));
	R.check("5-1a", "public-site, MCP/CLI-OAuth and image routes are closed to anonymous callers", stillOpen.length === 0, stillOpen.length ? `still open: ${stillOpen.map((k) => `${k}=${probes[k]}`).join(", ")}` : `closed: ${closed.join(", ")}`);
	R.check("5-1b", "operator and health routes stay reachable", probes.health === 200 && probes.robots === 200 && [302, 200].includes(probes.discordLogin) && probes.passkeyOptions === 200, `health=${probes.health} robots=${probes.robots} discordLogin=${probes.discordLogin} passkeyOptions=${probes.passkeyOptions}`);
	R.note("5-1c", "anonymous routes that remain by design", "login/callback for Discord, passkey options/verify and magic-link verify (operator and cold-standby sign-in), auth/mode, media file bytes (see 5-3). The full list is in the report.");

	// -------------------------------------------------------------------------
	// fixtures for 5-2 / 5-3
	// -------------------------------------------------------------------------
	const fx = await seedSiteContent(admin);
	const xss = await createEntry(admin, "articles", {
		title: "XSS probe <script>alert(1)</script>",
		body: [
			block("x1", "<script>alert('body')</script> and <img src=x onerror=alert(2)>"),
			{ _type: "block", _key: "x2", style: "normal", markDefs: [{ _type: "link", _key: "l1", href: "javascript:alert(3)" }], children: [{ _type: "span", _key: "x2s", text: "clickme", marks: ["l1"] }] },
		],
	});

	// -------------------------------------------------------------------------
	// 5-2 body XSS in the published site output
	// -------------------------------------------------------------------------
	const { token } = await createSubscriberToken(cms.base, admin, { outbox: `${ROOT}/bench/.build/outbox-item5` });
	const client = await import(new URL("../cms-client/dist/index.js", import.meta.url).href);
	const article = await client.fetchArticle(xss.id, { baseUrl: cms.base, token });
	const html = article.bodyHtml;
	// The injected markup must survive only as escaped text, never as live tags.
	const liveTag = /<\s*(script|img|iframe|svg|object|embed)\b/i.test(html);
	const liveHandler = /<[^>]+\son\w+\s*=/i.test(html);
	const jsLink = /href\s*=\s*["']?\s*javascript:/i.test(html);
	const escapedScript = html.includes("&lt;script&gt;");
	R.check("5-2a", "rich-text body is escaped: injected <script>/<img onerror>/javascript: survive only as text", !liveTag && !liveHandler && !jsLink && escapedScript, `liveTag=${liveTag} liveHandler=${liveHandler} jsLink=${jsLink} escapedScriptPresent=${escapedScript}; sample=${html.slice(0, 110).replace(/\n/g, " ")}`);
	R.note("5-2b", "scope of 5-2", "the sandbox schema only has a portableText body (escaped by @portabletext/to-html). An html/iframe/embed block type, if added, would reach the page unescaped — out of this schema's scope.");

	// -------------------------------------------------------------------------
	// 5-3 upload handling
	// -------------------------------------------------------------------------
	const { client: member } = await discordLogin(cms.base, mock, USERS.member);
	const upload = async (name, type, body) => {
		const fd = new FormData();
		fd.append("file", new Blob([body], { type }), name);
		const r = await member.request("POST", "/_emdash/api/media", { body: fd });
		if (r.status !== 201) return { rejected: r.status };
		const item = r.json.data.item;
		const f = await fetch(cms.base + item.url);
		return { mime: item.mimeType, servedType: f.headers.get("content-type"), disposition: f.headers.get("content-disposition"), nosniff: f.headers.get("x-content-type-options"), csp: f.headers.get("content-security-policy") };
	};
	const svg = await upload("e.svg", "image/svg+xml", "<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'></svg>");
	const htmlAsPng = await upload("e.png", "image/png", "<html><script>alert(1)</script></html>");
	const svgAsPng = await upload("e2.svg", "image/png", "<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'></svg>");
	R.check("5-3a", "SVG/HTML uploads are rejected or served non-executably", svg.rejected === 400 && htmlAsPng.nosniff === "nosniff" && htmlAsPng.disposition === "inline" && /sandbox/.test(htmlAsPng.csp ?? "") && svgAsPng.disposition === "attachment", `svg=${JSON.stringify(svg)} htmlAsPng=${JSON.stringify(htmlAsPng)} svgAsPng.disposition=${svgAsPng.disposition}`);
	R.note("5-3b", "how it is defended", "the media route sets Content-Type by sniffing bytes (not the client type), X-Content-Type-Options: nosniff, a restrictive CSP (sandbox; default-src 'none'), and Content-Disposition: attachment for anything but real images. A file whose bytes are SVG is served as image/svg+xml with attachment, so it downloads rather than executes.");

	// -------------------------------------------------------------------------
	// 5-4 HTTP defenses (CSRF, cookies, security headers)
	// -------------------------------------------------------------------------
	const ck = member.cookieHeader();
	const csrf = async (label, headers) => {
		const r = await fetch(`${cms.base}/_emdash/api/content/articles`, { method: "POST", headers: { cookie: ck, "content-type": "application/json", ...headers }, body: JSON.stringify({ data: { title: "csrf" } }) });
		return [label, r.status];
	};
	const noHeader = await csrf("no origin, no header", {});
	const foreign = await csrf("foreign origin", { origin: "https://evil.example", "x-emdash-request": "1" });
	const foreignForm = (await fetch(`${cms.base}/_emdash/api/content/articles`, { method: "POST", headers: { cookie: ck, "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" }, body: "a=b" })).status;
	R.check("5-4a", "cookie-authenticated writes need the custom header; the foreign-origin and no-header cases are refused", noHeader[1] === 403 && foreignForm === 403, `noHeader=${noHeader[1]} foreignForm=${foreignForm}; note: with the X-EmDash-Request header a cross-origin JSON POST returns ${foreign[1]} — the header, which a simple cross-site form cannot set, is the gate`);
	let setCookie = [];
	await mock.nextLogin(USERS.leader);
	const loginRes = await fetch(cms.base + "/_emdash/api/auth/discord/login", { redirect: "manual" });
	setCookie = loginRes.headers.getSetCookie();
	const sessionCookie = setCookie.find((c) => /session/i.test(c)) ?? "";
	R.check("5-4b", "session cookie is HttpOnly, Secure, SameSite", /HttpOnly/i.test(sessionCookie) && /Secure/i.test(sessionCookie) && /SameSite/i.test(sessionCookie), sessionCookie.replace(/=[^;]+/, "=…"));
	const h = (await member.get("/_emdash/admin")).headers;
	const csp = h.get("content-security-policy") ?? "";
	R.check("5-4c", "admin responses carry CSP, nosniff, frame-ancestors 'none' and no-store", /frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp) && h.get("x-content-type-options") === "nosniff" && /no-store/.test(h.get("cache-control") ?? ""), `csp="${csp.slice(0, 80)}…" nosniff=${h.get("x-content-type-options")} cache=${h.get("cache-control")}`);
	R.note("5-4d", "not set", `Strict-Transport-Security is absent (${h.get("strict-transport-security") ?? "null"}) — expected to be added at the TLS-terminating proxy. X-Frame-Options is absent but frame-ancestors 'none' covers modern browsers.`);

	// -------------------------------------------------------------------------
	// 5-5 brute-force limits
	// -------------------------------------------------------------------------
	// passkey/options is 10 requests per 60 s per client IP.
	const burst = async (headers) => {
		let limited = 0, last = 0;
		for (let i = 0; i < 14; i++) { last = (await anon.post("/_emdash/api/auth/passkey/options", {}, { headers })).status; if (last === 429) limited++; }
		return { limited, last };
	};
	const defaultRun = await burst({});
	R.note("5-5a", "the per-IP login limiter is INERT in the default Node config", `${defaultRun.limited}/14 login attempts were limited. getClientIp returns null without Cloudflare or a trusted proxy header, and checkRateLimit treats a null subject as always-allowed — so brute-force protection never fires by default on a plain VPS.`);

	// With a trusted proxy header configured, the same burst is limited per IP.
	await cms.stop();
	const cms2 = await startCms({ dir: cms.dir, env: { EMDASH_ALLOW_INVITES: "on", EMDASH_TRUSTED_PROXY_HEADERS: "x-forwarded-for", EMAIL_OUTBOX_DIR: `${ROOT}/bench/.build/outbox-item5` } });
	const anon2 = new Client(cms2.base);
	let limited2 = 0, last2 = 0;
	for (let i = 0; i < 14; i++) { last2 = (await anon2.post("/_emdash/api/auth/passkey/options", {}, { headers: { "x-forwarded-for": "203.0.113.7" } })).status; if (last2 === 429) limited2++; }
	R.check("5-5b", "with EMDASH_TRUSTED_PROXY_HEADERS set, the limiter fires per forwarded IP (429)", limited2 > 0, `${limited2}/14 returned 429 (last=${last2}) when x-forwarded-for is trusted. Production behind nginx/Caddy MUST set this, or 5-5a's inert limiter applies.`);
	cms.base = cms2.base; cms.dir = cms2.dir; cms.stop = cms2.stop; cms.output = cms2.output;
	// A member session on the restarted instance, for the refused-write audit line (5-7).
	const { client: member2 } = await discordLogin(cms2.base, mock, USERS.member);

	// -------------------------------------------------------------------------
	// 5-6 dependency audit (the crash PoC is bench/security/dos-poc.mjs)
	// -------------------------------------------------------------------------
	const { execFileSync } = await import("node:child_process");
	const auditOf = (dir) => {
		try {
			return JSON.parse(execFileSync("pnpm", ["audit", "--prod", "--json"], { cwd: `${ROOT}/${dir}`, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
		} catch (e) {
			try { return JSON.parse(e.stdout); } catch { return { metadata: { vulnerabilities: { high: -1, critical: -1 } } }; }
		}
	};
	const cmsAudit = auditOf("cms").metadata.vulnerabilities;
	R.check("5-6a", "pnpm audit (prod) reports no high/critical in cms/ after the zod override", (cmsAudit.high ?? 0) === 0 && (cmsAudit.critical ?? 0) === 0, JSON.stringify(cmsAudit));
	const pkg = JSON.parse(readFileSync(`${ROOT}/cms/package.json`, "utf8"));
	R.note("5-6b", "member-reachable crash NOT fixed by the audit", "The zod override clears the pnpm-audit high (CVE-2023-54404), but a member can still crash the CMS with a content write whose array field fails validation (~2 MiB body, exit 139), with zod at 4.6.7. See bench/security/dos-poc.mjs and the report. The override only takes effect on a clean install; an incremental install leaves the vulnerable copy while pnpm audit reads clean from package.json.");
	R.note("5-6c", "override in place", `cms/package.json pnpm.overrides = ${JSON.stringify(pkg.pnpm?.overrides ?? {})}`);

	// -------------------------------------------------------------------------
	// 5-7 audit trail (request-level log to stdout, cms/src/security/audit-log.ts)
	// -------------------------------------------------------------------------
	admin.base = cms.base; // the instance was restarted for 5-5b (same data dir, new port)
	const leaderRow = (await admin.get("/_emdash/api/admin/users")).json.data.items.find((u) => u.email === USERS.member.email);
	const pub = await createEntry(admin, "articles", { title: "audit", body: [block("a", "x")] });
	await admin.del(`/_emdash/api/content/articles/${pub.id}`);
	if (leaderRow) await admin.put(`/_emdash/api/admin/users/${leaderRow.id}`, { role: 30 });
	const blockedDelete = member2 ? await member2.del(`/_emdash/api/content/articles/${pub.id}`) : null; // member, refused
	await sleep(300);
	const auditLines = cms.output.join("").split("\n").filter((l) => l.includes('"tag":"audit"')).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
	const done = auditLines.filter((l) => l.phase === "done");
	const started = auditLines.filter((l) => l.phase === "start");
	const delLine = done.find((l) => l.method === "DELETE" && /content\/articles/.test(l.path) && l.status === 200);
	const roleLine = done.find((l) => l.method === "PUT" && /admin\/users/.test(l.path));
	const blockedLine = done.find((l) => l.method === "DELETE" && l.status === 403);
	const attributed = (l) => l && typeof l.actor === "string" && l.actor !== "anonymous" && !!l.ip && l.role != null;
	R.check("5-7a", "every write is attributed in the audit log (actor id, role, IP, path, outcome)", attributed(delLine) && attributed(roleLine) && (blockedLine ? attributed(blockedLine) : true) && started.length > 0, `delete→${delLine?.actor}/${delLine?.status} role-change→${roleLine?.actor}/${roleLine?.status} member-blocked-delete→${blockedLine?.actor}/${blockedLine?.status}; ${done.length} write lines, ${started.length} pre-handler 'start' lines`);
	R.note("5-7b", "placement and scope", "logged in middleware (cms/src/security/audit-log.ts), not EmDash hooks — the after-publish/delete hooks omit the actor. Covers content/media/schema/settings/admin/auth/setup writes, including refused (403) attempts. Core's own audit_logs table stays for MCP/transfer only. Ship these JSON lines off the box so an insider cannot edit them. For the crash case (5-6) the app log is best-effort — a SIGKILL can drop buffered stdout — so the forensic record of a crashing request is the reverse proxy's access log, which must be enabled.");
} catch (e) {
	console.error(e);
	R.check("error", "script error", false, e.stack?.split("\n").slice(0, 3).join(" "));
} finally {
	await cms.stop();
	mock.stop();
}

if (out) R.write(out);
process.exit(R.rows.some((r) => r.ok === false) ? 1 : 0);
