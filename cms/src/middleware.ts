import { discordGuard } from "@sandbox/emdash-auth-discord/guard";
import { defineMiddleware, sequence } from "astro:middleware";

import { auditLog } from "./middlewares/audit-log";
import { disableFeatures } from "./middlewares/disable-features";
import { hideAsideContents } from "./middlewares/hide-aside-contents";
import { publicSurface } from "./middlewares/public-surface";

// Each middleware declares itself with `defineMiddleware`, so this is only the
// order they run in. auditLog is outermost: it records the final status (incl.
// guard rejections) and leaves a "start" line before a request can crash the
// process. The two that rewrite admin HTML run innermost, so a request a guard
// rejects is never buffered. discordGuard comes from a package outside this
// project, so it is wrapped here.
export const onRequest = sequence(
	auditLog,
	publicSurface,
	defineMiddleware(discordGuard),
	disableFeatures,
	hideAsideContents,
);
