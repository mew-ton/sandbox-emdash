import { discordGuard } from "@sandbox/emdash-auth-discord/guard";
import { defineMiddleware, sequence } from "astro:middleware";

import { auditLog } from "./security/audit-log";
import { publicSurface } from "./security/public-surface";

// auditLog is outermost so it records the final status (incl. guard rejections)
// and leaves a "start" line before a request can crash the process.
export const onRequest = sequence(
	defineMiddleware(auditLog),
	defineMiddleware(publicSurface),
	defineMiddleware(discordGuard),
);
