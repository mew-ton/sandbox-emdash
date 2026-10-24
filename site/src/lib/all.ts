import { fetchArticles, fetchCasts, type Article, type Cast, type PaginatedResponse } from "cms-client";

export const PER_PAGE = 5;

async function collectAll<T>(fetchPage: (page: number) => Promise<PaginatedResponse<T>>): Promise<T[]> {
	const first = await fetchPage(1);
	const rest = await Promise.all(Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, i) => fetchPage(i + 2)));
	return [first, ...rest].flatMap((p) => p.items);
}

export const allArticles = (): Promise<Article[]> =>
	collectAll((page) => fetchArticles({ page, perPage: 100, sort: "-publishedAt" }));
export const allCasts = (): Promise<Cast[]> => collectAll((page) => fetchCasts({ page, perPage: 100, sort: "name" }));
