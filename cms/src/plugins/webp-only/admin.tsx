/**
 * "Convert images" — an admin page that turns any picture into the one format
 * the media library accepts.
 *
 * Uploads are refused unless they are WebP (`media:beforeUpload` in
 * `index.ts`), because a personal server's disk is the binding constraint and a
 * 4K PNG screenshot is several times the size of the same picture as WebP.
 * Editors are not expected to convert anything themselves, so refusing without
 * offering a way through would simply stop them.
 *
 * This is a page rather than a panel in the entry editor, for two reasons. A
 * panel is Block Kit — the admin skips `editorPanels` unless the plugin's
 * `adminMode` is `"blocks"`, and that vocabulary has no file input, so the
 * conversion could not run there. And a panel is absent while an entry is
 * unsaved, which is exactly when a new cast member's photographs are added.
 *
 * Deliberately not a replacement for the image field's editor: that would mean
 * rebuilding EmDash's media picker, losing alt text, library re-use and the
 * dark-mode slot, and maintaining a copy of internal markup. Converting here
 * leaves every image field standard. The editor converts, then picks the
 * result from the library as usual.
 *
 * The conversion is a canvas encode in the browser. Nothing is converted on the
 * server: at 4K that costs ~236 MiB of peak RSS per image, which this deployment
 * does not have to spare.
 */

import { apiFetch, parseApiResponse } from "emdash/plugin-utils";
import { useRef, useState } from "react";

/** Mirrors EmDash's media record for the fields this page shows. */
interface MediaItem {
	id: string;
	filename: string;
	mimeType: string;
	size?: number | null;
	width?: number | null;
	height?: number | null;
}

interface Converted {
	readonly source: string;
	readonly sourceBytes: number;
	readonly media: MediaItem;
}

const TARGET = "image/webp";
const QUALITY = 0.92;

const kb = (bytes: number) => `${Math.round(bytes / 1024).toLocaleString()} KB`;

/** Replace a filename's extension, keeping the rest of the name recognisable. */
function renameToWebp(filename: string): string {
	return `${filename.replace(/\.[^./\\]+$/, "") || "image"}.webp`;
}

/**
 * Re-encode a picture as WebP at its own size.
 *
 * Never resampled: the fields these pictures go into require exact pixel sizes,
 * so changing them here would turn a correct photograph into a rejected one.
 */
async function toWebp(file: File): Promise<{ blob: Blob; width: number; height: number }> {
	// Rejects anything it cannot decode, including a file that only claims to be
	// an image.
	const bitmap = await createImageBitmap(file).catch(() => {
		throw new Error("That file could not be read as an image.");
	});
	try {
		const canvas = document.createElement("canvas");
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("This browser would not provide a 2D canvas.");
		context.drawImage(bitmap, 0, 0);

		const blob = await new Promise<Blob | null>((resolve) => {
			canvas.toBlob(resolve, TARGET, QUALITY);
		});
		if (!blob) throw new Error("This browser could not encode the image as WebP.");
		// A browser that cannot encode the requested type hands back PNG instead
		// of failing, and the upload would then be refused with a less useful
		// message than this one.
		if (blob.type !== TARGET) {
			throw new Error(`This browser produced ${blob.type} instead of WebP.`);
		}
		return { blob, width: bitmap.width, height: bitmap.height };
	} finally {
		bitmap.close();
	}
}

export function ConvertImagesPage() {
	const inputRef = useRef<HTMLInputElement>(null);
	const [busy, setBusy] = useState(false);
	const [done, setDone] = useState<Converted[]>([]);
	const [errors, setErrors] = useState<string[]>([]);

	async function convertAll(files: File[]) {
		setBusy(true);
		setErrors([]);
		const failures: string[] = [];
		for (const file of files) {
			try {
				const { blob, width, height } = await toWebp(file);

				const body = new FormData();
				body.append("file", new File([blob], renameToWebp(file.name), { type: TARGET }));
				// EmDash records the dimensions the client states rather than reading
				// them from the file, so they come from the decode above.
				body.append("width", String(width));
				body.append("height", String(height));

				const media = await parseApiResponse<MediaItem>(
					await apiFetch("/_emdash/api/media", { method: "POST", body }),
					"The converted image could not be uploaded.",
				);
				setDone((prev) => [{ source: file.name, sourceBytes: file.size, media }, ...prev]);
			} catch (cause) {
				failures.push(`${file.name}: ${cause instanceof Error ? cause.message : "failed"}`);
			}
		}
		setErrors(failures);
		setBusy(false);
		// Let the same files be picked again after a failure.
		if (inputRef.current) inputRef.current.value = "";
	}

	return (
		<div className="grid gap-4 p-4">
			<div>
				<h1 className="text-lg font-semibold">Convert images</h1>
				<p className="text-sm text-kumo-subtle">
					The media library only accepts WebP, to keep the server's disk use down. Pick any images
					here and they are converted in your browser, then added to the library. Afterwards choose
					them from an image field as usual. Pictures are never resized — the size they were shot
					at is the size they keep.
				</p>
			</div>

			<input
				ref={inputRef}
				type="file"
				accept="image/*"
				multiple
				disabled={busy}
				onChange={(event) => {
					const files = Array.from(event.target.files ?? []);
					if (files.length > 0) void convertAll(files);
				}}
			/>

			{busy ? <p className="text-sm">Converting…</p> : null}

			{errors.length > 0 ? (
				<ul role="alert" className="grid gap-1 text-sm text-kumo-danger">
					{errors.map((message) => (
						<li key={message}>{message}</li>
					))}
				</ul>
			) : null}

			{done.length > 0 ? (
				<table className="text-sm">
					<thead>
						<tr className="text-left text-kumo-subtle">
							<th className="pe-4 font-medium">Source</th>
							<th className="pe-4 font-medium">In the library</th>
							<th className="pe-4 font-medium">Size</th>
							<th className="font-medium">Was</th>
						</tr>
					</thead>
					<tbody>
						{done.map((entry) => (
							<tr key={entry.media.id}>
								<td className="pe-4">{entry.source}</td>
								<td className="pe-4">
									{entry.media.filename}
									{entry.media.width && entry.media.height
										? ` (${entry.media.width}x${entry.media.height})`
										: ""}
								</td>
								<td className="pe-4">{entry.media.size == null ? "—" : kb(entry.media.size)}</td>
								<td>{kb(entry.sourceBytes)}</td>
							</tr>
						))}
					</tbody>
				</table>
			) : null}
		</div>
	);
}

/**
 * Pages are resolved by path from this export; the descriptor's `adminPages`
 * declares the same path, with the label and sidebar folder.
 */
export const pages = {
	"/convert": ConvertImagesPage,
};
