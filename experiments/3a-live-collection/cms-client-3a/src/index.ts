/**
 * Item 3a: the same contract on top of EmDash's live-collection queries.
 * Runs only inside an Astro app that has the EmDash integration and a
 * connection to the CMS database.
 */

import { toHTML } from "@portabletext/to-html";
import { getEmDashCollection, getEmDashEntry } from "emdash";

import type { Article, Cast, CastLink, ColorThemeBase, FetchOptions, ListQuery, PaginatedResponse } from "./domain.js";
import { NotFoundError } from "./domain.js";

export type { Article, Cast, CastLink, ColorThemeBase, FetchOptions, ListQuery, PaginatedResponse } from "./domain.js";
export { CmsError, NotFoundError } from "./domain.js";

type Image = { id: string; src?: string; alt?: string } | undefined;
type Entry = { id: string; data: Record<string, any> };

const THEMES: readonly ColorThemeBase[] = ["red", "orange", "yellow", "green", "blue", "purple"];
const theme = (v: unknown): ColorThemeBase | null => THEMES.find((t) => t === v) ?? null;
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : new Date(String(d)).toISOString());
// The runtime resolves media to a path served by the EmDash app itself.
const url = (img: Image) => (img?.src ? new URL(img.src, process.env.SITE_ORIGIN ?? "http://localhost").toString() : "");

function toArticle(e: Entry): Article {
	const d = e.data;
	const a: Article = {
		id: e.id,
		title: d.title,
		description: d.description ?? "",
		keywords: String(d.keywords ?? "").split(",").map((s) => s.trim()).filter(Boolean),
		heroImageUrl: url(d.hero_image),
		heroImageAlt: d.hero_image?.alt ?? "",
		bodyHtml: d.body ? toHTML(d.body, { onMissingComponent: false }) : "",
		themeColor: theme(d.theme_color),
		publishedAt: iso(d.publishedAt ?? d.createdAt),
		updatedAt: iso(d.updatedAt),
	};
	if (d.hero_image_label) a.heroImageLabel = d.hero_image_label;
	return a;
}

function toCast(e: Entry): Cast {
	const d = e.data;
	const links: CastLink[] = Array.isArray(d.links) ? d.links.filter((l: any) => typeof l?.label === "string" && typeof l?.url === "string") : [];
	return {
		id: e.id,
		name: d.name,
		profile: d.profile ?? "",
		avatarUrl: url(d.avatar),
		avatarAlt: d.avatar?.alt ?? "",
		bannerUrl: url(d.banner),
		bannerAlt: d.banner?.alt ?? "",
		links,
		themeColor: theme(d.theme_color),
		publishedAt: iso(d.publishedAt ?? d.createdAt),
		updatedAt: iso(d.updatedAt),
	};
}

const column: Record<string, string> = { publishedAt: "published_at", updatedAt: "updated_at", title: "title", name: "name" };

async function list<D>(collection: string, q: ListQuery, def: string, map: (e: Entry) => D): Promise<PaginatedResponse<D>> {
	const page = q.page ?? 1;
	const perPage = q.perPage ?? 20;
	const sort = q.sort ?? def;
	const desc = sort.startsWith("-");
	const orderBy = { [column[desc ? sort.slice(1) : sort]!]: desc ? "desc" : "asc" } as const;
	// No total count is returned: count by walking every published entry.
	let totalItems = 0;
	let cursor: string | undefined;
	do {
		const r = await getEmDashCollection(collection, { status: "published", limit: 100, cursor, orderBy });
		totalItems += r.entries.length;
		cursor = r.nextCursor;
	} while (cursor);
	const r = await getEmDashCollection(collection, { status: "published", limit: perPage, offset: (page - 1) * perPage, orderBy });
	return { items: r.entries.map((e) => map(e as Entry)), page, perPage, totalItems, totalPages: Math.ceil(totalItems / perPage) };
}

export function fetchArticles(query: ListQuery = {}, _options?: FetchOptions): Promise<PaginatedResponse<Article>> {
	return list("articles", query, "-publishedAt", toArticle);
}
export async function fetchArticle(id: string, _options?: FetchOptions): Promise<Article> {
	const { entry } = await getEmDashEntry("articles", id);
	if (!entry) throw new NotFoundError(`articles/${id}`);
	return toArticle(entry as Entry);
}
export function fetchCasts(query: ListQuery = {}, _options?: FetchOptions): Promise<PaginatedResponse<Cast>> {
	return list("casts", query, "name", toCast);
}
export async function fetchCast(id: string, _options?: FetchOptions): Promise<Cast> {
	const { entry } = await getEmDashEntry("casts", id);
	if (!entry) throw new NotFoundError(`casts/${id}`);
	return toCast(entry as Entry);
}
