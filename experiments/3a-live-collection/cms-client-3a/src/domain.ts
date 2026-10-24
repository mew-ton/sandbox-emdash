/**
 * Public contract of the boundary package. Nothing in this file may refer to a
 * particular CMS: the site depends on these shapes only.
 */

export type ColorThemeBase = "red" | "orange" | "yellow" | "green" | "blue" | "purple";

export interface Article {
	id: string;
	title: string;
	description: string;
	/** Normalized from a comma-separated value */
	keywords: string[];
	/** Empty string when unset */
	heroImageUrl: string;
	heroImageAlt: string;
	heroImageLabel?: string;
	/** Body rendered to HTML */
	bodyHtml: string;
	themeColor: ColorThemeBase | null;
	/** ISO 8601 */
	publishedAt: string;
	/** ISO 8601 */
	updatedAt: string;
}

export interface CastLink {
	label: string;
	url: string;
}

export interface Cast {
	id: string;
	name: string;
	profile: string;
	/** Empty string when unset */
	avatarUrl: string;
	avatarAlt: string;
	/** Empty string when unset */
	bannerUrl: string;
	bannerAlt: string;
	links: CastLink[];
	themeColor: ColorThemeBase | null;
	/** ISO 8601 */
	publishedAt: string;
	/** ISO 8601 */
	updatedAt: string;
}

export interface ListQuery {
	page?: number;
	perPage?: number;
	/** Field name, prefixed with "-" for descending order (e.g. "-publishedAt") */
	sort?: string;
}

export interface PaginatedResponse<T> {
	items: T[];
	page: number;
	perPage: number;
	totalItems: number;
	totalPages: number;
}

export interface FetchOptions {
	/** CMS origin. Defaults to the CMS_URL environment variable. */
	baseUrl?: string;
	/** Read token. Defaults to the CMS_TOKEN environment variable. */
	token?: string;
	signal?: AbortSignal;
	fetch?: typeof globalThis.fetch;
}

export class CmsError extends Error {
	constructor(
		message: string,
		public readonly status: number,
	) {
		super(message);
		this.name = "CmsError";
	}
}

export class NotFoundError extends CmsError {
	constructor(what: string) {
		super(`${what} not found`, 404);
		this.name = "NotFoundError";
	}
}
