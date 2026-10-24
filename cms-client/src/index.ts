/**
 * cms-client: the only connection between the public site and the CMS.
 *
 * The site imports domain types and fetch functions from here. Which CMS sits
 * behind them, its URLs, response shapes and authentication are internal.
 */

import type { Article, Cast, FetchOptions, ListQuery, PaginatedResponse } from "./domain.js";
import { CmsError } from "./domain.js";
import { toArticle, toCast } from "./map.js";
import type { RawArticle, RawCast } from "./raw.js";
import { getEntry, listEntries, mediaIndex, resolve, type ListParams } from "./transport.js";

export type {
	Article,
	Cast,
	CastLink,
	ColorThemeBase,
	FetchOptions,
	ListQuery,
	PaginatedResponse,
} from "./domain.js";
export { CmsError, NotFoundError } from "./domain.js";

const DEFAULT_PER_PAGE = 20;

/** Domain sort keys → CMS fields, per collection. */
const ARTICLE_SORT: Record<string, string> = { publishedAt: "publishedAt", updatedAt: "updatedAt", title: "title" };
const CAST_SORT: Record<string, string> = { publishedAt: "publishedAt", updatedAt: "updatedAt", name: "name" };

function listParams(query: ListQuery, sortKeys: Record<string, string>, defaultSort: string): ListParams {
	const page = query.page ?? 1;
	const perPage = query.perPage ?? DEFAULT_PER_PAGE;
	if (!Number.isInteger(page) || page < 1) throw new CmsError("page must be a positive integer", 0);
	if (!Number.isInteger(perPage) || perPage < 1) throw new CmsError("perPage must be a positive integer", 0);
	const sort = query.sort ?? defaultSort;
	const desc = sort.startsWith("-");
	const field = sortKeys[desc ? sort.slice(1) : sort];
	if (!field) throw new CmsError(`unsupported sort: ${sort}`, 0);
	return { page, perPage, orderBy: field, order: desc ? "desc" : "asc" };
}

async function paginate<R, D>(
	collection: string,
	params: ListParams,
	options: FetchOptions | undefined,
	map: (raw: R, media: Map<string, string>) => D,
): Promise<PaginatedResponse<D>> {
	const r = resolve(options);
	const [list, media] = await Promise.all([listEntries<R>(r, collection, params), mediaIndex(r)]);
	const totalItems = list.total ?? list.items.length;
	return {
		items: list.items.map((raw) => map(raw, media)),
		page: params.page,
		perPage: params.perPage,
		totalItems,
		totalPages: Math.ceil(totalItems / params.perPage),
	};
}

export function fetchArticles(query: ListQuery = {}, options?: FetchOptions): Promise<PaginatedResponse<Article>> {
	return paginate<RawArticle, Article>("articles", listParams(query, ARTICLE_SORT, "-publishedAt"), options, toArticle);
}

export async function fetchArticle(id: string, options?: FetchOptions): Promise<Article> {
	const r = resolve(options);
	const [raw, media] = await Promise.all([getEntry<RawArticle>(r, "articles", id), mediaIndex(r)]);
	return toArticle(raw, media);
}

export function fetchCasts(query: ListQuery = {}, options?: FetchOptions): Promise<PaginatedResponse<Cast>> {
	return paginate<RawCast, Cast>("casts", listParams(query, CAST_SORT, "name"), options, toCast);
}

export async function fetchCast(id: string, options?: FetchOptions): Promise<Cast> {
	const r = resolve(options);
	const [raw, media] = await Promise.all([getEntry<RawCast>(r, "casts", id), mediaIndex(r)]);
	return toCast(raw, media);
}
