/**
 * One Postgres pin, and the files that cannot import it.
 *
 * packages/cli/src/env.ts holds POSTGRES_IMAGE. Anything written in TypeScript derives it, so it cannot
 * drift. A compose file, a workflow and a README cannot import a constant, so they are checked instead:
 * this is the same arrangement `bun run release --check` has for the version sites, for the same reason.
 *
 * The point is the bump. "Everyone moves to the next Postgres" should be one edit to that constant plus
 * whatever this test then names, rather than a hunt through four repositories. It also fails on a *stale*
 * pin left behind in a file that got a new one somewhere else, which is the failure that actually happens.
 *
 * Deliberately not covered: docs/BLUEPRINT.md and docs/DESIGN.md. The blueprint pins pg16 because that is
 * what it pinned, and DESIGN.md records moving off it. They are history, and a test that rewrote history
 * to match today would be destroying the only record of why today looks like this.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { POSTGRES_IMAGE, POSTGRES_READY } from "../packages/cli/src/env.ts";
import { POSTGRES_SITES } from "./deps.ts";

const HOME = resolve(import.meta.dir, "..");
const read = (rel: string) => readFileSync(join(HOME, rel), "utf8");

/** Every `pgvector/pgvector:<tag>` a file names. */
const images = (text: string) => [...text.matchAll(/pgvector\/pgvector:[\w.-]+/g)].map((m) => m[0]);

/** The operational sites: a stack this repository actually brings up, or tells someone how to. */
// The files that name the image without importing it; env.ts is the source. One list, shared with `bun run deps`.
const SITES = POSTGRES_SITES.filter((f) => f !== "packages/cli/src/env.ts");

describe("the Postgres pin", () => {
  test("is exact, so it cannot move underneath anyone", () => {
    // `pgvector/pgvector:pg18` floats: CI resolved 0.8.7 while a developer's container was still 0.8.6.
    expect(POSTGRES_IMAGE).toMatch(/^pgvector\/pgvector:\d+\.\d+\.\d+-pg\d+(-\w+)?$/);
  });

  test("is the only one every operational file names", () => {
    const disagree: string[] = [];
    for (const rel of SITES) {
      const found = [...new Set(images(read(rel)))];
      if (found.length === 0) disagree.push(`${rel}: names no Postgres image at all`);
      for (const img of found) if (img !== POSTGRES_IMAGE) disagree.push(`${rel}: ${img}`);
    }
    expect(disagree).toEqual([]);
  });

  test("reaches a generated application, which is where it matters most", () => {
    // new.ts writes the compose for every application ever scaffolded. A literal here would be inherited
    // by each of them and could only be fixed per application, afterwards, by hand.
    const src = read("packages/cli/src/new.ts");
    expect(src).toContain("image: ${POSTGRES_IMAGE}");
    expect(images(src)).toEqual([]);
  });

  test("asks for readiness over TCP everywhere it asks at all", () => {
    // A pg_isready with no host checks the unix socket, which the init server can answer before the real
    // one is listening. Each of these is a stack someone waits on.
    const offenders: string[] = [];
    for (const rel of [...SITES, "packages/cli/src/new.ts"]) {
      for (const line of read(rel).split("\n")) {
        // A comment that explains the rule is not a breach of it, and these files all explain it.
        if (/^\s*(#|\/\/|\*)/.test(line)) continue;
        for (const m of line.matchAll(/pg_isready[^"'`\n]*/g)) {
          if (!m[0].includes("-h localhost")) offenders.push(`${rel}: ${m[0].trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    expect(POSTGRES_READY).toContain("-h localhost");
  });
});
