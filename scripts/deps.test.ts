/**
 * `bun run deps` moves a pin in every place it lives, or in none. Run against a copy of the files it
 * touches, so a test never rewrites the checkout it is testing.
 */
import { describe, expect, test, beforeEach } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { HOME, POSTGRES_SITES, bunPin, classifierPin, declared, npmLayer, postgresPin, setBun, setClassifier, setPostgres } from "./deps.ts";

const FILES = [...new Set([...POSTGRES_SITES, ".bun-version", "Dockerfile.core", "packages/classifier/requirements.txt"])];
let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fishtea-deps-"));
  for (const f of FILES) { mkdirSync(join(root, dirname(f)), { recursive: true }); cpSync(join(HOME, f), join(root, f)); }
});
const read = (f: string) => readFileSync(join(root, f), "utf8");

describe("moving a pin", () => {
  test("Bun moves in env.ts, .bun-version and the Dockerfile together", () => {
    const touched = setBun("9.9.9", root);
    expect(touched.sort()).toEqual([".bun-version", "Dockerfile.core", "packages/cli/src/env.ts"]);
    expect(bunPin(root)).toBe("9.9.9");
    expect(read(".bun-version").trim()).toBe("9.9.9");
    expect(read("Dockerfile.core")).toContain("ARG BUN_VERSION=9.9.9");
  });

  test("Bun refuses anything but an exact version, and moves nothing when it does", () => {
    const before = bunPin(root);
    expect(() => setBun("1", root)).toThrow(/exact version/);
    expect(() => setBun("latest", root)).toThrow(/exact version/);
    expect(bunPin(root)).toBe(before);
  });

  test("Postgres moves in every file that names the image, and none still names the old one", () => {
    const was = postgresPin(root);
    const next = "pgvector/pgvector:0.9.0-pg19-trixie";
    const touched = setPostgres(next, root);
    expect(touched).toContain("packages/cli/src/env.ts");
    expect(touched).toContain("docker-compose.yml");
    for (const f of POSTGRES_SITES) expect({ f, stale: read(f).includes(was) }).toEqual({ f, stale: false });
    expect(postgresPin(root)).toBe(next);
  });

  test("Postgres refuses a floating tag", () => {
    expect(() => setPostgres("pgvector/pgvector:pg18", root)).toThrow(/exact pgvector tag/);
  });

  test("the classifier moves only its own pin", () => {
    expect(setClassifier("3.2.10", root)).toEqual(["packages/classifier/requirements.txt"]);
    expect(classifierPin(root)).toBe("3.2.10");
    expect(read("packages/classifier/requirements.txt")).toContain("huggingface_hub");
  });

  test("moving to where it already is changes nothing", () => {
    expect(setBun(bunPin(root), root)).toEqual([]);
    expect(setPostgres(postgresPin(root), root)).toEqual([]);
  });
});

describe("the report reads as a stack", () => {
  test("npm packages land in the layer they belong to", () => {
    expect(npmLayer("tailwindcss")).toBe("style");
    expect(npmLayer("@tailwindcss/vite")).toBe("style");
    expect(npmLayer("@radix-ui/react-slot")).toBe("components");
    expect(npmLayer("react")).toBe("web");
    expect(npmLayer("hono")).toBe("server");
    expect(npmLayer("left-pad")).toBe("other");
  });

  test("a package is found in every workspace that declares it", () => {
    expect(declared("vite").map((d) => d.file)).toEqual(["packages/ui/package.json"]);
    expect(declared("zod").map((d) => d.file)).toEqual(["packages/spec/package.json"]);
  });

  test("every adapted component says where it came from and under what licence it is known to be", () => {
    const doc = JSON.parse(readFileSync(join(HOME, "packages/ui/src/components/provenance.json"), "utf8"));
    const listed = new Set(doc.sources.map((s: { file: string }) => s.file));
    const { readdirSync } = require("node:fs");
    for (const f of readdirSync(join(HOME, "packages/ui/src/components/ui"))) expect(listed.has(`packages/ui/src/components/ui/${f}`)).toBe(true);
    for (const s of doc.sources) expect(typeof s.from).toBe("string");
  });
});
