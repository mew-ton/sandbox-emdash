/**
 * Item 1-7: move everything to another instance through the write API.
 *
 *   node verify/item1-transfer.mjs [--out reports/generated/01-7-transfer.md]
 *
 * 1-7 asks for a means of moving data, not for `emdash site export` to work —
 * that command refuses an import target that is not empty, and a seed with
 * relations in it is never empty (reports/01-headless.md). Re-pushing through
 * the API is the other route, and this is the run that shows it end to end:
 * two throwaway instances, read from one, write to the other, then compare.
 *
 * What has to survive is what a public site is built from: the slug, the
 * publish and creation dates, the reference links between entries, and the
 * image bytes. What does not survive is listed in the report rather than
 * discovered later — entry ids are reassigned, revision history does not come
 * along, and every entry ends up attributed to whoever ran the migration.
 *
 * A real migration reads from the old CMS instead of from EmDash. The shape of
 * the write side is the same, which is the part in question here.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { Results, startCms } from "./lib.mjs";
import { setupAdmin } from "./setup-admin.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { values: o } = parseArgs({
	options: {
		out: { type: "string", default: join(here, "../reports/generated/01-7-transfer.md") },
		"port-source": { type: "string", default: "4361" },
		"port-target": { type: "string", default: "4362" },
	},
});

const R = new Results("Item 1-7: transfer through the write API");
const log = [];
const say = (line) => {
	log.push(line);
	console.log(`  ${line}`);
};

/** A WebP of the exact size casts.avatar declares, so the gates let it through. */
async function webp(width, height) {
	const { globSync } = await import("node:fs");
	const { pathToFileURL } = await import("node:url");
	const cmsDir = join(here, "../cms");
	const [entry] = globSync("node_modules/.pnpm/sharp@*/node_modules/sharp/dist/index.cjs", { cwd: cmsDir });
	if (!entry) throw new Error("sharp was not found in cms/node_modules/.pnpm");
	const { default: sharp } = await import(pathToFileURL(join(cmsDir, entry)).href);
	return sharp({ create: { width, height, channels: 3, background: "#2f6f4f" } }).webp().toBuffer();
}

async function upload(client, name, bytes) {
	const fd = new FormData();
	fd.append("file", new Blob([bytes], { type: "image/webp" }), name);
	fd.append("alt", `alt of ${name}`);
	const r = await client.request("POST", "/_emdash/api/media", { body: fd });
	if (r.status !== 201) throw new Error(`upload ${name}: ${r.status} ${r.text}`);
	return r.json.data.item;
}

const source = await startCms({ port: Number(o["port-source"]) });
const target = await startCms({ port: Number(o["port-target"]) });
let srcSetup = null;
let dstSetup = null;
try {
	srcSetup = await setupAdmin(source.base);
	dstSetup = await setupAdmin(target.base);
	const src = srcSetup.client;
	const dst = dstSetup.client;

	// ---- build something worth moving on the source ------------------------
	say("### 移行元を作る");
	const avatar = await upload(src, "cast.webp", await webp(3840, 2160));
	say(`メディア 1 件: ${avatar.filename} (${avatar.width}x${avatar.height}, ${avatar.size} bytes)`);

	const wanted = {
		slug: "a-cast-introduction",
		publishedAt: "2024-03-15T09:00:00.000Z",
		createdAt: "2023-12-01T04:30:00.000Z",
	};
	const madeArticle = await src.post("/_emdash/api/content/articles", {
		data: { title: "移行する記事", body: [{ _type: "block", _key: "b1", style: "h2", markDefs: [], children: [{ _type: "span", _key: "b1s", text: "見出し", marks: [] }] }] },
		slug: wanted.slug,
		publishedAt: wanted.publishedAt,
		createdAt: wanted.createdAt,
	});
	R.check("1-7d", "移行元で slug と日付を指定して記事を作れる", madeArticle.status === 201, `status ${madeArticle.status} ${madeArticle.status === 201 ? "" : madeArticle.text}`);
	if (madeArticle.status !== 201) throw new Error("cannot continue");
	const srcArticle = madeArticle.json.data.item;
	say(`記事: id=${srcArticle.id} slug=${srcArticle.slug} publishedAt=${srcArticle.publishedAt} createdAt=${srcArticle.createdAt}`);

	const madeCast = await src.post("/_emdash/api/content/casts", {
		data: { name: "移行するキャスト", profile: "短い自己紹介", avatar: { id: avatar.id, alt: "alt" } },
		slug: "a-cast",
	});
	if (madeCast.status !== 201) throw new Error(`cast: ${madeCast.status} ${madeCast.text}`);
	const srcCast = madeCast.json.data.item;
	say(`キャスト: id=${srcCast.id} slug=${srcCast.slug}`);

	// metadata points at the article, which is what `site export` chokes on.
	const madeMeta = await src.post("/_emdash/api/content/metadata", {
		data: { links: [{ label: "Site", url: "https://example.com" }] },
		references: { join_guide: [srcArticle.id] },
	});
	const metaOk = madeMeta.status === 201;
	R.check("1-7e", "references でリレーションを張れる（metadata → articles）", metaOk, `status ${madeMeta.status} ${metaOk ? "" : madeMeta.text}`);
	const srcMeta = metaOk ? madeMeta.json.data.item : null;

	// ---- read the source, exactly as a migration script would --------------
	say("");
	say("### 移行元を読む");
	// No status filter: a migration moves drafts and scheduled entries too, and
	// setting publishedAt does not publish an entry — it stays a draft, so
	// filtering by published here would have read nothing.
	const readArticles = await src.get("/_emdash/api/content/articles?limit=100");
	const readCasts = await src.get("/_emdash/api/content/casts?limit=100");
	const readMedia = await src.get("/_emdash/api/media?limit=100");
	const srcMediaItem = readMedia.json.data.items.find((m) => m.id === avatar.id);
	say(`記事 ${readArticles.json.data.items.length} 件 / キャスト ${readCasts.json.data.items.length} 件 / メディア ${readMedia.json.data.items.length} 件`);
	R.check("1-7c", "移行元の読み出しが全ステータスを返す", readArticles.json.data.items.length > 0, `記事 ${readArticles.json.data.items.length} 件`);

	const bytesRes = await fetch(new URL(srcMediaItem.url, source.base));
	const srcBytes = Buffer.from(await bytesRes.arrayBuffer());
	say(`画像を取得: ${srcMediaItem.url} → ${bytesRes.status}, ${srcBytes.length} bytes`);

	// ---- write into the target ---------------------------------------------
	say("");
	say("### 移行先へ書く");
	const newAvatar = await upload(dst, srcMediaItem.filename, srcBytes);
	say(`メディア: ${srcMediaItem.id} → ${newAvatar.id}`);
	R.check(
		"1-7f",
		"画像がバイト単位で同じまま移る",
		newAvatar.size === srcMediaItem.size && newAvatar.width === srcMediaItem.width && newAvatar.height === srcMediaItem.height,
		`${srcMediaItem.size}→${newAvatar.size} bytes, ${srcMediaItem.width}x${srcMediaItem.height}→${newAvatar.width}x${newAvatar.height}`,
	);

	// Entries that others point at go first, so the ids exist when references
	// are written. A real migration needs the same ordering.
	const idMap = new Map();
	const movedArticle = await dst.post("/_emdash/api/content/articles", {
		data: readArticles.json.data.items[0].data,
		slug: readArticles.json.data.items[0].slug,
		publishedAt: readArticles.json.data.items[0].publishedAt,
		createdAt: readArticles.json.data.items[0].createdAt,
	});
	if (movedArticle.status !== 201) throw new Error(`article: ${movedArticle.status} ${movedArticle.text}`);
	const dstArticle = movedArticle.json.data.item;
	idMap.set(srcArticle.id, dstArticle.id);
	say(`記事: ${srcArticle.id} → ${dstArticle.id}`);

	const srcCastRead = readCasts.json.data.items[0];
	const movedCast = await dst.post("/_emdash/api/content/casts", {
		data: { ...srcCastRead.data, avatar: { id: newAvatar.id, alt: srcCastRead.data.avatar?.alt ?? "alt" } },
		slug: srcCastRead.slug,
		publishedAt: srcCastRead.publishedAt,
		createdAt: srcCastRead.createdAt,
	});
	R.check("1-7g", "画像フィールドを新しいメディア id に差し替えて保存できる", movedCast.status === 201, `status ${movedCast.status} ${movedCast.status === 201 ? "" : movedCast.text}`);

	let dstMeta = null;
	if (srcMeta) {
		const movedMeta = await dst.post("/_emdash/api/content/metadata", {
			data: { links: [{ label: "Site", url: "https://example.com" }] },
			references: { join_guide: [idMap.get(srcArticle.id)] },
		});
		R.check("1-7h", "リレーションを新しい id に張り替えて移せる", movedMeta.status === 201, `status ${movedMeta.status} ${movedMeta.status === 201 ? "" : movedMeta.text}`);
		dstMeta = movedMeta.status === 201 ? movedMeta.json.data.item : null;
	}

	// ---- compare -----------------------------------------------------------
	say("");
	say("### 突き合わせ");
	const after = await dst.get(`/_emdash/api/content/articles/${dstArticle.id}`);
	const moved = after.json.data.item;
	say(`移行先の記事: slug=${moved.slug} publishedAt=${moved.publishedAt} createdAt=${moved.createdAt}`);

	R.check("1-7i", "slug が一致する", moved.slug === wanted.slug, `${wanted.slug} → ${moved.slug}`);
	R.check(
		"1-7j",
		"publishedAt が一致する",
		Date.parse(moved.publishedAt) === Date.parse(wanted.publishedAt),
		`${wanted.publishedAt} → ${moved.publishedAt}`,
	);
	R.check(
		"1-7k",
		"createdAt が一致する",
		Date.parse(moved.createdAt) === Date.parse(wanted.createdAt),
		`${wanted.createdAt} → ${moved.createdAt}`,
	);

	if (dstMeta) {
		const metaAfter = await dst.get(`/_emdash/api/content/metadata/${dstMeta.id}`);
		const refs = JSON.stringify(metaAfter.json?.data?.item ?? {});
		R.check("1-7l", "移行先でリレーションが引ける", refs.includes(dstArticle.id), refs.slice(0, 200));
	}

	const dstBytesRes = await fetch(new URL(newAvatar.url, target.base));
	const dstBytes = Buffer.from(await dstBytesRes.arrayBuffer());
	R.check("1-7m", "移行先の画像が元とバイト一致", Buffer.compare(srcBytes, dstBytes) === 0, `${srcBytes.length} vs ${dstBytes.length} bytes`);

	R.check("1-7n", "エントリ id は振り直される（移行では保てない）", srcArticle.id !== dstArticle.id, `${srcArticle.id} → ${dstArticle.id}`);
	R.note("1-7o", "リビジョン履歴", "移らない。移行先では投入 1 回分だけの履歴になる。");
	R.note("1-7p", "執筆者の帰属", "全件が実行アカウントの作成物になる。API に authorId は無い。執筆者を画面に出さない方針（項目 6）なので実害はない。");
} finally {
	writeFileSync(
		o.out,
		[
			"# 項目 1-7: 書き込み API への詰め替え",
			"",
			`実行: ${new Date().toISOString()} / 生成: \`verify/item1-transfer.mjs\``,
			"",
			"空の 2 インスタンス間で、移行元を作り、API で読み、移行先へ書き、突き合わせた記録。",
			"",
			"## ログ",
			"",
			"```",
			...log,
			"```",
			"",
			"## 判定",
			"",
			R.markdown(),
			"",
		].join("\n"),
	);
	console.log(`\nwrote ${o.out}`);
	await srcSetup?.browser.close();
	await dstSetup?.browser.close();
	await source.stop();
	await target.stop();
}

process.exit(R.rows.some((r) => r.ok === false) ? 1 : 0);
