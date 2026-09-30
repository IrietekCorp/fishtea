#!/usr/bin/env bun
/**
 * Make sure this package can build before any application has generated its UI assets.
 *
 * It used to write empty `src/plugins.generated.{css,ts}` into a fresh clone, because both were
 * git-ignored and `vite build` failed on a missing import. The empty versions are committed now, in
 * src/generated, and an application's real ones are written into *its* `.fishtea/ui/` (vite.config.ts
 * points `#generated` there) — so this only checks the base is present, and says so if it is not.
 *
 * **It lives inside packages/ui on purpose.** A release does not ship the repo's top-level scripts/, and
 * a package's build must not reach outside the package.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const BASE = resolve(dirname(new URL(import.meta.url).pathname), "../src/generated");

export function ensureUiAssets(): string[] {
  const missing = ["plugins.generated.css", "plugins.generated.ts"].filter((f) => !existsSync(join(BASE, f)));
  if (missing.length) throw new Error(`packages/ui/src/generated is missing ${missing.join(", ")}; restore them from git`);
  return [];
}

if (import.meta.main) ensureUiAssets();
