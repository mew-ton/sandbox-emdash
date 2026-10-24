/**
 * Raw (CMS response) → Domain conversion.
 */

import { toHTML, uriLooksSafe } from "@portabletext/to-html";

import type { Article, Cast, CastLink, ColorThemeBase } from "./domain.js";
import type { RawArticle, RawCast, RawImage, RawPortableText } from "./raw.js";

const THEMES: readonly ColorThemeBase[] = ["red", "orange", "yellow", "green", "blue", "purple"];

export function toTheme(value: string | undefined | null): ColorThemeBase | null {
	return THEMES.find((t) => t === value) ?? null;
}

export function toKeywords(value: string | undefined | null): string[] {
	return (value ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

export function toIso(value: string | null | undefined, fallback: string): string {
	const d = new Date(value ?? fallback);
	return Number.isNaN(d.getTime()) ? new Date(fallback).toISOString() : d.toISOString();
}

export type MediaUrls = Map<string, string>;

function imageUrl(media: MediaUrls, image: RawImage | undefined): string {
	if (!image?.id) return "";
	return media.get(image.id) ?? "";
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

interface PortableImage {
	_type: "image";
	asset?: { _ref?: string; url?: string };
	alt?: string;
}

export function toHtml(blocks: RawPortableText | undefined, media: MediaUrls): string {
	if (!blocks || blocks.length === 0) return "";
	return toHTML(blocks, {
		components: {
			types: {
				image: ({ value }: { value: PortableImage }) => {
					const ref = value.asset?._ref;
					const src = (ref && media.get(ref)) || "";
					if (!src || !uriLooksSafe(src)) return "";
					return `<img src="${escapeAttr(src)}" alt="${escapeAttr(value.alt ?? "")}">`;
				},
			},
		},
		onMissingComponent: false,
	});
}

function toLinks(value: unknown): CastLink[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((v): CastLink[] => {
		if (typeof v !== "object" || v === null) return [];
		const { label, url } = v as Record<string, unknown>;
		return typeof label === "string" && typeof url === "string" && uriLooksSafe(url) ? [{ label, url }] : [];
	});
}

export function toArticle(raw: RawArticle, media: MediaUrls): Article {
	const d = raw.data;
	const article: Article = {
		id: raw.id,
		title: d.title,
		description: d.description ?? "",
		keywords: toKeywords(d.keywords),
		heroImageUrl: imageUrl(media, d.hero_image),
		heroImageAlt: d.hero_image?.alt ?? "",
		bodyHtml: toHtml(d.body, media),
		themeColor: toTheme(d.theme_color),
		publishedAt: toIso(raw.publishedAt, raw.createdAt),
		updatedAt: toIso(raw.updatedAt, raw.createdAt),
	};
	if (d.hero_image_label) article.heroImageLabel = d.hero_image_label;
	return article;
}

export function toCast(raw: RawCast, media: MediaUrls): Cast {
	const d = raw.data;
	return {
		id: raw.id,
		name: d.name,
		profile: d.profile ?? "",
		avatarUrl: imageUrl(media, d.avatar),
		avatarAlt: d.avatar?.alt ?? "",
		bannerUrl: imageUrl(media, d.banner),
		bannerAlt: d.banner?.alt ?? "",
		links: toLinks(d.links),
		themeColor: toTheme(d.theme_color),
		publishedAt: toIso(raw.publishedAt, raw.createdAt),
		updatedAt: toIso(raw.updatedAt, raw.createdAt),
	};
}
