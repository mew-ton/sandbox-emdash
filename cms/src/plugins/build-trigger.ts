/**
 * Native plugin: start the public-site build when published content changes.
 *
 * Sends a GitHub `repository_dispatch`-shaped request on publish, unpublish and
 * delete. Configuration comes from environment variables at request time:
 *
 *   BUILD_DISPATCH_URL     e.g. https://api.github.com/repos/<OWNER>/<REPO>/dispatches
 *   BUILD_DISPATCH_TOKEN   token with permission to send the dispatch
 *   BUILD_DISPATCH_EVENT   event_type (default "cms-content-changed")
 *
 * When BUILD_DISPATCH_URL is unset the plugin only logs.
 */

import { definePlugin } from "emdash";

type Action = "publish" | "unpublish" | "delete";

async function dispatch(action: Action, collection: string, id: string): Promise<void> {
	const url = process.env.BUILD_DISPATCH_URL;
	if (!url) {
		console.log(`[build-trigger] (dry run) ${action} ${collection}/${id}`);
		return;
	}
	const res = await fetch(url, {
		method: "POST",
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${process.env.BUILD_DISPATCH_TOKEN ?? ""}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			event_type: process.env.BUILD_DISPATCH_EVENT ?? "cms-content-changed",
			client_payload: { action, collection, id },
		}),
	});
	if (!res.ok) console.error(`[build-trigger] dispatch failed: ${res.status}`);
}

export function createPlugin() {
	return definePlugin({
		id: "build-trigger",
		version: "0.0.0",
		// Content hooks are skipped unless the plugin declares read access.
		capabilities: ["content:read"],
		hooks: {
			"content:afterPublish": async (event) => {
				await dispatch("publish", event.collection, String(event.content.id));
			},
			"content:afterUnpublish": async (event) => {
				await dispatch("unpublish", event.collection, String(event.content.id));
			},
			"content:afterDelete": async (event) => {
				// Moving to trash takes the entry off the site. Emptying the trash
				// later changes nothing that is published, so it does not rebuild.
				if (!event.permanent) await dispatch("delete", event.collection, event.id);
			},
		},
	});
}

export default createPlugin;
