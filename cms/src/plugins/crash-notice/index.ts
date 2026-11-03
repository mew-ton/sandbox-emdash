/**
 * Native plugin: say in Discord when the CMS went down unexpectedly.
 *
 * A signed-in member can crash this server with one request (reports/05-security.md
 * 5-6). The decision is to let `restart: always` bring it back and not to protect
 * work in progress, but to know that it happened (D22). This is the knowing part.
 *
 * **Planned restarts stay silent.** The daily 07:00 restart (D21) arrives as
 * SIGTERM, which writes a marker file before exiting. A start that finds the
 * marker was expected; a start that does not means the previous run died without
 * being asked to — a crash, an OOM kill, or the host going away. That covers the
 * cases an in-process handler cannot: SIGKILL leaves no chance to run anything.
 *
 * So there are two independent reports:
 *
 *   - uncaughtException / unhandledRejection: posts the error class, then exits.
 *   - the next start: posts that the previous run did not exit cleanly.
 *
 * A crash normally produces both, from either side of the restart. That is the
 * point — the first can be lost, the second cannot.
 */

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { definePlugin } from "emdash";

import { describeError, isConfigured, notify } from "./notify.ts";

/**
 * Written on a clean exit, removed once a start has accounted for it.
 *
 * It lives beside the database so it shares the volume's lifetime: a wiped
 * volume reads as "no clean exit recorded", which is true of a fresh instance
 * and is reported once, harmlessly.
 */
const MARKER = "clean-exit.json";

const stateDir = () => process.env.CRASH_NOTICE_STATE_DIR ?? process.cwd();

/** Only register once, however many SSR chunks import this module. */
const REGISTERED = Symbol.for("sandbox:crash-notice:registered");

function readMarker(path: string): string | null {
	try {
		const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
		return typeof raw === "object" && raw !== null && "at" in raw && typeof raw.at === "string"
			? raw.at
			: null;
	} catch {
		return null;
	}
}

function register(): void {
	const globals = globalThis as Record<symbol, unknown>;
	if (globals[REGISTERED]) return;
	globals[REGISTERED] = true;
	if (!isConfigured()) return;

	const marker = join(stateDir(), MARKER);
	const cleanExitAt = readMarker(marker);
	// Clear it now: the next start must find a marker written by the next clean
	// exit, not this one, or every start after a crash would look clean.
	try {
		rmSync(marker, { force: true });
	} catch {
		// A read-only state dir means this cannot distinguish the cases. The
		// uncaughtException path still reports, so degrade quietly.
	}
	if (cleanExitAt === null) {
		void notify(
			"⚠️ CMS が起動しました。**前回は正常終了していません**（クラッシュ・OOM・ホストの停止のいずれか）。" +
				"初回起動かデータ領域を作り直した直後であれば、この通知は想定どおりです。",
		);
	}

	let exiting = false;
	const cleanExit = (signal: string) => {
		if (exiting) return;
		exiting = true;
		try {
			writeFileSync(marker, JSON.stringify({ at: new Date().toISOString(), signal }));
		} catch {
			// Then the next start reports a crash that did not happen. Noisy, not wrong.
		}
		process.exit(0);
	};
	// SIGTERM is what a container stop and the daily restart send; SIGINT is a
	// person at a terminal. Both are someone asking, so neither is reported.
	process.once("SIGTERM", () => cleanExit("SIGTERM"));
	process.once("SIGINT", () => cleanExit("SIGINT"));

	const died = (kind: string) => async (error: unknown) => {
		// No marker is written, so the next start reports this as well.
		await notify(`🔴 CMS が ${kind} で停止します — ${describeError(error)}`);
		process.exit(1);
	};
	process.on("uncaughtException", died("uncaughtException"));
	process.on("unhandledRejection", died("unhandledRejection"));
}

export function createPlugin() {
	register();
	return definePlugin({
		id: "crash-notice",
		version: "0.0.0",
		// Nothing of EmDash's is used: this watches the process and posts to a
		// webhook, so it asks for no capability and declares no hook.
		capabilities: [],
	});
}

export default createPlugin;
