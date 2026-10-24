import { defineConfig } from "astro/config";

// Remote images are downloaded and optimized at build time, so the published
// site never links to the CMS host. CMS_URL is only used to allow that origin.
const cms = process.env.CMS_URL ? new URL(process.env.CMS_URL) : null;

export default defineConfig({
	output: "static",
	image: {
		remotePatterns: cms ? [{ protocol: cms.protocol.replace(":", ""), hostname: cms.hostname, port: cms.port || undefined }] : [],
	},
});
