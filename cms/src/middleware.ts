import { discordGuard } from "@sandbox/emdash-auth-discord/guard";
import { defineMiddleware } from "astro:middleware";

export const onRequest = defineMiddleware(discordGuard);
