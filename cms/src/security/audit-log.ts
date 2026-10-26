/**
 * Request-level audit log (5-7).
 *
 * Core EmDash only writes its audit_logs table for MCP calls and site
 * transfer, and its content hooks that fire *after* publish/delete do not
 * carry the acting user. So instead of hooks, we log at the middleware layer,
 * where `locals.user` (id + role) is resolved for every request.
 *
 * Every state-changing request (POST/PUT/PATCH/DELETE) and every auth call is
 * written as one structured JSON line to stdout: who (user id + role, or the
 * bearer-token subject), from where (client IP), what (method + path), the
 * outcome (status) and the duration.
 *
 * Why stdout and not a table: an append-only log shipped off the box (journald,
 * a log collector) cannot be edited by someone who reaches the database or the
 * admin UI — which matters because the threat model here is an insider or a
 * hijacked member session (see reports/05-security.md 5-6/5-7). Ship these
 * lines off the VPS and keep them; they are the control, not a defence.
 *
 * This records attribution, not prevention. It does not stop the member-
 * reachable crash (5-6). For the crash itself the app log is best-effort:
 * stdout buffered by Node can be lost when the process is SIGKILLed (OOM),
 * so the forensic record of a crashing request is the reverse proxy's access
 * log (method, path, source IP, dropped upstream), which must be enabled.
 * This middleware's job is attribution for ordinary writes.
 */

import type { APIContext, MiddlewareNext } from "astro";

/** Paths whose writes (and auth calls) are worth an audit line. */
const AUDITED_PREFIXES = [
	"/_emdash/api/content/",
	"/_emdash/api/media",
	"/_emdash/api/schema/",
	"/_emdash/api/taxonomies",
	"/_emdash/api/settings",
	"/_emdash/api/admin/",
	"/_emdash/api/auth/",
	"/_emdash/api/setup/",
	"/_emdash/api/oauth/",
];
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function trustedHeaders(): string[] {
	return (process.env.EMDASH_TRUSTED_PROXY_HEADERS ?? "")
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
}

/** Best-effort client IP: a trusted proxy header if configured, else Astro's socket address. */
function clientIp(context: APIContext): string {
	const headers = context.request.headers;
	for (const name of trustedHeaders()) {
		const raw = headers.get(name);
		const first = raw?.split(",")[0]?.trim();
		if (first) return first;
	}
	return context.clientAddress ?? "unknown";
}

function emit(record: Record<string, unknown>): void {
	// One JSON object per line ("audit" tag lets a collector route these).
	// process.stdout.write handles a non-blocking pipe (it buffers on EAGAIN),
	// unlike fs.writeSync(1, …) which throws EAGAIN in a container.
	try {
		process.stdout.write(`${JSON.stringify({ tag: "audit", ...record })}\n`);
	} catch {
		/* logging must never break a request */
	}
}

export async function auditLog(context: APIContext, next: MiddlewareNext): Promise<Response> {
	const { method } = context.request;
	const path = context.url.pathname;
	const audited = AUDITED_PREFIXES.some((p) => path.startsWith(p));
	if (!audited || (!WRITE_METHODS.has(method) && !path.startsWith("/_emdash/api/auth/") && !path.startsWith("/_emdash/api/setup/"))) {
		return next();
	}

	const started = Date.now();
	const ip = clientIp(context);
	const base = { ts: new Date().toISOString(), method, path, ip };
	// Pre-log: survives a crash mid-request (the 5-6 payloads crash here).
	emit({ ...base, phase: "start" });

	let response: Response;
	try {
		response = await next();
	} catch (error) {
		emit({ ...base, phase: "error", ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
		throw error;
	}

	// locals.user is resolved by EmDash's auth middleware (runs before this one).
	const user = context.locals.user as { id?: string; role?: number } | undefined | null;
	const viaToken = (context.locals as { tokenScopes?: string[] }).tokenScopes !== undefined;
	emit({
		...base,
		phase: "done",
		status: response.status,
		ms: Date.now() - started,
		actor: user?.id ?? (viaToken ? "api-token" : "anonymous"),
		role: user?.role ?? null,
		auth: viaToken ? "token" : user ? "session" : "none",
	});
	return response;
}
