import { discordGuard } from "@sandbox/emdash-auth-discord/guard";
import { defineMiddleware, sequence } from "astro:middleware";

import { publicSurface } from "./security/public-surface";

export const onRequest = sequence(defineMiddleware(publicSurface), defineMiddleware(discordGuard));
