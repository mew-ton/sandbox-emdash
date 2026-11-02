/**
 * Native plugin: hold rich text to the subset of Portable Text a field is
 * meant to carry.
 *
 * The editor offers everything EmDash's TipTap setup registers — code blocks,
 * raw HTML, iframes, tables, subscript, six heading levels — and that list is
 * hardcoded. The admin builds it with
 * `PortableTextStarterKit.configure({ heading: { levels: [1,2,3,4,5,6] }, … })`
 * followed by its own extensions, and nothing in a field's `options` or
 * `validation` reaches it. So a cast member writing a short introduction is
 * offered a table and a raw-HTML block, and the public site either renders them
 * or silently drops them. Either way the effort is wasted, and raw HTML and
 * iframes are a publishing surface no Editor needs — which matters here,
 * because every Discord member is an Editor.
 *
 * Each field declares what it accepts, on four axes, in the seed:
 *
 *   { "slug": "body", "type": "portableText",
 *     "options": {
 *       "allowedTypes":  ["block", "image"],
 *       "allowedStyles": ["normal", "h2", "h3", "h4"],
 *       "allowedMarks":  ["strong", "em", "link"],
 *       "allowedLists":  ["bullet", "number"]
 *     } }
 *
 * The keys come from `portable-text-keys.ts`, which lists every one this EmDash
 * version can produce. A field naming a key that is not in that list fails
 * loudly rather than never matching, and a *value* carrying such a key is
 * refused — so a capability a later EmDash adds cannot slip through unlisted.
 *
 * An axis a field omits is unrestricted, so a field with no `options` is
 * untouched and adding a collection does not silently start rejecting saves.
 *
 * This refuses; it does not hide. The toolbar cannot be configured, and even
 * with its buttons hidden by CSS, TipTap's keyboard shortcuts and markdown
 * input rules (``` for a code block, "# " for a heading) would still produce
 * the nodes. Stopping the save is the only place the rule can hold — which also
 * means the editor finds out at save, not while typing.
 */

import { ContentSaveRejectedError, definePlugin } from "emdash";

// Extension included so this module also loads under plain `node`, which is
// how the policy is exercised without starting a server.
import { AXES, type Axis, describe, isKnown } from "./portable-text-keys.ts";

/** What one field accepts. A missing axis is unrestricted. */
type Policy = Partial<Record<Axis, ReadonlySet<string>>>;

/**
 * Read a field's policy, rejecting a key this EmDash version cannot produce.
 *
 * A typo would otherwise match nothing: `"h2 "` or `"codeBlock"` would quietly
 * leave that axis narrower or wider than intended, and nothing would say so.
 */
function policyOf(field: { slug: string; options?: Record<string, unknown> }): Policy | null {
	const options = field.options;
	if (!options) return null;

	const policy: Policy = {};
	for (const axis of Object.keys(AXES) as Axis[]) {
		const declared = options[axis];
		if (declared === undefined) continue;
		if (!Array.isArray(declared) || !declared.every((key) => typeof key === "string")) {
			throw new Error(`[portable-text-policy] ${field.slug}.${axis} must be an array of strings.`);
		}
		for (const key of declared as string[]) {
			if (!isKnown(axis, key)) {
				throw new Error(
					`[portable-text-policy] ${field.slug}.${axis} names "${key}", which this EmDash version does not produce.`,
				);
			}
		}
		policy[axis] = new Set(declared as string[]);
	}
	return Object.keys(policy).length > 0 ? policy : null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Judge one key on one axis.
 *
 * Unknown keys are refused even when the field put no limit on that axis: a
 * key this version is not known to produce is either an EmDash addition or
 * something hand-written, and neither should pass unexamined.
 */
function reject(policy: Policy, axis: Axis, key: string): string | null {
	if (!isKnown(axis, key)) return `contains ${describe(axis, key)}, which this CMS does not recognise`;
	const allowed = policy[axis];
	if (!allowed || allowed.has(key)) return null;
	return `cannot contain ${describe(axis, key)}`;
}

/**
 * The first violation in a Portable Text value, or null when it conforms.
 *
 * Only the top level is walked. Nested content — a table's cells, a gallery's
 * images — belongs to a block type that is either allowed or already refused
 * here, so descending would add reach without adding decisions.
 */
function violation(value: unknown, policy: Policy): string | null {
	if (!Array.isArray(value)) return null;

	for (const block of value) {
		if (!isRecord(block)) continue;

		const type = typeof block._type === "string" ? block._type : "";
		if (type !== "") {
			const found = reject(policy, "allowedTypes", type);
			if (found) return found;
		}
		if (type !== "block") continue;

		const style = typeof block.style === "string" ? block.style : "normal";
		const styleFound = reject(policy, "allowedStyles", style);
		if (styleFound) return styleFound;

		if (typeof block.listItem === "string") {
			const listFound = reject(policy, "allowedLists", block.listItem);
			if (listFound) return listFound;
		}

		// Spans carry the plain marks; markDefs carry the ones with data, such as
		// a link's href, which a span references by key.
		const markDefs = Array.isArray(block.markDefs) ? block.markDefs : [];
		for (const child of Array.isArray(block.children) ? block.children : []) {
			if (!isRecord(child)) continue;
			for (const mark of Array.isArray(child.marks) ? child.marks : []) {
				if (typeof mark !== "string") continue;
				const isKey = markDefs.some((def) => isRecord(def) && def._key === mark);
				if (isKey) continue;
				const found = reject(policy, "allowedMarks", mark);
				if (found) return found;
			}
		}
		for (const def of markDefs) {
			if (!isRecord(def)) continue;
			const defType = typeof def._type === "string" ? def._type : "";
			if (defType === "") continue;
			const found = reject(policy, "allowedMarks", defType);
			if (found) return found;
		}
	}
	return null;
}

export function createPlugin() {
	return definePlugin({
		id: "portable-text-policy",
		version: "0.0.0",
		// content:write — what content:beforeSave requires; the hook is skipped
		//   without it. content:read is what the after* hooks need, not this one.
		// schema:read  — ctx.schema.getCollection() carries each field's `options`.
		capabilities: ["content:write", "schema:read"],
		hooks: {
			"content:beforeSave": async (event, ctx) => {
				const schema = ctx.schema;
				if (!schema) {
					throw new ContentSaveRejectedError(
						"Rich text cannot be checked: the portable-text-policy plugin is missing the schema:read capability.",
					);
				}

				const collection = await schema.getCollection(event.collection);
				if (!collection) return;

				for (const field of collection.fields) {
					if (field.type !== "portableText") continue;
					// On an update `content` carries only the submitted fields, so an
					// absent field was not touched: re-checking it would block edits to
					// an entry written before this rule.
					if (!(field.slug in event.content)) continue;

					const policy = policyOf(field);
					if (!policy) continue;

					const found = violation(event.content[field.slug], policy);
					if (found) {
						throw new ContentSaveRejectedError(`"${field.label}" ${found}.`);
					}
				}
			},
		},
	});
}

export default createPlugin;
