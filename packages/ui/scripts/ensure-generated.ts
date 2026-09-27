#!/usr/bin/env bun
/**
 * Make sure this package's generated files exist.
 *
 * `src/index.css` imports `plugins.generated.css` and `src/container.tsx` imports
 * `plugins.generated.ts`. Both are written by `fishtea ui-assets` from an *application's* ui plugins,
 * and both are git-ignored — so a fresh clone had neither, and `vite build` failed on a missing import
 * before anyone had run a command that would create them.
 *
 * **It lives inside packages/ui on purpose.** It used to sit in the repo's top-level `scripts/`, which a
 * release does not ship — so the container built from a release ran `bun ../../scripts/…`, found
 * nothing, and the UI died at startup with `Module not found` while every other service came up healthy.
 * A package's build must not reach outside the package.
 *
 * This writes the empty versions when they are absent and leaves a real one alone, so it is safe in
 * front of anything. It is not a substitute for `fishtea ui-assets`: it only makes "no ui plugins" the
 * state of a checkout that has never been told about any.
 */
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const SRC = resolve(dirname(new URL(import.meta.url).pathname), "../src");

const BASE: Record<string, string> = {
  "plugins.generated.css":
    "/* Written by packages/ui/scripts/ensure-generated.ts because no application has generated one yet.\n" +
    "   `fishtea ui-assets --app <dir>` replaces this with that application's design systems. */\n",
  "plugins.generated.ts":
    "/* Written by packages/ui/scripts/ensure-generated.ts because no application has generated one yet.\n" +
    "   `fishtea ui-assets --app <dir>` replaces this with that application's vessel overrides. */\n" +
    'import type { ComponentType } from "react";\n\n' +
    "export const vesselOverrides: Partial<Record<string, ComponentType<any>>> = {};\n",
};

export function ensureUiAssets(): string[] {
  const wrote: string[] = [];
  for (const [name, content] of Object.entries(BASE)) {
    const file = join(SRC, name);
    if (existsSync(file)) continue;
    writeFileSync(file, content);
    wrote.push(name);
  }
  return wrote;
}

if (import.meta.main) {
  const wrote = ensureUiAssets();
  if (wrote.length) console.log(`✓ wrote base ${wrote.join(", ")}`);
}
