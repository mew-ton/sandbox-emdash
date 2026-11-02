/**
 * Which sections of the entry editor's settings panel this deployment hides.
 *
 * EmDash renders up to nine there — publish, url-language, ownership, bylines,
 * translations, taxonomies, seo, outline, revisions — and the ids below are
 * EmDash's own (`SortableContentSettingsSection`'s `id`). They are *not* in the
 * DOM: that id is dnd-kit's sort key. So each section is matched through a
 * descendant whose text is not localized — a placeholder or an `aria-label`
 * that stays English in a Japanese admin — rather than by its heading.
 *
 * A whole section goes at once because each one here holds only fields this
 * deployment does not use. Re-check that on an EmDash update: a field added to
 * one of them would disappear with the rest.
 */

export interface HiddenSection {
	/** EmDash's own section id, for reference when re-checking an update. */
	readonly id: string;
	/** Why this section is hidden. */
	readonly reason: string;
	/** Selector matching something inside the section. */
	readonly match: string;
}

export const HIDDEN_SECTIONS: readonly HiddenSection[] = [
	{
		id: "url-language",
		// Holds both the slug and the content language. site/ routes by entry id
		// (site/src/pages/articles/[id].astro), so the slug never reaches a URL,
		// and the site is single-locale. EmDash fills the slug from the title
		// anyway, so there is nothing to refuse — only a field to stop offering.
		reason: "Entry slug and content language: site/ routes by id and is single-locale",
		match: 'input[placeholder="my-post-slug"]',
	},
	{
		id: "bylines",
		// Standalone display-name records (`_emdash_bylines`), not CMS users and
		// not the last editor. The feature itself is refused in disable-features/.
		reason: "Bylines: display-only author records this deployment does not use",
		match: '[aria-label^="Why are bylines shown"]',
	},
];
