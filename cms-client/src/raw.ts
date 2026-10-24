/**
 * Response shapes of the CMS, derived from generated types only.
 *
 *   generated/openapi.ts      ← OpenAPI document (envelope, ContentItem, media list)
 *   generated/collections.ts  ← `emdash types` (per-collection field shapes)
 *
 * The REST API returns field values under `data` and timestamps as strings,
 * while `emdash types` describes the runtime loader object; only the field
 * part of the latter is reused.
 */

import type { Article as ArticleEntry, Cast as CastEntry } from "./generated/collections.js";
import type { components } from "./generated/openapi.js";

type Schemas = components["schemas"];

/** Keys `emdash types` adds next to the user-defined fields. */
type EntryKeys = "id" | "slug" | "status" | "createdAt" | "updatedAt" | "publishedAt" | "byline" | "bylines" | "terms";

export type RawItem<Fields> = Omit<Schemas["ContentItem"], "data"> & { data: Omit<Fields, EntryKeys> };
export type RawArticle = RawItem<ArticleEntry>;
export type RawCast = RawItem<CastEntry>;

export type RawImage = NonNullable<RawArticle["data"]["hero_image"]>;
export type RawPortableText = NonNullable<RawArticle["data"]["body"]>;

export type RawList<T> = Omit<Schemas["ContentListResponse"], "items"> & { items: T[] };
export type RawGet<T> = Omit<Schemas["ContentResponse"], "item"> & { item: T };
export type RawMediaList = Schemas["MediaListReadResponse"];

export interface Envelope<T> {
	success: boolean;
	data?: T;
	error?: { code: string; message: string };
}
