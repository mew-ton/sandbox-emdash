/**
 * Helpers shared by the verification scripts.
 *
 * Every run starts from an empty instance directory (data.db + uploads) next to
 * the built cms/dist, and a local mock Discord. Nothing talks to real services.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CMS_ENTRY = join(ROOT, "cms/dist/server/entry.mjs");
export const MOCK_ENTRY = join(ROOT, "providers/discord/mock/server.mjs");

export const SETUP_TOKEN = "local-setup-token-0123456789";
export const GUILD_ID = "100000000000000001";
export const ROLE_MEMBER = "300000000000000001";
export const ROLE_LEADER = "300000000000000002";
export const USERS = {
	leader: { id: "200000000000000001", username: "leader", email: "leader@example.com", verified: true, member: true, roles: [ROLE_LEADER] },
	member: { id: "200000000000000002", username: "member", email: "member@example.com", verified: true, member: true, roles: [ROLE_MEMBER] },
	outsider: { id: "200000000000000003", username: "outsider", email: "outsider@example.com", verified: true, member: false, roles: [] },
	norole: { id: "200000000000000004", username: "no-role", email: "norole@example.com", verified: true, member: true, roles: [] },
	operatorEmail: { id: "200000000000000005", username: "imposter", email: "admin@example.com", verified: true, member: true, roles: [ROLE_LEADER] },
};

const MOCK_PORT = 4400;
export const MOCK = `http://127.0.0.1:${MOCK_PORT}`;

/** Generated per process (same format as `emdash secrets generate`); never stored. */
export const ENCRYPTION_KEY = `emdash_enc_v1_${randomBytes(32).toString("base64url")}`;

export function baseEnv(port) {
	return {
		EMDASH_SITE_URL: `http://localhost:${port}`,
		EMDASH_ENCRYPTION_KEY: ENCRYPTION_KEY,
		EMDASH_SETUP_TOKEN: SETUP_TOKEN,
		DISCORD_CLIENT_ID: "mock-client-id",
		DISCORD_CLIENT_SECRET: "mock-client-secret",
		DISCORD_GUILD_ID: GUILD_ID,
		DISCORD_LEADER_ROLE_IDS: ROLE_LEADER,
		DISCORD_MEMBER_ROLE_IDS: ROLE_MEMBER,
		DISCORD_BOT_TOKEN: "mock-bot-token",
		DISCORD_API_BASE: `${MOCK}/api/v10`,
		DISCORD_AUTHORIZE_URL: `${MOCK}/oauth2/authorize`,
	};
}

const children = new Set();
process.on("exit", () => {
	for (const c of children) c.kill("SIGTERM");
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(1));

async function waitFor(url, timeoutMs = 30_000) {
	const end = Date.now() + timeoutMs;
	while (Date.now() < end) {
		try {
			const r = await fetch(url);
			if (r.status < 500) return;
		} catch {}
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error(`timeout waiting for ${url}`);
}

export async function startMockDiscord({ host = "127.0.0.1", port = MOCK_PORT } = {}) {
	const fixture = join(mkdtempSync(join(tmpdir(), "mockdiscord-")), "users.json");
	writeFileSync(fixture, JSON.stringify(Object.values(USERS)));
	const child = spawn(process.execPath, [MOCK_ENTRY], {
		env: { ...process.env, ...baseEnv(0), MOCK_DISCORD_PORT: String(port), MOCK_DISCORD_HOST: host, MOCK_DISCORD_FIXTURE: fixture },
		stdio: ["ignore", "ignore", "inherit"],
	});
	children.add(child);
	const MOCK = `http://127.0.0.1:${port}`;
	await waitFor(`${MOCK}/_mock/state`);
	return {
		base: MOCK,
		stop: () => child.kill("SIGTERM"),
		setUser: (u, patch) =>
			fetch(`${MOCK}/_mock/users/${u.id}`, { method: "PUT", body: JSON.stringify(patch) }).then((r) => r.json()),
		nextLogin: (u) => fetch(`${MOCK}/_mock/next-login`, { method: "POST", body: JSON.stringify({ id: u.id }) }),
		state: () => fetch(`${MOCK}/_mock/state`).then((r) => r.json()),
		resetCounters: () => fetch(`${MOCK}/_mock/reset-counters`, { method: "POST" }),
	};
}

/** Start cms/dist in a fresh instance directory. */
export async function startCms({ port = 4321, env = {}, dir, log = false } = {}) {
	const instanceDir = dir ?? mkdtempSync(join(tmpdir(), "emdash-instance-"));
	mkdirSync(instanceDir, { recursive: true });
	// Mail goes to files (cms/src/plugins/email-outbox.ts) unless the caller overrides it.
	const outbox = env.EMAIL_OUTBOX_DIR ?? join(instanceDir, "outbox");
	const output = [];
	const child = spawn(process.execPath, [CMS_ENTRY], {
		cwd: instanceDir,
		env: { ...process.env, ...baseEnv(port), EMAIL_OUTBOX_DIR: outbox, ...env, HOST: "127.0.0.1", PORT: String(port) },
		stdio: ["ignore", "pipe", "pipe"],
	});
	children.add(child);
	for (const s of [child.stdout, child.stderr]) {
		s.on("data", (d) => {
			output.push(d.toString());
			if (log) process.stderr.write(d);
		});
	}
	const base = `http://localhost:${port}`;
	await waitFor(`${base}/_emdash/api/health`);
	return {
		base,
		dir: instanceDir,
		outbox,
		output,
		pid: child.pid,
		stop: () =>
			new Promise((r) => {
				if (child.exitCode !== null || child.signalCode !== null) return r();
				child.once("exit", r);
				child.kill("SIGTERM");
			}),
	};
}

/** Minimal cookie-keeping HTTP client (one per simulated browser). */
export class Client {
	constructor(base, { bearer } = {}) {
		this.base = base;
		this.cookies = new Map();
		this.bearer = bearer;
	}
	cookieHeader() {
		return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
	}
	store(res) {
		for (const c of res.headers.getSetCookie()) {
			const [pair] = c.split(";");
			const i = pair.indexOf("=");
			const name = pair.slice(0, i).trim();
			const value = pair.slice(i + 1).trim();
			if (/max-age=0|expires=Thu, 01 Jan 1970/i.test(c) || value === "") this.cookies.delete(name);
			else this.cookies.set(name, value);
		}
	}
	async request(method, path, { body, headers = {}, raw = false, follow = false } = {}) {
		let url = path.startsWith("http") ? path : this.base + path;
		const h = { ...headers };
		if (url.startsWith(this.base)) {
			if (this.cookies.size) h.cookie = this.cookieHeader();
			if (this.bearer) h.authorization = `Bearer ${this.bearer}`;
			// EmDash requires this header on state-changing cookie-authenticated requests (CSRF).
			h["x-emdash-request"] = "1";
			h.origin = this.base;
		}
		let payload = body;
		if (body !== undefined && !(body instanceof FormData) && typeof body !== "string" && !(body instanceof Uint8Array)) {
			payload = JSON.stringify(body);
			h["content-type"] = "application/json";
		}
		let res = await fetch(url, { method, headers: h, body: payload, redirect: "manual" });
		if (url.startsWith(this.base)) this.store(res);
		const history = [url];
		while (follow && res.status >= 300 && res.status < 400) {
			url = new URL(res.headers.get("location"), url).toString();
			history.push(url);
			const hh = url.startsWith(this.base) ? { cookie: this.cookieHeader() } : {};
			try {
				res = await fetch(url, { headers: hh, redirect: "manual" });
			} catch (error) {
				// e.g. the mock Discord is stopped: report the unreachable hop
				return { status: 0, error: String(error.cause?.code ?? error), url, history, headers: new Headers() };
			}
			if (url.startsWith(this.base)) this.store(res);
			// keep following through the local mock Discord, stop anywhere else
			if (!url.startsWith(this.base) && !/^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(url)) break;
		}
		if (raw) return res;
		const text = await res.text();
		let json;
		try {
			json = JSON.parse(text);
		} catch {}
		return { status: res.status, json, text, headers: res.headers, url, history };
	}
	get(p, o) {
		return this.request("GET", p, o);
	}
	post(p, body, o = {}) {
		return this.request("POST", p, { ...o, body });
	}
	put(p, body, o = {}) {
		return this.request("PUT", p, { ...o, body });
	}
	patch(p, body, o = {}) {
		return this.request("PATCH", p, { ...o, body });
	}
	del(p, o) {
		return this.request("DELETE", p, o);
	}
}

/** Run the Discord login flow against the mock. Returns { client, finalUrl }. */
export async function discordLogin(base, mock, user) {
	const client = new Client(base);
	await mock.nextLogin(user);
	const res = await client.get("/_emdash/api/auth/discord/login", { follow: true });
	// The error code of a refused login is on the first redirect back to the admin login page.
	const loginHop = res.history.find((u) => u.includes("/_emdash/admin/login?"));
	return { client, finalUrl: loginHop ?? res.url, status: res.status, history: res.history, error: res.error };
}

/** Collects check results and prints a Markdown table. */
export class Results {
	constructor(title) {
		this.title = title;
		this.rows = [];
	}
	check(id, description, ok, detail = "") {
		this.rows.push({ id, description, ok: !!ok, detail });
		console.log(`${ok ? "PASS" : "FAIL"} ${id} ${description}${detail ? ` — ${detail}` : ""}`);
		return !!ok;
	}
	note(id, description, detail) {
		this.rows.push({ id, description, ok: null, detail });
		console.log(`NOTE ${id} ${description} — ${detail}`);
	}
	markdown() {
		const esc = (s) => String(s).replaceAll("|", "\\|").replaceAll("\n", " ");
		return [
			`| # | check | result | detail |`,
			`|---|---|---|---|`,
			...this.rows.map((r) => `| ${r.id} | ${esc(r.description)} | ${r.ok === null ? "note" : r.ok ? "PASS" : "FAIL"} | ${esc(r.detail)} |`),
		].join("\n");
	}
	write(file) {
		writeFileSync(file, `# ${this.title}\n\nGenerated by verify/ on ${new Date().toISOString()}\n\nIds such as \`1-2a\` / \`1-2b\` are sub-checks of requirement \`1-2\` in [docs/requirements.md](../../docs/requirements.md). The human-readable results are in the report one directory up.\n\n${this.markdown()}\n`);
	}
}

/** Most recent mail written to an outbox directory for `to`. */
export function latestMail(outbox, to) {
	let files = [];
	try {
		files = readdirSync(outbox).sort().reverse();
	} catch {}
	for (const f of files) {
		const m = JSON.parse(readFileSync(join(outbox, f), "utf8"));
		if (m.to === to) return m;
	}
	return null;
}

/** Invite URL from the API response, or from the mail when a transport is configured. */
export async function inviteUrl(response, outbox, email) {
	if (response.json?.data?.inviteUrl) return response.json.data.inviteUrl;
	for (let i = 0; i < 20; i++) {
		const m = latestMail(outbox, email);
		const url = /https?:\/\/\S+invite\/accept\?token=[\w-]+/.exec(m?.text ?? "")?.[0];
		if (url) return url;
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error(`no invite for ${email}: ${response.status} ${response.text}`);
}
