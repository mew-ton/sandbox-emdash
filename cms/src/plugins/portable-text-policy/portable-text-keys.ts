/**
 * Everything EmDash 1.3.1's rich-text editor can put into a Portable Text
 * value, and what to call each one when refusing it.
 *
 * A description of the editor, not a decision about it: every key is listed
 * whether or not a field accepts it. What each field accepts is declared in
 * seed/seed.json and read in `index.ts`.
 *
 * The keys are the ones that reach the stored value, taken from
 * `emdash/src/content/converters/types.ts` — not the names the toolbar uses.
 * They differ: the code block is `code`, not `codeBlock`, and raw HTML is
 * `htmlBlock`, not `html`.
 *
 * Listing every key is what makes "not allowed" decidable. With only an
 * allowlist, anything the editor gains in a later release would pass unnoticed
 * because nobody had written it down; a value carrying a key absent from here
 * is refused and names itself, which turns a silent new capability into a
 * message. Re-check this list on an EmDash update
 * (reports/00-summary.md, D6).
 */

/** Top-level `_type` values a block can have. */
export const BLOCK_TYPES = {
	block: "a paragraph or heading",
	image: "an image",
	gallery: "an image gallery",
	code: "a code block",
	htmlBlock: "a raw HTML block",
	iframe: "an embedded frame",
	video: "a video",
	table: "a table",
} as const;

/** `style` values a `block` can have. */
export const BLOCK_STYLES = {
	normal: "a paragraph",
	h1: "a level-1 heading",
	h2: "a level-2 heading",
	h3: "a level-3 heading",
	h4: "a level-4 heading",
	h5: "a level-5 heading",
	h6: "a level-6 heading",
	blockquote: "a quote",
} as const;

/**
 * Marks a span can carry.
 *
 * `link` is a mark definition rather than a plain name — a span references it
 * by key and `markDefs` holds the href — but it is allowed or refused by the
 * same list.
 */
export const MARKS = {
	strong: "bold text",
	em: "italic text",
	underline: "underlined text",
	strike: "struck-through text",
	code: "inline code",
	subscript: "subscript",
	superscript: "superscript",
	link: "a link",
} as const;

/** `listItem` values a `block` can have. */
export const LIST_TYPES = {
	bullet: "a bulleted list",
	number: "a numbered list",
} as const;

export type BlockType = keyof typeof BLOCK_TYPES;
export type BlockStyle = keyof typeof BLOCK_STYLES;
export type Mark = keyof typeof MARKS;
export type ListType = keyof typeof LIST_TYPES;

/** The four axes a field's policy picks from, by the name the seed uses. */
export const AXES = {
	allowedTypes: BLOCK_TYPES,
	allowedStyles: BLOCK_STYLES,
	allowedMarks: MARKS,
	allowedLists: LIST_TYPES,
} as const;

export type Axis = keyof typeof AXES;

/** What to call a key when telling an editor it cannot be used. */
export function describe(axis: Axis, key: string): string {
	return (AXES[axis] as Record<string, string | undefined>)[key] ?? `"${key}"`;
}

/** Whether a key is one this EmDash version is known to produce. */
export function isKnown(axis: Axis, key: string): boolean {
	return Object.hasOwn(AXES[axis], key);
}
