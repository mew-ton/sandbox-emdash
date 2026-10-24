/**
 * Complete the setup wizard in a real browser with a virtual WebAuthn
 * authenticator, creating the first operator (Admin) with a passkey.
 *
 * Returns { browser, context, page, client } where `client` is a Client
 * holding the operator's session cookie.
 */

import { createRequire } from "node:module";

import { Client, inviteUrl, SETUP_TOKEN } from "./lib.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

export async function openBrowserWithAuthenticator() {
	const browser = await chromium.launch();
	const context = await browser.newContext();
	const page = await context.newPage();
	const cdp = await context.newCDPSession(page);
	await cdp.send("WebAuthn.enable");
	const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
		options: {
			protocol: "ctap2",
			transport: "internal",
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true,
		},
	});
	return { browser, context, page, cdp, authenticatorId };
}

export async function clientFromContext(context, base) {
	const client = new Client(base);
	for (const c of await context.cookies(base)) client.cookies.set(c.name, c.value);
	return client;
}

export async function setupAdmin(base, { email = "admin@example.com", name = "Operator", token = SETUP_TOKEN } = {}) {
	const b = await openBrowserWithAuthenticator();
	const { page } = b;
	await page.goto(`${base}/_emdash/admin/setup${token ? `?setup_token=${token}` : ""}`);
	page.setDefaultTimeout(15_000);
	await page.getByLabel("Site Title").fill("Sandbox CMS");
	await page.getByText("Empty site").click();
	await page.getByRole("button", { name: /Continue/ }).click();
	await page.getByLabel("Your Email").fill(email);
	await page.getByLabel("Your Name").fill(name);
	await page.getByRole("button", { name: /Continue/ }).click();
	await page.getByRole("button", { name: "Create passkey" }).click();
	await page.getByText("Passkey created").waitFor();
	return { ...b, client: await clientFromContext(b.context, base) };
}

/**
 * Issue a read-only token whose owner is a Subscriber.
 *
 * API tokens can only be created by an Admin for themselves, and a token is
 * evaluated with its owner's *current* role. So: invite a dedicated service
 * user as Admin, sign in as it once (passkey, in a throwaway browser), create
 * the token, then demote the user to Subscriber. Requires the server to run
 * with EMDASH_ALLOW_INVITES=on while this happens.
 */
export async function createSubscriberToken(base, admin, { email = "site-build@example.com", scopes = ["content:read", "media:read"], outbox } = {}) {
	const inv = await admin.post("/_emdash/api/auth/invite", { email, role: 50 });
	const url = await inviteUrl(inv, outbox, email);
	const b = await openBrowserWithAuthenticator();
	try {
		const { page } = b;
		page.setDefaultTimeout(15_000);
		await page.goto(url);
		await page.getByRole("button", { name: "Create passkey" }).click();
		await page.getByText("Passkey created").waitFor();
		const service = await clientFromContext(b.context, base);
		const me = await service.get("/_emdash/api/auth/me");
		const created = await service.post("/_emdash/api/admin/api-tokens", { name: "site-build", scopes });
		if (created.status !== 201) throw new Error(`token create failed: ${created.status} ${created.text}`);
		const demote = await admin.put(`/_emdash/api/admin/users/${me.json.data.id}`, { role: 10 });
		if (demote.status >= 300) throw new Error(`demote failed: ${demote.status} ${demote.text}`);
		await service.post("/_emdash/api/auth/logout", {});
		return { token: created.json.data.token, userId: me.json.data.id };
	} finally {
		await b.browser.close();
	}
}
