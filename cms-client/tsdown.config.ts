import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts"],
	format: "esm",
	dts: true,
	platform: "neutral",
	// Runtime dependencies stay external; generated types are inlined and only
	// the public surface of src/index.ts reaches dist/index.d.mts.
	deps: { neverBundle: ["@portabletext/to-html"] },
});
