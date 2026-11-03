/**
 * Post a line to a Discord webhook, or do nothing when none is configured.
 *
 * Inactive unless DISCORD_ALERT_WEBHOOK_URL is set, so development, the
 * benchmark and the verification scripts stay silent without special-casing.
 */

const WEBHOOK = "DISCORD_ALERT_WEBHOOK_URL";

/** Longer than this and Discord truncates anyway; the detail belongs in the logs. */
const MAX_LENGTH = 1800;

export function isConfigured(): boolean {
	return Boolean(process.env[WEBHOOK]);
}

/**
 * Best-effort, and deliberately so: this runs while the process is on its way
 * down, so a webhook that hangs must not be what keeps it alive. Failures are
 * swallowed — there is nowhere left to report them to.
 */
export async function notify(content: string): Promise<void> {
	const url = process.env[WEBHOOK];
	if (!url) return;
	try {
		await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ content: content.slice(0, MAX_LENGTH), allowed_mentions: { parse: [] } }),
			signal: AbortSignal.timeout(5000),
		});
	} catch {
		// Nothing useful to do: the point of this call was to be the report.
	}
}

/**
 * How to name an error in a chat message.
 *
 * Only the class and the first line, because a thrown error can carry request
 * data — a rejected field value, part of a URL — and this goes to a channel
 * people read. The stack and the full message stay in the container logs and
 * the audit log, which are not readable by everyone in the server.
 */
export function describeError(error: unknown): string {
	if (!(error instanceof Error)) return String(error).split("\n")[0].slice(0, 200);
	const firstLine = error.message.split("\n")[0].slice(0, 200);
	return firstLine ? `${error.name}: ${firstLine}` : error.name;
}
