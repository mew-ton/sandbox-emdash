/**
 * Item 2: Discord login provider, role sync and closing other sign-in paths.
 *
 *   node verify/item2-discord.mjs [--out reports/generated/02-discord-auth.md]
 *
 * Runs cms/dist against the local mock Discord (providers/discord/mock) and
 * restarts the same instance with different environment switches.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client, discordLogin, inviteUrl, Results, startCms, startMockDiscord, USERS, ROLE_LEADER, ROLE_MEMBER, SETUP_TOKEN } from "./lib.mjs";
import { clientFromContext, openBrowserWithAuthenticator, setupAdmin } from "./setup-admin.mjs";

const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
const R = new Results("Item 2 — Discord provider and role sync (generated)");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const outbox = mkdtempSync(join(tmpdir(), "outbox-"));
const REVALIDATE = 2;
const baseEnv = { EMAIL_OUTBOX_DIR: outbox, DISCORD_REVALIDATE_SECONDS: String(REVALIDATE) };

let mock = await startMockDiscord();
let cms = await startCms({ env: baseEnv });
const dir = cms.dir;
const restart = async (env) => {
	await cms.stop();
	cms = await startCms({ dir, env: { ...baseEnv, ...env } });
};
const browsers = [];
const pt = (t) => [{ _type: "block", _key: "k", style: "normal", markDefs: [], children: [{ _type: "span", _key: "s", text: t, marks: [] }] }];
const errorOf = (url) => new URL(url).searchParams.get("error");
const meOf = async (c) => {
	const r = await c.get("/_emdash/api/auth/me");
	return r.status === 200 ? r.json.data : { status: r.status };
};
const userCount = async (admin) => (await admin.get("/_emdash/api/admin/users")).json.data.items.length;

try {
	// -------------------------------------------------------------------------
	// 2-9 setup cannot be taken over
	// -------------------------------------------------------------------------
	const anon = new Client(cms.base);
	const noToken = {
		status: (await anon.get("/_emdash/api/setup/status")).status,
		admin: (await anon.post("/_emdash/api/setup/admin", { email: "attacker@example.com", name: "x" })).status,
		wrongToken: (await anon.post("/_emdash/api/setup/admin?setup_token=guess", { email: "attacker@example.com" })).status,
	};
	const preSetupDiscord = await discordLogin(cms.base, mock, USERS.leader);
	R.check("2-9a", "before setup: setup API refuses requests without EMDASH_SETUP_TOKEN", Object.values(noToken).every((s) => s === 403), JSON.stringify(noToken));
	const preSetupUsers = (await anon.get("/_emdash/api/setup/status?setup_token=" + SETUP_TOKEN)).json?.data;
	const setup = await setupAdmin(cms.base);
	browsers.push(setup.browser);
	const admin = setup.client;
	R.check("2-9c", "with the token the operator completes setup (passkey)", (await meOf(admin)).role === 50, "setup wizard via ?setup_token=… then passkey");
	R.check("2-9b", "before setup: Discord login cannot create the first Admin", errorOf(preSetupDiscord.finalUrl) === "setup_incomplete" && (await userCount(admin)) === 1, `${errorOf(preSetupDiscord.finalUrl)}; users after setup = ${await userCount(admin)} (operator only); status before setup: needsSetup=${preSetupUsers?.needsSetup}`);
	const afterSetup = (await anon.post("/_emdash/api/setup/admin?setup_token=" + SETUP_TOKEN, { email: "late@example.com" })).json;
	R.check("2-9d", "after setup the setup API refuses even with the token", afterSetup?.error?.code === "SETUP_COMPLETE", JSON.stringify(afterSetup?.error));

	// -------------------------------------------------------------------------
	// 2-1 OAuth flow
	// -------------------------------------------------------------------------
	const probe = new Client(cms.base);
	const start = await probe.get("/_emdash/api/auth/discord/login");
	const authz = new URL(start.headers.get("location"));
	R.check(
		"2-1a",
		"login redirects to Discord with code + PKCE (S256) and minimal scopes",
		authz.searchParams.get("response_type") === "code" && authz.searchParams.get("code_challenge_method") === "S256" && authz.searchParams.get("scope") === "identify email guilds.members.read",
		`${authz.origin}${authz.pathname} scope="${authz.searchParams.get("scope")}" pkce=${authz.searchParams.get("code_challenge_method")}`,
	);
	const tampered = await probe.get(`/_emdash/api/auth/discord/callback?code=x&state=forged`, { follow: true });
	R.check("2-1b", "callback with a forged state is rejected", errorOf(tampered.url) === "invalid_state", tampered.url);
	const leaderLogin = await discordLogin(cms.base, mock, USERS.leader);
	const leader = leaderLogin.client;
	const leaderMe = await meOf(leader);
	R.check("2-1c", "guild member completes login and lands in the admin", new URL(leaderLogin.finalUrl).pathname.startsWith("/_emdash/admin") && leaderMe.role === 40, `${leaderLogin.finalUrl} role=${leaderMe.role}`);

	// -------------------------------------------------------------------------
	// 2-2 guild membership is checked in the flow
	// -------------------------------------------------------------------------
	const before = await userCount(admin);
	const outsider = await discordLogin(cms.base, mock, USERS.outsider);
	const norole = await discordLogin(cms.base, mock, USERS.norole);
	R.check("2-2a", "non-member is rejected and no user record is created", errorOf(outsider.finalUrl) === "not_a_member" && (await userCount(admin)) === before, `${errorOf(outsider.finalUrl)}; users ${before}→${await userCount(admin)}`);
	R.check("2-2b", "member without a mapped role is rejected", errorOf(norole.finalUrl) === "no_role", errorOf(norole.finalUrl));
	const memberLogin = await discordLogin(cms.base, mock, USERS.member);
	const member = memberLogin.client;
	R.check("2-2c", "first login of a member auto-creates the user", (await userCount(admin)) === before + 1 && (await meOf(member)).email === USERS.member.email, `users ${before}→${await userCount(admin)}`);
	// existing user who left the guild
	await mock.setUser(USERS.leader, { member: false });
	const leftLogin = await discordLogin(cms.base, mock, USERS.leader);
	R.check("2-2d", "existing user who left the guild cannot log in (user record exists)", errorOf(leftLogin.finalUrl) === "not_a_member", errorOf(leftLogin.finalUrl));
	await mock.setUser(USERS.leader, { member: true });
	const imposter = await discordLogin(cms.base, mock, USERS.operatorEmail);
	R.check("2-2e", "a Discord account using the operator's email is not linked to the operator", errorOf(imposter.finalUrl) === "email_in_use", errorOf(imposter.finalUrl));
	const unverified = { ...USERS.norole, id: "200000000000000009", username: "unverified", email: "unverified@example.com", verified: false, roles: [ROLE_MEMBER] };
	await mock.setUser(unverified, unverified);
	const unv = await discordLogin(cms.base, mock, unverified);
	R.check("2-2f", "Discord account without a verified email is rejected", errorOf(unv.finalUrl) === "email_unverified", errorOf(unv.finalUrl));

	// -------------------------------------------------------------------------
	// 2-4 permission model (API level)
	// -------------------------------------------------------------------------
	const create = async (c, title) => (await c.post("/_emdash/api/content/articles", { data: { title, body: pt(title) } })).json?.data?.item;
	const byAdmin = await create(admin, "Owned by operator");
	const byLeader = await create(leader, "Owned by leader");
	const byMember = await create(member, "Owned by member");
	const edit = async (c, item, title) => {
		const g = await c.get(`/_emdash/api/content/articles/${item.id}`);
		return (await c.put(`/_emdash/api/content/articles/${item.id}`, { data: { title }, _rev: g.json?.data?._rev })).status;
	};
	const m = {
		createOwn: byMember ? 201 : 0,
		editOperators: await edit(member, byAdmin, "edited by member"),
		editLeaders: await edit(member, byLeader, "edited by member"),
		publishOthers: (await member.post(`/_emdash/api/content/articles/${byLeader.id}/publish`, {})).status,
		deleteOthers: (await member.del(`/_emdash/api/content/articles/${byLeader.id}`)).status,
		deleteOwn: (await member.del(`/_emdash/api/content/articles/${byMember.id}`)).status,
		settings: (await member.post("/_emdash/api/settings", { title: "x" })).status,
		users: (await member.get("/_emdash/api/admin/users")).status,
	};
	R.check("2-4a", "member: edits anyone's content, cannot delete (own or others'), no settings", m.createOwn === 201 && m.editOperators === 200 && m.editLeaders === 200 && m.deleteOthers === 403 && m.deleteOwn === 403 && m.settings === 403 && m.users === 403, JSON.stringify(m));
	const fd = new FormData();
	fd.append("file", new Blob([Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;")], { type: "image/gif" }), "m.gif");
	const mediaUp = await member.request("POST", "/_emdash/api/media", { body: fd });
	const mediaDel = mediaUp.status === 201 ? (await member.del(`/_emdash/api/media/${mediaUp.json.data.item.id}`)).status : null;
	R.check("2-4b", "member: can upload media, cannot delete it", mediaUp.status === 201 && mediaDel === 403, `upload=${mediaUp.status} delete=${mediaDel}`);
	const l = {
		editOperators: await edit(leader, byAdmin, "edited by leader"),
		deleteMembers: (await leader.del(`/_emdash/api/content/articles/${byMember.id}`)).status,
		deleteOperators: (await leader.del(`/_emdash/api/content/articles/${byAdmin.id}`)).status,
		permanent: (await leader.del(`/_emdash/api/content/articles/${byAdmin.id}/permanent`)).status,
		settings: (await leader.post("/_emdash/api/settings", { title: "x" })).status,
	};
	R.check("2-4c", "leader: edits and deletes anyone's content (to trash), no settings, no permanent delete", l.editOperators === 200 && l.deleteMembers === 200 && l.deleteOperators === 200 && l.settings === 403 && l.permanent === 403, JSON.stringify(l));
	const a = {
		settings: (await admin.post("/_emdash/api/settings", { title: "Sandbox CMS" })).status,
		restore: (await admin.post(`/_emdash/api/content/articles/${byAdmin.id}/restore`, {})).status,
		delete: (await admin.del(`/_emdash/api/content/articles/${byAdmin.id}`)).status,
		permanent: (await admin.del(`/_emdash/api/content/articles/${byAdmin.id}/permanent`)).status,
	};
	R.check("2-4d", "operator: everything including settings and permanent delete", Object.values(a).every((s) => s === 200), JSON.stringify(a));
	R.check("2-4e", "unauthenticated: no API access", (await anon.get("/_emdash/api/content/articles")).status === 401, "GET /content/articles → 401");

	// -------------------------------------------------------------------------
	// 2-3 role re-evaluated on every login
	// -------------------------------------------------------------------------
	await mock.setUser(USERS.member, { roles: [ROLE_LEADER] });
	const promoted = (await discordLogin(cms.base, mock, USERS.member)).client;
	const promotedTarget = await create(admin, "promotion target");
	const promotedDelete = (await promoted.del(`/_emdash/api/content/articles/${promotedTarget.id}`)).status;
	await mock.setUser(USERS.member, { roles: [ROLE_MEMBER] });
	const demoted = (await discordLogin(cms.base, mock, USERS.member)).client;
	const demotedTarget = await create(admin, "demotion target");
	const demotedDelete = (await demoted.del(`/_emdash/api/content/articles/${demotedTarget.id}`)).status;
	R.check("2-3a", "promotion and demotion in Discord apply at the next login", promotedDelete === 200 && demotedDelete === 403, `after promotion delete=${promotedDelete}; after demotion delete=${demotedDelete}`);
	const memberRow = (await admin.get("/_emdash/api/admin/users")).json.data.items.find((u) => u.email === USERS.member.email);
	R.check("2-3b", "EmDash role is overwritten on login (Editor for both tiers)", memberRow.role === 40, `role=${memberRow.role}`);

	// -------------------------------------------------------------------------
	// 2-6 live sessions: leaving / role change / hard expiry
	// -------------------------------------------------------------------------
	await mock.resetCounters();
	const live = (await discordLogin(cms.base, mock, USERS.member)).client;
	for (let i = 0; i < 20; i++) await live.get("/_emdash/api/content/articles");
	const burst = (await mock.state()).counters;
	const botCallsBurst = burst["GET /api/v10/guilds/:id/members/:id"] ?? 0;
	await sleep(REVALIDATE * 1000 + 500);
	await live.get("/_emdash/api/content/articles");
	const botCallsAfter = (await mock.state()).counters["GET /api/v10/guilds/:id/members/:id"] ?? 0;
	R.check("2-6a", "Discord is re-queried at most once per DISCORD_REVALIDATE_SECONDS per session", botCallsBurst === 0 && botCallsAfter === 1, `20 requests within ${REVALIDATE}s → ${botCallsBurst} bot calls; next request after the interval → ${botCallsAfter}`);
	await mock.setUser(USERS.member, { member: false });
	const t0 = Date.now();
	let leftStatus;
	while (Date.now() - t0 < (REVALIDATE + 3) * 1000) {
		leftStatus = (await live.get("/_emdash/api/content/articles")).status;
		if (leftStatus === 401) break;
		await sleep(200);
	}
	const after = (await live.get("/_emdash/api/content/articles")).status;
	R.check("2-6b", "after leaving the guild the live session is refused within the interval", leftStatus === 401 && after === 401, `refused after ${((Date.now() - t0) / 1000).toFixed(1)}s (interval ${REVALIDATE}s), next request ${after}`);
	await mock.setUser(USERS.member, { member: true });

	const liveLeader = (await discordLogin(cms.base, mock, USERS.leader)).client;
	await mock.setUser(USERS.leader, { roles: [ROLE_MEMBER] });
	await sleep(REVALIDATE * 1000 + 500);
	const target6 = await create(admin, "live demotion target");
	const liveDelete = (await liveLeader.del(`/_emdash/api/content/articles/${target6.id}`)).status;
	R.check("2-6c", "demotion applies to a live session at the next re-check", liveDelete === 403, `leader demoted in Discord → DELETE ${liveDelete}`);
	await mock.setUser(USERS.leader, { roles: [ROLE_LEADER] });

	// Discord outage while signed in: session survives until hard expiry
	mock.stop();
	await sleep(REVALIDATE * 1000 + 500);
	const duringOutage = (await liveLeader.get("/_emdash/api/content/articles")).status;
	R.check("2-6d", "Discord API outage does not log members out (until the hard expiry)", duringOutage === 200, `status during outage ${duringOutage}`);

	// -------------------------------------------------------------------------
	// 2-8 operator path with Discord down
	// -------------------------------------------------------------------------
	const discordDown = await discordLogin(cms.base, mock, USERS.leader).catch((e) => ({ error: String(e) }));
	await setup.page.goto(`${cms.base}/_emdash/admin`);
	await admin.post("/_emdash/api/auth/logout", {});
	await setup.context.clearCookies();
	await setup.page.goto(`${cms.base}/_emdash/admin/login`);
	await setup.page.getByRole("button", { name: /Sign in with Passkey/i }).click();
	await setup.page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 15_000 });
	const opAgain = await clientFromContext(setup.context, cms.base);
	R.check("2-8a", "operator signs in with a passkey while Discord is unreachable", (await meOf(opAgain)).role === 50, `Discord login while down: ${discordDown.error ?? discordDown.finalUrl}`);
	mock = await startMockDiscord();

	// -------------------------------------------------------------------------
	// 2-5 other sign-in paths are closed for members
	// -------------------------------------------------------------------------
	const fresh = (await discordLogin(cms.base, mock, USERS.member)).client;
	const closed = {
		passkeyRegisterOptions: (await fresh.post("/_emdash/api/auth/passkey/register/options", {})).status,
		magicLinkSend: (await anon.post("/_emdash/api/auth/magic-link/send", { email: USERS.member.email })).status,
		magicLinkVerify: (await anon.get("/_emdash/api/auth/magic-link/verify?token=x")).status,
		signup: (await anon.post("/_emdash/api/auth/signup/request", { email: "new@example.com" })).status,
		builtinOAuth: (await anon.get("/_emdash/api/auth/oauth/github")).status,
		inviteAccept: (await anon.get("/_emdash/api/auth/invite/accept?token=x")).status,
		handover: (await fresh.post("/_emdash/api/auth/handover", {})).status,
		deviceAuthorize: (await fresh.post("/_emdash/api/oauth/device/authorize", { user_code: "ABCD-EFGH" })).status,
		apiTokens: (await fresh.post("/_emdash/api/admin/api-tokens", { name: "x", scopes: ["content:read"] })).status,
	};
	R.check(
		"2-5a",
		"member cannot register a passkey, use magic link/signup/built-in OAuth/invites, or obtain tokens",
		closed.passkeyRegisterOptions === 403 && closed.magicLinkSend === 403 && closed.magicLinkVerify === 403 && closed.signup === 403 && closed.builtinOAuth === 403 && closed.inviteAccept === 403 && closed.handover === 403 && closed.deviceAuthorize === 403 && closed.apiTokens === 403,
		JSON.stringify(closed),
	);
	const opRegister = (await opAgain.post("/_emdash/api/auth/passkey/register/options", {})).status;
	R.check("2-8b", "operator can still add passkeys", opRegister === 200, `register/options → ${opRegister}`);

	// A non-operator that somehow holds a passkey (created while Admin, then demoted) cannot use it.
	await restart({ EMDASH_ALLOW_INVITES: "on" });
	const inv = await opAgain.post("/_emdash/api/auth/invite", { email: "former-operator@example.com", role: 50 });
	// With an email transport configured the invite is mailed instead of returned.
	const formerInvite = await inviteUrl(inv, outbox, "former-operator@example.com");
	const sb = await openBrowserWithAuthenticator();
	browsers.push(sb.browser);
	sb.page.setDefaultTimeout(15_000);
	await sb.page.goto(formerInvite);
	await sb.page.getByRole("button", { name: "Create passkey" }).click();
	await sb.page.getByText("Passkey created").waitFor();
	const formerId = (await meOf(await clientFromContext(sb.context, cms.base))).id;
	await opAgain.put(`/_emdash/api/admin/users/${formerId}`, { role: 40 });
	await restart({});
	await sb.context.clearCookies();
	await sb.page.goto(`${cms.base}/_emdash/admin/login`);
	await sb.page.getByRole("button", { name: /Sign in with Passkey/i }).click();
	await sleep(3000);
	const formerMe = await meOf(await clientFromContext(sb.context, cms.base));
	R.check("2-5b", "passkey sign-in by a non-operator is refused server-side (session destroyed)", formerMe.status === 401, `former operator (now Editor) passkey sign-in → /auth/me ${formerMe.status ?? formerMe.role}`);
	const inv2 = await opAgain.post("/_emdash/api/auth/invite", { email: "x@example.com", role: 30 });
	const inviteToken = new URL(await inviteUrl(inv2, outbox, "x@example.com")).searchParams.get("token");
	const inviteClosed = (await anon.get(`/_emdash/api/auth/invite/accept?token=${inviteToken}`)).status;
	R.check("2-5c", "a valid invite cannot be accepted while EMDASH_ALLOW_INVITES is off", inviteClosed === 403, `accept → ${inviteClosed}`);

	// -------------------------------------------------------------------------
	// 2-7 cold standby (magic link)
	// -------------------------------------------------------------------------
	for (const f of readdirSync(outbox)) rmSync(join(outbox, f));
	await restart({ EMDASH_COLD_STANDBY: "on" });
	const standby = new Client(cms.base);
	const send = await standby.post("/_emdash/api/auth/magic-link/send", { email: USERS.member.email });
	await sleep(500);
	const mail = readdirSync(outbox).map((f) => JSON.parse(readFileSync(join(outbox, f), "utf8")))[0];
	const link = /https?:\/\/\S+magic-link\/verify\?token=\S+/.exec(mail?.text ?? "")?.[0];
	// The emailed GET link opens a confirmation page, which POSTs the token.
	const linkToken = link ? new URL(link).searchParams.get("token") : null;
	const verify = linkToken ? await standby.post("/_emdash/api/auth/magic-link/verify", { token: linkToken }) : null;
	const standbyMe = await meOf(standby);
	const standbyDelete = (await standby.del(`/_emdash/api/content/articles/${(await create(opAgain, "standby target")).id}`)).status;
	R.check("2-7a", "EMDASH_COLD_STANDBY=on + restart: member signs in by magic link", send.status === 200 && !!link && standbyMe.email === USERS.member.email, `send=${send.status} mail=${!!mail} verify=${verify?.status} me=${standbyMe.email ?? standbyMe.status}`);
	R.check("2-7b", "cold-standby sessions keep the member restrictions (no delete)", standbyDelete === 403, `DELETE → ${standbyDelete}`);
	await restart({});
	const afterStandby = {
		session: (await standby.get("/_emdash/api/content/articles")).status,
		send: (await new Client(cms.base).post("/_emdash/api/auth/magic-link/send", { email: USERS.member.email })).status,
	};
	R.check("2-7c", "switching back off + restart: magic link refused and standby sessions end", afterStandby.session === 401 && afterStandby.send === 403, JSON.stringify(afterStandby));

	// hard expiry without a bot token
	await restart({ DISCORD_BOT_TOKEN: "", DISCORD_SESSION_MAX_AGE_SECONDS: "3" });
	const short = (await discordLogin(cms.base, mock, USERS.member)).client;
	const s1 = (await short.get("/_emdash/api/content/articles")).status;
	await sleep(3500);
	const s2 = (await short.get("/_emdash/api/content/articles")).status;
	R.check("2-6e", "without a bot token, sessions end at DISCORD_SESSION_MAX_AGE_SECONDS", s1 === 200 && s2 === 401, `${s1} → after 3.5s ${s2}`);
} catch (e) {
	console.error(e);
	R.check("error", "script error", false, e.stack?.split("\n").slice(0, 3).join(" "));
} finally {
	for (const b of browsers) await b.close().catch(() => {});
	await cms.stop();
	mock.stop();
}

if (out) R.write(out);
process.exit(R.rows.some((r) => r.ok === false) ? 1 : 0);
