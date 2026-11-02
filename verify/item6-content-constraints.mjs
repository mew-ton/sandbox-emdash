/**
 * Item 6: the content constraints — fixed pixel dimensions, WebP-only storage
 * and a body limited to what a short self-introduction needs.
 *
 *   node verify/item6-content-constraints.mjs [--out reports/generated/06-content-constraints.md]
 *
 * Runs cms/dist against a throwaway database. No Discord: the operator account
 * is enough, because what is under test is three plugins that gate writes, not
 * who is allowed to make them.
 *
 * The three plugins enforce what cms/seed/seed.json declares, so this asserts
 * against the seed rather than against values repeated here: casts.avatar and
 * casts.banner carry options.width/height, and articles.body carries the four
 * policy axes. A constraint that moved in the seed should fail here, not pass
 * because the test agreed with the plugin.
 *
 * WebP fixtures come from sharp (already present as an EmDash dependency).
 * Using it here does not contradict 6-5: the constraint is that the CMS server
 * does not convert at request or build time, not that no tool may ever encode a
 * WebP.
 */

import { globSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { png } from "./fixtures.mjs";
import { Results, ROOT, startCms } from "./lib.mjs";
import { setupAdmin } from "./setup-admin.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CMS_DIR = join(ROOT, "cms");
const { values: o } = parseArgs({
	options: {
		out: { type: "string", default: join(here, "../reports/generated/06-content-constraints.md") },
		port: { type: "string", default: "4351" },
	},
});

const R = new Results("Item 6: content constraints");

// sharp is a transitive dependency of EmDash, so it is not in cms/node_modules
// under pnpm's layout. Its store directory carries the resolved version and a
// peer hash, which a glob matches without this script pinning either.
const [sharpEntry] = globSync("node_modules/.pnpm/sharp@*/node_modules/sharp/dist/index.cjs", { cwd: CMS_DIR });
if (!sharpEntry) throw new Error("sharp was not found in cms/node_modules/.pnpm — run pnpm install in cms/");
const { default: sharp } = await import(pathToFileURL(join(CMS_DIR, sharpEntry)).href);
const webp = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: "#4455cc" } }).webp().toBuffer();

/** The declared constraints, read from the seed so this cannot drift from it. */
const seed = JSON.parse(readFileSync(join(CMS_DIR, "seed/seed.json"), "utf8"));
const fieldOf = (collection, field) =>
	seed.collections.find((c) => c.slug === collection)?.fields.find((f) => f.slug === field);
const avatar = fieldOf("casts", "avatar");
const body = fieldOf("articles", "body");
const { width: W, height: H } = avatar.options;
const policy = body.options;

/**
 * EmDash resolves the allowlist as `fieldAllowlist ?? GLOBAL_UPLOAD_ALLOWLIST`,
 * and only a form that carries fieldId gets the field's list. Passing it is what
 * separates an upload made from a field in the entry editor from one made on the
 * media page, and the two are gated by different things.
 */
async function uploadAs(client, name, bytes, type, fieldId = null) {
	const fd = new FormData();
	fd.append("file", new Blob([bytes], { type }), name);
	fd.append("alt", `alt of ${name}`);
	if (fieldId) fd.append("fieldId", fieldId);
	return client.request("POST", "/_emdash/api/media", { body: fd });
}

const cms = await startCms({ port: Number(o.port) });
let setup = null;
try {
	setup = await setupAdmin(cms.base);
	const admin = setup.client;

	// ---- 6-3 / 6-4: what may be stored at all -------------------------------
	const pngUpload = await uploadAs(admin, "shot.png", png(64, 48, 1), "image/png");
	const pngRefused = pngUpload.status >= 400;
	R.check(
		"6-3a",
		"a PNG upload is refused on the media page (no fieldId, so EmDash's global allowlist would allow it)",
		pngRefused,
		`status ${pngUpload.status}${pngRefused ? "" : " — a PNG was stored"}`,
	);
	const pngMessage = JSON.stringify(pngUpload.json ?? pngUpload.text ?? "");
	R.check(
		"6-3b",
		"the refusal names the file, says WebP only, and points at the converter page",
		pngUpload.status === 400 && /shot\.png/.test(pngMessage) && /webp/i.test(pngMessage) && /Convert images/i.test(pngMessage),
		`status ${pngUpload.status} ${pngMessage.slice(0, 220)}`,
	);

	// The same PNG through casts.avatar, where the seed's allowedMimeTypes applies.
	const fields = await admin.get("/_emdash/api/schema/collections/casts/fields");
	const avatarId = (fields.json?.data?.items ?? fields.json?.data ?? []).find((f) => f.slug === "avatar")?.id;
	if (!avatarId) {
		R.note("6-3c", "the field path", `could not read casts.avatar's field id: ${JSON.stringify(fields.json).slice(0, 160)}`);
	} else {
		const viaField = await uploadAs(admin, "shot.png", png(64, 48, 1), "image/png", avatarId);
		const detail = JSON.stringify(viaField.json ?? viaField.text ?? "");
		R.check(
			"6-3c",
			"a PNG uploaded from the casts.avatar field is refused by EmDash itself",
			viaField.status === 400 && /INVALID_TYPE/.test(detail),
			`status ${viaField.status} ${detail.slice(0, 160)}`,
		);
	}

	const okUpload = await uploadAs(admin, "cast.webp", await webp(W, H), "image/webp");
	R.check("6-4a", "a WebP upload is accepted", okUpload.status === 201, `status ${okUpload.status}`);
	if (okUpload.status !== 201) throw new Error(`cannot continue without a stored image: ${okUpload.text}`);
	const right = okUpload.json.data.item;

	// ---- 6-2: the accepted image keeps its pixels ---------------------------
	R.check(
		"6-2a",
		`the stored image keeps its ${W}x${H} pixels and stays WebP`,
		right.width === W && right.height === H && /webp/.test(right.mimeType ?? right.mime_type ?? ""),
		`${right.width}x${right.height} ${right.mimeType ?? right.mime_type}`,
	);

	const wrongUpload = await uploadAs(admin, "wrong.webp", await webp(1920, 1080), "image/webp");
	R.check(
		"6-1a",
		"an image of the wrong size can still be stored as media (the gate is on the field, not the library)",
		wrongUpload.status === 201,
		`status ${wrongUpload.status}`,
	);
	const wrong = wrongUpload.status === 201 ? wrongUpload.json.data.item : null;

	// ---- 6-1 / 6-2: the field gate -----------------------------------------
	const saveCast = (name, image) =>
		admin.post("/_emdash/api/content/casts", {
			data: { name, profile: "a short introduction", avatar: image ? { id: image.id, alt: "alt" } : undefined },
		});

	if (wrong) {
		const rejected = await saveCast("Wrong size", wrong);
		const detail = JSON.stringify(rejected.json ?? rejected.text ?? "");
		R.check(
			"6-1b",
			`saving casts.avatar with a 1920x1080 image is refused (declared ${W}x${H})`,
			rejected.status >= 400,
			`status ${rejected.status}`,
		);
		R.check(
			"6-1c",
			"the refusal states the expected and the actual size",
			rejected.status >= 400 && detail.includes(String(W)) && detail.includes("1920"),
			detail.slice(0, 240),
		);
	}

	const accepted = await saveCast("Right size", right);
	R.check(
		"6-2b",
		`saving casts.avatar with a ${W}x${H} image succeeds`,
		accepted.status === 201,
		`status ${accepted.status}${accepted.status === 201 ? "" : ` ${accepted.text}`}`,
	);

	// ---- 6-6 / 6-7: the body policy ----------------------------------------
	const span = (key, text) => ({ _type: "span", _key: `${key}s`, text, marks: [] });
	const para = (key, text, style = "normal") => ({ _type: "block", _key: key, style, markDefs: [], children: [span(key, text)] });

	const allowed = [
		para("p1", "I joined in 2026 and mostly host the quieter evenings."),
		para("h1", "About me", "h2"),
		para("p2", "Ask me about the music.", "normal"),
	];
	const okBody = await admin.post("/_emdash/api/content/articles", {
		data: { title: "Allowed decorations only", body: allowed },
	});
	R.check(
		"6-7a",
		`a body using only ${policy.allowedStyles.join("/")} and ${policy.allowedMarks.join("/")} saves`,
		okBody.status === 201,
		`status ${okBody.status}${okBody.status === 201 ? "" : ` ${okBody.text}`}`,
	);

	// One rejected key per axis, each named by the seed as not allowed.
	const offenders = [
		["6-6a", "a code block", [{ _type: "code", _key: "c1", code: "rm -rf /" }]],
		["6-6b", "a table", [{ _type: "table", _key: "t1", rows: [] }]],
		["6-6c", "raw HTML", [{ _type: "htmlBlock", _key: "h1", html: "<script>alert(1)</script>" }]],
		["6-6d", "an iframe", [{ _type: "iframe", _key: "f1", url: "https://example.com" }]],
		["6-6e", "an h1 heading", [para("x1", "Too big", "h1")]],
		["6-6f", "an underline mark", [{ _type: "block", _key: "u1", style: "normal", markDefs: [], children: [{ _type: "span", _key: "u1s", text: "underlined", marks: ["underline"] }] }]],
	];
	for (const [id, what, blocks] of offenders) {
		const res = await admin.post("/_emdash/api/content/articles", {
			data: { title: `Body with ${what}`, body: [para("ok", "Fine."), ...blocks] },
		});
		const detail = JSON.stringify(res.json ?? res.text ?? "");
		R.check(`${id}`, `a body containing ${what} is refused`, res.status >= 400, `status ${res.status} ${detail.slice(0, 160)}`);
	}

	// ---- 6-5 / 6-8: what this script cannot reach ---------------------------
	R.note(
		"6-5",
		"the converter page",
		"not covered here: it converts in the browser through canvas.toBlob, so it needs a real page. " +
			"Its server cost is nil by construction — the bytes arrive already encoded — but that the page " +
			"converts without resizing is unverified.",
	);
	R.note(
		"6-8",
		"the editor toolbar",
		"not covered here: whether the editor offers decorations that 6-6 then refuses is a DOM question. " +
			"No toolbar CSS is in place yet, so the refusal above is the only thing stopping an editor.",
	);
} finally {
	const markdown = [
		`# 項目 6: コンテンツの制約（寸法・保存形式・本文）`,
		``,
		`実行: ${new Date().toISOString()} / 生成: \`verify/item6-content-constraints.mjs\``,
		``,
		`制約は \`cms/seed/seed.json\` の宣言から読み、スクリプト側に値を持たない。`,
		`casts.avatar = ${W}x${H}、articles.body = ${JSON.stringify(policy)}`,
		``,
		R.markdown(),
		``,
	].join("\n");
	writeFileSync(o.out, markdown);
	console.log(`\nwrote ${o.out}`);
	await setup?.browser.close();
	await cms.stop();
}

process.exit(R.rows.some((r) => r.ok === false) ? 1 : 0);
