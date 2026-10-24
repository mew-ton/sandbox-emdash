import { getImage } from "astro:assets";

/** Download a remote image at build time and return the local, optimized URL. */
export async function localImage(url: string, width = 1200): Promise<string> {
	if (!url) return "";
	const img = await getImage({ src: url, inferSize: true, width, format: "webp" });
	return img.src;
}

/** Rewrite <img src="…"> in rendered HTML to local copies. */
export async function localizeHtml(html: string): Promise<string> {
	const sources = [...html.matchAll(/<img\s+src="([^"]+)"/g)].map((m) => m[1]!);
	let out = html;
	for (const src of new Set(sources)) {
		const local = await localImage(src.replaceAll("&amp;", "&"));
		out = out.replaceAll(`src="${src}"`, `src="${local}"`);
	}
	return out;
}
