/**
 * Content fixtures for item 3 (and the item 4 load scripts).
 *
 * Uploads are WebP. Only WebP reaches the disk on this server (requirement 6-3),
 * enforced by plugins/webp-only and middlewares/webp-upload-message, so fixtures
 * that upload PNG are refused — as they should be. `png()` stays exported for
 * the tests whose subject *is* the refusal (6-3) or a dangerous type (5-3).
 */

import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
const crc = (buf) => {
	let x = 0xffffffff;
	for (const b of buf) x = crcTable[(x ^ b) & 0xff] ^ (x >>> 8);
	return (x ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const td = Buffer.concat([Buffer.from(type), data]);
	const c = Buffer.alloc(4);
	c.writeUInt32BE(crc(td));
	return Buffer.concat([len, td, c]);
};

/** Valid RGB PNG. `noise` makes it incompressible (for size-targeted uploads). */
export function png(w, h, seed = 1, { noise = false } = {}) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr.set([8, 2, 0, 0, 0], 8);
	let state = seed * 2654435761;
	const rnd = () => ((state = (state * 1103515245 + 12345) >>> 0) >>> 16) & 255;
	const rows = [];
	for (let y = 0; y < h; y++) {
		const row = Buffer.alloc(1 + w * 3);
		for (let x = 0; x < w; x++) {
			row.set(noise ? [rnd(), rnd(), rnd()] : [(x * 4 + seed) & 255, (y * 5) & 255, (seed * 40) & 255], 1 + x * 3);
		}
		rows.push(row);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(Buffer.concat(rows), { level: noise ? 0 : 6 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

/**
 * A valid WebP of exactly w x h.
 *
 * sharp is a transitive dependency of EmDash, so pnpm does not put it in
 * cms/node_modules; its store directory carries the resolved version and a peer
 * hash, which this matches without pinning either. Using it here does not
 * contradict 6-5 (no conversion on the CMS server): this is test tooling.
 *
 * `seed` changes the pixels, which matters because EmDash deduplicates media by
 * content hash — fixtures meant to be separate files must not encode alike.
 * `noise` makes the result incompressible, for uploads with a size target.
 */
let sharpModule = null;
export async function webp(w, h, seed = 1, { noise = false } = {}) {
	if (!sharpModule) {
		const cmsDir = join(dirname(fileURLToPath(import.meta.url)), "../cms");
		const [entry] = globSync("node_modules/.pnpm/sharp@*/node_modules/sharp/dist/index.cjs", { cwd: cmsDir });
		if (!entry) throw new Error("sharp was not found in cms/node_modules/.pnpm — run pnpm install in cms/");
		sharpModule = (await import(pathToFileURL(join(cmsDir, entry)).href)).default;
	}
	// xorshift32 with Math.imul, not the LCG png() uses: that one loses precision
	// past 2^53 and degenerates, and png() hid it by deflating at level 0 — the
	// 5 MiB it produced was uncompressed, not incompressible. A lossless WebP
	// encoder has no such switch, so the bytes themselves have to be random.
	let state = Math.imul(seed, 2654435761) | 0 || 1;
	const rnd = () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		state |= 0;
		return (state >>> 24) & 255;
	};
	const raw = Buffer.alloc(w * h * 3);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			raw.set(noise ? [rnd(), rnd(), rnd()] : [(x * 4 + seed) & 255, (y * 5) & 255, (seed * 40) & 255], (y * w + x) * 3);
		}
	}
	// Lossless for the noise case: a lossy encoder would throw the bytes away
	// and with them the file size the caller asked for.
	return sharpModule(raw, { raw: { width: w, height: h, channels: 3 } })
		.webp(noise ? { lossless: true } : { quality: 90 })
		.toBuffer();
}

export async function upload(client, name, bytes, alt = `alt of ${name}`, type = "image/webp") {
	const fd = new FormData();
	fd.append("file", new Blob([bytes], { type }), name);
	fd.append("alt", alt);
	const r = await client.request("POST", "/_emdash/api/media", { body: fd });
	if (r.status !== 201) throw new Error(`upload ${name} failed: ${r.status} ${r.text}`);
	return r.json.data.item;
}

export const block = (key, text, marks = []) => ({
	_type: "block",
	_key: key,
	style: "normal",
	markDefs: [],
	children: [{ _type: "span", _key: `${key}s`, text, marks }],
});

export async function createEntry(client, collection, data, { publish = true } = {}) {
	const r = await client.post(`/_emdash/api/content/${collection}`, { data });
	if (r.status !== 201) throw new Error(`create ${collection} failed: ${r.status} ${r.text}`);
	const item = r.json.data.item;
	if (publish) {
		const p = await client.post(`/_emdash/api/content/${collection}/${item.id}/publish`, {});
		if (p.status !== 200) throw new Error(`publish failed: ${p.status} ${p.text}`);
	}
	return item;
}

/** Articles and casts covering every field conversion the client performs. */
/**
 * The size casts.avatar and casts.banner declare, read from the seed so a change
 * there fails the fixtures rather than silently diverging from them.
 */
export const CAST_IMAGE = (() => {
	const seedPath = join(dirname(fileURLToPath(import.meta.url)), "../cms/seed/seed.json");
	const seed = JSON.parse(readFileSync(seedPath, "utf8"));
	const field = seed.collections.find((c) => c.slug === "casts")?.fields.find((f) => f.slug === "avatar");
	if (!field?.options?.width) throw new Error("casts.avatar has no options.width in cms/seed/seed.json");
	return { width: field.options.width, height: field.options.height };
})();

export async function seedSiteContent(admin) {
	const hero = await upload(admin, "hero.webp", await webp(320, 200, 3), "Hero image alt");
	const inline = await upload(admin, "inline.webp", await webp(160, 100, 5), "Inline image alt");
	// casts.avatar and casts.banner declare options.width/height in seed.json and
	// image-dimensions refuses anything else, so these are the real frame size.
	// articles.hero_image declares none, so hero/inline stay small and cheap.
	const avatar = await upload(admin, "avatar.webp", await webp(CAST_IMAGE.width, CAST_IMAGE.height, 7), "Avatar alt");
	const banner = await upload(admin, "banner.webp", await webp(CAST_IMAGE.width, CAST_IMAGE.height, 9), "Banner alt");
	const articles = [];
	articles.push(
		await createEntry(admin, "articles", {
			title: "Full article",
			description: "Has every field",
			keywords: " alpha, beta ,,gamma ",
			hero_image: { id: hero.id, alt: "Hero image alt" },
			hero_image_label: "Photo: sandbox",
			theme_color: "green",
			body: [
				block("b1", "Hello <world> & friends", ["strong"]),
				{ _type: "image", _key: "img1", asset: { _ref: inline.id }, alt: "Inline image alt" },
				block("b2", "Second paragraph"),
			],
		}),
	);
	for (let i = 2; i <= 12; i++) {
		articles.push(await createEntry(admin, "articles", { title: `Article ${String(i).padStart(2, "0")}`, body: [block("p", `Body ${i}`)] }));
		await new Promise((r) => setTimeout(r, 15));
	}
	await createEntry(admin, "articles", { title: "Unpublished draft", body: [block("p", "secret")] }, { publish: false });
	const casts = [
		await createEntry(admin, "casts", {
			name: "Alice",
			profile: "First cast",
			avatar: { id: avatar.id, alt: "Avatar alt" },
			banner: { id: banner.id, alt: "Banner alt" },
			links: [
				{ label: "Site", url: "https://example.com/alice" },
				{ label: "Bad", url: "javascript:alert(1)" },
				{ nope: true },
			],
			theme_color: "purple",
		}),
		await createEntry(admin, "casts", { name: "Bob", profile: "No images", links: "not-an-array" }),
	];
	return { media: { hero, inline, avatar, banner }, articles, casts };
}
