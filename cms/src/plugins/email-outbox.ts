/**
 * Native plugin: email transport that writes each message to a JSON file.
 *
 * Stand-in for a real transport (e.g. an SMTP plugin) so magic-link sign-in can
 * be exercised locally. Active only when EMAIL_OUTBOX_DIR is set; otherwise
 * delivery fails and EmDash reports that email could not be sent.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { definePlugin } from "emdash";

export function createPlugin() {
	return definePlugin({
		id: "email-outbox",
		version: "0.0.0",
		capabilities: ["hooks.email-transport:register"],
		hooks: {
			"email:deliver": {
				exclusive: true,
				handler: async (event) => {
					const dir = process.env.EMAIL_OUTBOX_DIR;
					if (!dir) throw new Error("EMAIL_OUTBOX_DIR is not set");
					mkdirSync(dir, { recursive: true });
					const file = join(dir, `${Date.now()}-${event.message.to.replace(/[^a-z0-9@.]/gi, "_")}.json`);
					writeFileSync(file, JSON.stringify(event.message, null, 2));
				},
			},
		},
	});
}

export default createPlugin;
