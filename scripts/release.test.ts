/**
 * What a release has to contain.
 *
 * Twice now something has shipped that assumed a source checkout and only failed once somebody
 * installed: first the console importing `packages/cli/src/new.ts` by path, then `fishtea up` failing
 * with `"/tsconfig.json": not found` because the staged release had no root manifest and only two of the
 * seven workspace packages.
 *
 * The honest check is to stage a release and build the images, which is four minutes and needs Docker.
 * This is the cheap half: whatever the Dockerfiles copy must be covered by RUNTIME_FILES. It would have
 * caught both halves of the second bug in milliseconds.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { RUNTIME_FILES } from "./build-release.ts";

const HOME = resolve(import.meta.dir, "..");
const DOCKERFILES = ["Dockerfile.core", "Dockerfile.classifier"];

/** Every path a Dockerfile copies out of the build context, which is the release directory. */
function copiedPaths(dockerfile: string): string[] {
  const text = readFileSync(join(HOME, dockerfile), "utf8");
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*COPY\s+(.+)$/i.exec(line);
    if (!m) continue;
    const parts = m[1].trim().split(/\s+/).filter((p) => !p.startsWith("--"));
    // The last token is the destination inside the image; everything before it is a source.
    for (const src of parts.slice(0, -1)) out.push(src.replace(/\*+$/, ""));
  }
  return out;
}

/** Is this path inside something the release stages? */
const covered = (p: string) => RUNTIME_FILES.some((r) => p === r || p.startsWith(`${r}/`));

describe("a release contains what its Dockerfiles copy", () => {
  for (const dockerfile of DOCKERFILES) {
    test(`${dockerfile}`, () => {
      const missing = copiedPaths(dockerfile).filter((p) => !covered(p));
      expect({ dockerfile, missing }).toEqual({ dockerfile, missing: [] });
    });
  }

  test("every workspace member is staged, because bun install --frozen-lockfile needs them all", () => {
    // Shipping only the packages the containers execute is the trap: an install resolves the whole
    // workspace, and one missing member's package.json fails it.
    const { workspaces } = JSON.parse(readFileSync(join(HOME, "package.json"), "utf8")) as { workspaces: string[] };
    const roots = workspaces.map((w) => w.replace(/\/\*$/, ""));
    for (const root of roots) expect({ root, staged: RUNTIME_FILES.includes(root) }).toEqual({ root, staged: true });
  });

  test("no shipped package's scripts reach outside the packages tree", () => {
    // The container runs `bun run dev` inside packages/ui with only what a release ships. When that
    // script said `bun ../../scripts/ui-assets-base.ts`, every other service came up healthy and the UI
    // died with `Module not found` — because scripts/ is not shipped and never was.
    const offenders: string[] = [];
    for (const pkg of readdirSync(join(HOME, "packages"))) {
      const manifest = join(HOME, "packages", pkg, "package.json");
      if (!existsSync(manifest)) continue;
      const { scripts = {} } = JSON.parse(readFileSync(manifest, "utf8")) as { scripts?: Record<string, string> };
      for (const [name, cmd] of Object.entries(scripts)) {
        if (/(^|[\s"'])\.\.\/\.\./.test(cmd)) offenders.push(`packages/${pkg} ${name}: ${cmd}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the files an install itself reads are staged", () => {
    for (const f of ["package.json", "bun.lock", "tsconfig.json"]) {
      expect({ file: f, staged: RUNTIME_FILES.includes(f) }).toEqual({ file: f, staged: true });
    }
  });
});
