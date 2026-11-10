/**
 * The pins that cannot import their constant, held to it.
 *
 * `BUN_VERSION` lives in packages/cli/src/env.ts, but setup-bun reads `.bun-version` and a Dockerfile's
 * `FROM` reads only an `ARG`. Before this, CI ran an exact Bun while every image took whatever `oven/bun:1`
 * meant that day. (scripts/postgres.test.ts does the same for the database.)
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BUN_VERSION } from "../packages/cli/src/env.ts";

const HOME = resolve(import.meta.dir, "..");
const read = (rel: string) => readFileSync(join(HOME, rel), "utf8");

describe("one Bun", () => {
  test("the pin is an exact version", () => {
    expect(BUN_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test(".bun-version, which CI reads, says the same", () => {
    expect(read(".bun-version").trim()).toBe(BUN_VERSION);
    expect(read(".github/workflows/ci.yml")).toContain("bun-version-file: .bun-version");
    expect(read(".github/workflows/ci.yml")).not.toMatch(/bun-version:\s/);
  });

  test("every image is built from it, never from a floating tag", () => {
    for (const f of readdirSync(HOME).filter((f) => f.startsWith("Dockerfile"))) {
      const src = read(f);
      if (!src.includes("oven/bun")) continue;
      expect({ f, arg: src.match(/^ARG BUN_VERSION=(.+)$/m)?.[1] }).toEqual({ f, arg: BUN_VERSION });
      for (const m of src.matchAll(/^FROM (oven\/bun:\S+)/gm)) expect({ f, from: m[1] }).toEqual({ f, from: "oven/bun:${BUN_VERSION}" });
    }
  });
});

describe("one licence", () => {
  test("the licence is Apache-2.0, and every package says so", () => {
    expect(read("LICENSE")).toContain("Apache License");
    expect(read("LICENSE")).toContain("Version 2.0, January 2004");
    const pkgs = ["package.json", ...["packages", "plugins"].flatMap((d) =>
      readdirSync(join(HOME, d)).map((p) => join(d, p, "package.json")).filter((p) => existsSync(join(HOME, p))))];
    for (const p of pkgs) expect({ p, license: JSON.parse(read(p)).license }).toEqual({ p, license: "Apache-2.0" });
  });
});

test("a release hands on the licence and the notice (Apache-2.0 section 4)", async () => {
  const { RUNTIME_FILES } = await import("./build-release.ts");
  expect(RUNTIME_FILES).toEqual(expect.arrayContaining(["LICENSE", "NOTICE"]));
});
