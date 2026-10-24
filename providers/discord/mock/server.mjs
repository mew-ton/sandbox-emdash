#!/usr/bin/env node
/**
 * Local stand-in for the parts of Discord the provider calls.
 *
 *   GET  /oauth2/authorize                         consent stand-in (user picker, or auto-approve)
 *   POST /api/v10/oauth2/token                     code → access token (checks client secret + PKCE)
 *   GET  /api/v10/users/@me                        Bearer
 *   GET  /api/v10/users/@me/guilds/:gid/member     Bearer (guilds.members.read)
 *   GET  /api/v10/guilds/:gid/members/:uid         Bot
 *
 * Control endpoints for tests (not part of Discord):
 *   GET  /_mock/state            users, guild members, call counters
 *   PUT  /_mock/users/:id        { username, email, verified, member: bool, roles: [] }
 *   POST /_mock/next-login       { id }  → the next /oauth2/authorize auto-approves as this user
 *   POST /_mock/reset-counters
 *
 * Env: MOCK_DISCORD_PORT (4400), MOCK_DISCORD_HOST (127.0.0.1), DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET,
 *      DISCORD_GUILD_ID, DISCORD_BOT_TOKEN, MOCK_DISCORD_FIXTURE (JSON file of users)
 */

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_DISCORD_PORT ?? 4400);
const CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? "mock-client-id";
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET ?? "mock-client-secret";
const GUILD_ID = process.env.DISCORD_GUILD_ID ?? "100000000000000001";
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN ?? "mock-bot-token";

/** id → { id, username, email, verified, member, roles } */
const users = new Map();
if (process.env.MOCK_DISCORD_FIXTURE) {
	for (const u of JSON.parse(readFileSync(process.env.MOCK_DISCORD_FIXTURE, "utf8"))) users.set(u.id, u);
}
const codes = new Map(); // code → { userId, challenge, redirectUri, scope }
const tokens = new Map(); // access token → { userId, scope }
const counters = {};
let nextLogin = null;

const count = (key) => (counters[key] = (counters[key] ?? 0) + 1);
const json = (res, status, body) => {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
};
const readBody = (req) =>
	new Promise((resolve) => {
		let data = "";
		req.on("data", (c) => (data += c));
		req.on("end", () => resolve(data));
	});
const publicUser = (u) => ({
	id: u.id,
	username: u.username,
	global_name: u.global_name ?? null,
	avatar: null,
	email: u.email ?? null,
	verified: u.verified ?? false,
});
const bearer = (req) => {
	const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
	return m ? tokens.get(m[1]) : undefined;
};

function approve(res, params, userId) {
	const code = randomBytes(16).toString("hex");
	codes.set(code, {
		userId,
		challenge: params.get("code_challenge"),
		redirectUri: params.get("redirect_uri"),
		scope: params.get("scope") ?? "",
	});
	const target = new URL(params.get("redirect_uri"));
	target.searchParams.set("code", code);
	target.searchParams.set("state", params.get("state") ?? "");
	res.writeHead(302, { location: target.toString() });
	res.end();
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url, `http://${req.headers.host}`);
	const path = url.pathname;
	count(`${req.method} ${path.replace(/\d{5,}/g, ":id")}`);

	if (req.method === "GET" && path === "/oauth2/authorize") {
		const p = url.searchParams;
		if (p.get("client_id") !== CLIENT_ID) return json(res, 400, { error: "invalid_client" });
		if (p.get("code_challenge_method") !== "S256" || !p.get("code_challenge")) {
			return json(res, 400, { error: "pkce_required" });
		}
		const pick = url.searchParams.get("as") ?? nextLogin;
		if (pick) {
			nextLogin = null;
			if (pick === "deny") {
				const target = new URL(p.get("redirect_uri"));
				target.searchParams.set("error", "access_denied");
				target.searchParams.set("state", p.get("state") ?? "");
				res.writeHead(302, { location: target.toString() });
				return res.end();
			}
			if (!users.has(pick)) return json(res, 400, { error: "unknown mock user" });
			return approve(res, p, pick);
		}
		const items = [...users.values()]
			.map((u) => {
				const q = new URLSearchParams(p);
				q.set("as", u.id);
				return `<li><a href="/oauth2/authorize?${q}">${u.username}</a> — member: ${u.member}, roles: ${(u.roles ?? []).join(", ") || "none"}</li>`;
			})
			.join("");
		res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		return res.end(`<!doctype html><title>Mock Discord</title><h1>Mock Discord: sign in as</h1><ul>${items}</ul>`);
	}

	if (req.method === "POST" && path === "/api/v10/oauth2/token") {
		const [id, secret] = Buffer.from((req.headers.authorization ?? "").replace(/^Basic /, ""), "base64")
			.toString()
			.split(":");
		if (id !== CLIENT_ID || secret !== CLIENT_SECRET) return json(res, 401, { error: "invalid_client" });
		const form = new URLSearchParams(await readBody(req));
		const grant = codes.get(form.get("code"));
		codes.delete(form.get("code"));
		if (!grant || grant.redirectUri !== form.get("redirect_uri")) return json(res, 400, { error: "invalid_grant" });
		const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
		if (challenge !== grant.challenge) return json(res, 400, { error: "invalid_grant", detail: "pkce" });
		const token = randomBytes(24).toString("hex");
		tokens.set(token, { userId: grant.userId, scope: grant.scope });
		return json(res, 200, { access_token: token, token_type: "Bearer", expires_in: 604800, scope: grant.scope });
	}

	if (req.method === "GET" && path === "/api/v10/users/@me") {
		const t = bearer(req);
		if (!t) return json(res, 401, { message: "401: Unauthorized", code: 0 });
		return json(res, 200, publicUser(users.get(t.userId)));
	}

	let m = /^\/api\/v10\/users\/@me\/guilds\/(\d+)\/member$/.exec(path);
	if (req.method === "GET" && m) {
		const t = bearer(req);
		if (!t) return json(res, 401, { message: "401: Unauthorized", code: 0 });
		if (!t.scope.split(" ").includes("guilds.members.read")) return json(res, 403, { message: "Missing Access", code: 50001 });
		const u = users.get(t.userId);
		if (m[1] !== GUILD_ID || !u?.member) return json(res, 404, { message: "Unknown Guild", code: 10004 });
		return json(res, 200, { roles: u.roles ?? [], nick: u.nick ?? null, user: publicUser(u) });
	}

	m = /^\/api\/v10\/guilds\/(\d+)\/members\/(\d+)$/.exec(path);
	if (req.method === "GET" && m) {
		if (req.headers.authorization !== `Bot ${BOT_TOKEN}`) return json(res, 401, { message: "401: Unauthorized", code: 0 });
		const u = users.get(m[2]);
		if (m[1] !== GUILD_ID || !u?.member) return json(res, 404, { message: "Unknown Member", code: 10007 });
		return json(res, 200, { roles: u.roles ?? [], nick: u.nick ?? null, user: publicUser(u) });
	}

	if (path === "/_mock/state" && req.method === "GET") {
		return json(res, 200, { users: [...users.values()], counters });
	}
	m = /^\/_mock\/users\/(\d+)$/.exec(path);
	if (m && req.method === "PUT") {
		users.set(m[1], { ...(users.get(m[1]) ?? {}), ...JSON.parse(await readBody(req)), id: m[1] });
		return json(res, 200, users.get(m[1]));
	}
	if (path === "/_mock/next-login" && req.method === "POST") {
		nextLogin = JSON.parse(await readBody(req)).id;
		return json(res, 200, { nextLogin });
	}
	if (path === "/_mock/reset-counters" && req.method === "POST") {
		for (const k of Object.keys(counters)) delete counters[k];
		return json(res, 200, {});
	}
	return json(res, 404, { message: "404: Not Found", code: 0 });
});

const HOST = process.env.MOCK_DISCORD_HOST ?? "127.0.0.1";
server.listen(PORT, HOST, () => {
	console.log(`mock discord listening on http://${HOST}:${PORT}`);
});
