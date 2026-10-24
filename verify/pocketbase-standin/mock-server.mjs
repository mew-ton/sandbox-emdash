/**
 * PocketBase-shaped read API serving a fixed dataset.
 *   node mock-server.mjs <dataset.json> <port>
 * dataset: { token, collections: { articles: [...], casts: [...] }, files: { "<coll>/<id>/<name>": base64 } }
 */

import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const [file, port] = process.argv.slice(2);
const data = JSON.parse(readFileSync(file, "utf8"));

createServer((req, res) => {
	const url = new URL(req.url, "http://x");
	const json = (s, b) => res.writeHead(s, { "content-type": "application/json" }).end(JSON.stringify(b));
	let m = /^\/api\/files\/(.+)$/.exec(url.pathname);
	if (m) {
		const b64 = data.files[m[1]];
		return b64 ? res.writeHead(200, { "content-type": "image/png" }).end(Buffer.from(b64, "base64")) : json(404, {});
	}
	if (req.headers.authorization !== data.token) return json(403, { message: "forbidden" });
	m = /^\/api\/collections\/(\w+)\/records(?:\/(\w+))?$/.exec(url.pathname);
	if (!m || !data.collections[m[1]]) return json(404, {});
	const records = data.collections[m[1]];
	if (m[2]) {
		const r = records.find((x) => x.id === m[2]);
		return r ? json(200, r) : json(404, {});
	}
	const sort = url.searchParams.get("sort") ?? "";
	const desc = sort.startsWith("-");
	const key = desc ? sort.slice(1) : sort;
	const sorted = [...records].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (desc ? -1 : 1));
	const page = Number(url.searchParams.get("page") ?? 1);
	const perPage = Number(url.searchParams.get("perPage") ?? 30);
	json(200, {
		page,
		perPage,
		totalItems: sorted.length,
		totalPages: Math.ceil(sorted.length / perPage),
		items: sorted.slice((page - 1) * perPage, page * perPage),
	});
}).listen(Number(port), "127.0.0.1");
