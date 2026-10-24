/**
 * HTTP access to the CMS read API. Paths and authentication live here only.
 */

import { CmsError, NotFoundError, type FetchOptions } from "./domain.js";
import type { Envelope, RawGet, RawList, RawMediaList } from "./raw.js";

const API = "/_emdash/api";
const MAX_PAGE_SIZE = 100;

export interface Resolved {
	baseUrl: string;
	token: string;
	fetch: typeof globalThis.fetch;
	signal?: AbortSignal;
}

function env(name: string): string | undefined {
	const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
	return g.process?.env?.[name];
}

export function resolve(options: FetchOptions = {}): Resolved {
	const baseUrl = options.baseUrl ?? env("CMS_URL");
	const token = options.token ?? env("CMS_TOKEN");
	if (!baseUrl) throw new CmsError("CMS base URL is not configured (CMS_URL)", 0);
	if (!token) throw new CmsError("CMS token is not configured (CMS_TOKEN)", 0);
	return { baseUrl, token, fetch: options.fetch ?? globalThis.fetch, signal: options.signal };
}

async function get<T>(r: Resolved, path: string, what: string): Promise<T> {
	const res = await r.fetch(new URL(API + path, r.baseUrl), {
		headers: { Authorization: `Bearer ${r.token}`, Accept: "application/json" },
		signal: r.signal,
	});
	if (res.status === 404) throw new NotFoundError(what);
	const body = (await res.json().catch(() => null)) as Envelope<T> | null;
	if (!res.ok || !body?.success || body.data === undefined) {
		throw new CmsError(`${what}: ${body?.error?.message ?? res.statusText}`, res.status);
	}
	return body.data;
}

export interface ListParams {
	page: number;
	perPage: number;
	orderBy?: string;
	order?: "asc" | "desc";
}

export function listEntries<T>(r: Resolved, collection: string, p: ListParams): Promise<RawList<T>> {
	if (p.perPage > MAX_PAGE_SIZE) throw new CmsError(`perPage must be ≤ ${MAX_PAGE_SIZE}`, 0);
	const q = new URLSearchParams({ status: "published", page: String(p.page), limit: String(p.perPage) });
	if (p.orderBy) q.set("orderBy", p.orderBy);
	if (p.order) q.set("order", p.order);
	return get<RawList<T>>(r, `/content/${collection}?${q}`, collection);
}

export async function getEntry<T extends { status: string }>(r: Resolved, collection: string, id: string): Promise<T> {
	const what = `${collection}/${id}`;
	const data = await get<RawGet<T>>(r, `/content/${collection}/${encodeURIComponent(id)}`, what);
	// A read token owned by a Subscriber never sees unpublished entries; this
	// guards against a token with a wider role being configured by mistake.
	if (data.item.status !== "published") throw new NotFoundError(what);
	return data.item;
}

/** Media id → absolute file URL, read once per base URL and token. */
const mediaIndexes = new Map<string, Promise<Map<string, string>>>();

export function mediaIndex(r: Resolved): Promise<Map<string, string>> {
	const key = `${r.baseUrl}\u0000${r.token}`;
	let index = mediaIndexes.get(key);
	if (!index) {
		index = (async () => {
			const map = new Map<string, string>();
			let cursor: string | undefined;
			do {
				const q = new URLSearchParams({ limit: String(MAX_PAGE_SIZE) });
				if (cursor) q.set("cursor", cursor);
				const page = await get<RawMediaList>(r, `/media?${q}`, "media");
				for (const m of page.items) if (m.url) map.set(m.id, new URL(m.url, r.baseUrl).toString());
				cursor = page.nextCursor;
			} while (cursor);
			return map;
		})();
		index.catch(() => mediaIndexes.delete(key));
		mediaIndexes.set(key, index);
	}
	return index;
}
