#!/usr/bin/env bash
# Stage the production image contents in bench/.build/<variant>: the built
# dist/ plus production dependencies only (nothing is built on the VPS).
#   bench/prepare.sh                   # standard: cms/ as is
#   VARIANT=sandbox bench/prepare.sh   # 4-7: staging copy of cms/ with the workerd sandbox
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
variant="${VARIANT:-standard}"
build="$here/.build/$variant"
rm -rf "$build"
mkdir -p "$build/app" "$build/providers"
cp -r "$root/providers/discord" "$build/providers/discord"
rm -rf "$build/providers/discord/node_modules"

if [ "$variant" = "standard" ]; then
	(cd "$root/cms" && pnpm build >/dev/null)
	cp -r "$root/cms/dist" "$root/cms/package.json" "$root/cms/pnpm-lock.yaml" "$build/app/"
	(cd "$build/app" && pnpm install --prod --frozen-lockfile --ignore-scripts >/dev/null)
else
	src="$here/.build/$variant-src"
	rm -rf "$src"
	mkdir -p "$src/app"
	(cd "$root/cms" && cp -r package.json pnpm-lock.yaml seed src tsconfig.json emdash-env.d.ts "$src/app/")
	cp "$here/sandbox/astro.config.mjs" "$src/app/astro.config.mjs"
	cp -r "$here/sandbox" "$src/app/sandbox"
	cp -r "$build/providers" "$src/providers"
	(cd "$src/app" && pnpm add @emdash-cms/sandbox-workerd@0.9.5 workerd@1.20261009.1 kysely@0.29.7 >/dev/null && pnpm build >/dev/null)
	cp -r "$src/app/dist" "$src/app/package.json" "$src/app/pnpm-lock.yaml" "$build/app/"
	# workerd ships its binary through an install script
	(cd "$build/app" && pnpm install --prod --frozen-lockfile --config.onlyBuiltDependencies=workerd >/dev/null)
fi
du -sh "$build/app/dist" "$build/app/node_modules"
