/**
 * cms-client (PocketBase stand-in). Same public surface as the EmDash build.
 */

import type { Article, Cast, CastLink, ColorThemeBase, FetchOptions, ListQuery, PaginatedResponse } from "./domain.js";
import { CmsError, NotFoundError } from "./domain.js";

export type { Article, Cast, CastLink, ColorThemeBase, FetchOptions, ListQuery, PaginatedResponse } from "./domain.js";
export { CmsError, NotFoundError } from "./domain.js";

interface PbList<T> {
	page: number;
	perPage: number;
	totalItems: number;
	totalPages: number;
	items: T[];
}
interface PbBase {
	id: string;
	collectionId: string;
	published_at: string;
	updated: string;
}
interface PbArticle extends PbBase {
	title: string;
	description: string;
	keywords: string;
	hero_image: string;
	hero_image_alt: string;
	hero_image_label: string;
	body: string;
	theme_color: string;
}
interface PbCast extends PbBase {
	name: string;
	profile: string;
	avatar: string;
	avatar_alt: string;
	banner: string;
	banner_alt: string;
	links: unknown;
	theme_color: string;
}

const THEMES: readonly ColorThemeBase[] = ["red", "orange", "yellow", "green", "blue", "purple"];
const theme = (v: string): ColorThemeBase | null => THEMES.find((t) => t === v) ?? null;

function cfg(options: FetchOptions = {}) {
	const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
	const baseUrl = options.baseUrl ?? g.process?.env?.CMS_URL;
	const token = options.token ?? g.process?.env?.CMS_TOKEN;
	if (!baseUrl || !token) throw new CmsError("CMS_URL / CMS_TOKEN are not configured", 0);
	return { baseUrl, token, fetch: options.fetch ?? globalThis.fetch, signal: options.signal };
}

async function get<T>(options: FetchOptions | undefined, path: string, what: string): Promise<T> {
	const c = cfg(options);
	const res = await c.fetch(new URL(path, c.baseUrl), { headers: { Authorization: c.token }, signal: c.signal });
	if (res.status === 404) throw new NotFoundError(what);
	if (!res.ok) throw new CmsError(`${what}: ${res.statusText}`, res.status);
	return (await res.json()) as T;
}

const fileUrl = (options: FetchOptions | undefined, r: PbBase, name: string) =>
	name ? new URL(`/api/files/${r.collectionId}/${r.id}/${name}`, cfg(options).baseUrl).toString() : "";

function toArticle(r: PbArticle, options?: FetchOptions): Article {
	const a: Article = {
		id: r.id,
		title: r.title,
		description: r.description,
		keywords: r.keywords.split(",").map((s) => s.trim()).filter(Boolean),
		heroImageUrl: fileUrl(options, r, r.hero_image),
		heroImageAlt: r.hero_image_alt,
		bodyHtml: r.body.replace(/src="\/api\/files\//g, `src="${new URL("/api/files/", cfg(options).baseUrl)}`),
		themeColor: theme(r.theme_color),
		publishedAt: new Date(r.published_at).toISOString(),
		updatedAt: new Date(r.updated).toISOString(),
	};
	if (r.hero_image_label) a.heroImageLabel = r.hero_image_label;
	return a;
}

function toCast(r: PbCast, options?: FetchOptions): Cast {
	const links: CastLink[] = Array.isArray(r.links)
		? r.links.filter((l): l is CastLink => typeof l?.label === "string" && typeof l?.url === "string")
		: [];
	return {
		id: r.id,
		name: r.name,
		profile: r.profile,
		avatarUrl: fileUrl(options, r, r.avatar),
		avatarAlt: r.avatar_alt,
		bannerUrl: fileUrl(options, r, r.banner),
		bannerAlt: r.banner_alt,
		links,
		themeColor: theme(r.theme_color),
		publishedAt: new Date(r.published_at).toISOString(),
		updatedAt: new Date(r.updated).toISOString(),
	};
}

const pbSort = (sort: string) => sort.replace("publishedAt", "published_at").replace("updatedAt", "updated");

async function list<R, D>(collection: string, q: ListQuery, def: string, options: FetchOptions | undefined, map: (r: R, o?: FetchOptions) => D) {
	const params = new URLSearchParams({ page: String(q.page ?? 1), perPage: String(q.perPage ?? 20), sort: pbSort(q.sort ?? def) });
	const res = await get<PbList<R>>(options, `/api/collections/${collection}/records?${params}`, collection);
	return { ...res, items: res.items.map((r) => map(r, options)) } satisfies PaginatedResponse<D>;
}

export function fetchArticles(query: ListQuery = {}, options?: FetchOptions): Promise<PaginatedResponse<Article>> {
	return list<PbArticle, Article>("articles", query, "-publishedAt", options, toArticle);
}
export async function fetchArticle(id: string, options?: FetchOptions): Promise<Article> {
	return toArticle(await get<PbArticle>(options, `/api/collections/articles/records/${id}`, `articles/${id}`), options);
}
export function fetchCasts(query: ListQuery = {}, options?: FetchOptions): Promise<PaginatedResponse<Cast>> {
	return list<PbCast, Cast>("casts", query, "name", options, toCast);
}
export async function fetchCast(id: string, options?: FetchOptions): Promise<Cast> {
	return toCast(await get<PbCast>(options, `/api/collections/casts/records/${id}`, `casts/${id}`), options);
}
