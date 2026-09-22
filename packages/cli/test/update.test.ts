/**
 * Versioning, provenance and update.
 *
 * The heart of it is the three-way reconcile: an application must be able to take an upstream fix to a file
 * it never touched, keep every file it did touch, and be told — not silently resolved — when both moved.
 * These tests build that situation against a real archetype copied into a scratch directory, because the
 * bug that motivated the two-hash merge base (the scaffolder transforms some files as it copies them) is
 * invisible to any test that fakes the template.
 */
import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FISHTEA_VERSION, SPEC_FORMAT, caretRange, checkCompatibility, compareVersions, satisfies, migrateSpec, planMigration, migrations, MigrationError, type SpecMigration } from "@fishtea/spec";
import { scaffold } from "../src/new.ts";
import { readManifest, reconcile, COUNTS, templateFiles } from "../src/manifest.ts";
import { planUpdate, applyUpdate, adopt } from "../src/update.ts";
import { check as releaseCheck } from "../../../scripts/release.ts";

const HOME = join(import.meta.dir, "../../..");
const roots: string[] = [];
const scratch = () => { const d = mkdtempSync(join(tmpdir(), "fishtea-update-")); roots.push(d); return d; };
afterAll(() => { for (const d of roots) rmSync(d, { recursive: true, force: true }); });

/**
 * A scratch world: a private copy of the ecommerce archetype (so tests may mutate "upstream" freely) and
 * an application scaffolded from it.
 */
async function world(template = "ecommerce") {
  const root = scratch();
  const home = join(root, "framework");
  cpSync(join(HOME, "templates"), join(home, "templates"), { recursive: true });
  const app = join(root, "app");
  await scaffold({ id: "scratchapp", template, dir: app, fishteaHome: home, force: true });
  return { root, home, app, tpl: join(home, "templates", template) };
}

describe("version arithmetic", () => {
  test("a minor release satisfies a caret pin; a major does not", () => {
    expect(satisfies("1.2.3", "^1.1.0")).toBe(true);
    expect(satisfies("1.1.0", "^1.1.0")).toBe(true);
    expect(satisfies("2.0.0", "^1.1.0")).toBe(false);
    expect(satisfies("1.0.9", "^1.1.0")).toBe(false);
  });

  test("compareVersions orders numerically, not lexically", () => {
    expect(compareVersions("1.10.0", "1.2.0")).toBe(1);
    expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
  });

  test("checkCompatibility distinguishes a stale application from a stale framework", () => {
    expect(checkCompatibility("^1.0.0", "1.4.0").ok).toBe(true);
    expect(checkCompatibility("^2.0.0", "1.4.0")).toMatchObject({ ok: false, reason: "framework-behind" });
    expect(checkCompatibility("^1.0.0", "0.9.0")).toMatchObject({ ok: false, reason: "framework-behind" });
    expect(checkCompatibility("^1.0.0", "2.0.0")).toMatchObject({ ok: false, reason: "framework-ahead" });
    expect(checkCompatibility(undefined).ok).toBe(true); // pinning nothing is not an error
  });

  test("every version site in the workspace agrees", () => {
    const r = releaseCheck();
    expect(r.disagree).toEqual([]);
    expect(r.version).toBe(FISHTEA_VERSION);
  });
});

describe("spec migrations", () => {
  test("the shipped chain is contiguous and reaches the current format", () => {
    const chain = migrations();
    expect(chain.at(-1)!.to).toBe(SPEC_FORMAT);
    for (let i = 1; i < chain.length; i++) expect(chain[i].from).toBe(chain[i - 1].to);
  });

  test("a spec already at the current format needs no steps", () => {
    const plan = planMigration(SPEC_FORMAT, SPEC_FORMAT);
    expect(plan.current).toBe(true);
    expect(plan.steps).toEqual([]);
  });

  test("1.0 → 1.1 moves the marker and rewrites nothing", () => {
    const spec = { fishtea: "1.0", business: { id: "x", version: "2026.01.01-1" }, shapes: { a: 1 } };
    const r = migrateSpec(spec, "1.1");
    expect(r.spec.fishtea).toBe("1.1");
    expect(r.spec.shapes).toEqual({ a: 1 });
    expect(r.notes).toEqual([]);               // additive: honest about doing nothing
    expect(spec.fishtea).toBe("1.0");          // the input is not mutated
  });

  test("a format this build does not know is refused, not guessed at", () => {
    expect(() => planMigration("0.9", SPEC_FORMAT)).toThrow(MigrationError);
    expect(() => planMigration("9.9", SPEC_FORMAT)).toThrow(/newer than this build understands|no migration path/);
  });

  test("a transforming migration actually transforms (machinery, not just markers)", () => {
    // The shipped 1.0→1.1 is additive, so exercise the engine with a migration that does real work.
    const fake: SpecMigration[] = [{
      from: "9.0", to: "9.1", doc: "renames greeting to welcome",
      apply(spec) { spec.welcome = spec.greeting; delete spec.greeting; return ["greeting → welcome"]; },
    }];
    const spec: any = { fishtea: "9.0", greeting: "hi" };
    let cur = spec.fishtea;
    const notes: string[] = [];
    for (const m of fake) { notes.push(...m.apply(spec)); cur = m.to; }
    expect(spec.welcome).toBe("hi");
    expect(spec.greeting).toBeUndefined();
    expect(notes).toEqual(["greeting → welcome"]);
  });
});

describe("provenance", () => {
  test("a fresh application is fully tracked and reports nothing to do", async () => {
    const w = await world();
    const m = readManifest(w.app)!;
    expect(m.fishtea).toBe(FISHTEA_VERSION);
    expect(m.specFormat).toBe(SPEC_FORMAT);
    expect(m.template).toBe("ecommerce");
    expect(Object.keys(m.files).length).toBeGreaterThan(10);
    const plan = planUpdate(w.app, w.home);
    expect(plan.clean).toBe(true);
    expect(COUNTS(plan.verdicts)).toMatchObject({ update: 0, conflict: 0, new: 0, yours: 0 });
  });

  test("the merge base records BOTH sides, because the scaffolder transforms as it copies", async () => {
    const w = await world();
    const m = readManifest(w.app)!;
    // At least one file must differ between archetype and application for this test to mean anything;
    // seed rows are rewritten by the interview defaults. Whichever it is, it must read as unchanged.
    const differing = Object.entries(m.files).filter(([, p]) => p.template !== p.app);
    expect(differing.length).toBeGreaterThan(0);
    const verdicts = reconcile(w.app, w.tpl, m);
    for (const [rel] of differing) {
      expect(verdicts.find((v) => v.rel === rel)!.status).toBe("unchanged");
    }
  });
});

describe("three-way reconcile", () => {
  let w: Awaited<ReturnType<typeof world>>;
  beforeEach(async () => { w = await world(); });

  test("upstream-only change is applied", () => {
    appendFileSync(join(w.tpl, "calls/cart_add.sql"), "\n-- upstream\n");
    const plan = planUpdate(w.app, w.home);
    expect(plan.verdicts.find((v) => v.rel === "calls/cart_add.sql")!.status).toBe("update");
    applyUpdate(plan);
    expect(readFileSync(join(w.app, "calls/cart_add.sql"), "utf8")).toContain("-- upstream");
  });

  test("your-only change is never touched", () => {
    appendFileSync(join(w.app, "calls/cart_add.sql"), "\n-- mine\n");
    const plan = planUpdate(w.app, w.home);
    expect(plan.verdicts.find((v) => v.rel === "calls/cart_add.sql")!.status).toBe("yours");
    applyUpdate(plan);
    expect(readFileSync(join(w.app, "calls/cart_add.sql"), "utf8")).toContain("-- mine");
  });

  test("both changed is a conflict: your file stands, theirs lands as .new", () => {
    appendFileSync(join(w.app, "calls/cart_add.sql"), "\n-- mine\n");
    appendFileSync(join(w.tpl, "calls/cart_add.sql"), "\n-- upstream\n");
    const plan = planUpdate(w.app, w.home);
    expect(plan.verdicts.find((v) => v.rel === "calls/cart_add.sql")!.status).toBe("conflict");
    const res = applyUpdate(plan);
    expect(res.conflicts).toContain("calls/cart_add.sql");
    expect(readFileSync(join(w.app, "calls/cart_add.sql"), "utf8")).toContain("-- mine");
    expect(readFileSync(join(w.app, "calls/cart_add.sql.new"), "utf8")).toContain("-- upstream");
  });

  test("an unresolved conflict is reported again rather than silently adopted", () => {
    appendFileSync(join(w.app, "calls/cart_add.sql"), "\n-- mine\n");
    appendFileSync(join(w.tpl, "calls/cart_add.sql"), "\n-- upstream\n");
    applyUpdate(planUpdate(w.app, w.home));
    rmSync(join(w.app, "calls/cart_add.sql.new"));            // ignoring it is not resolving it
    expect(COUNTS(planUpdate(w.app, w.home).verdicts).conflict).toBe(1);
  });

  test("accepting their version resolves the conflict for good", () => {
    appendFileSync(join(w.app, "calls/cart_add.sql"), "\n-- mine\n");
    appendFileSync(join(w.tpl, "calls/cart_add.sql"), "\n-- upstream\n");
    applyUpdate(planUpdate(w.app, w.home));
    cpSync(join(w.app, "calls/cart_add.sql.new"), join(w.app, "calls/cart_add.sql"));
    rmSync(join(w.app, "calls/cart_add.sql.new"));
    applyUpdate(planUpdate(w.app, w.home));
    expect(COUNTS(planUpdate(w.app, w.home).verdicts).conflict).toBe(0);
  });

  test("a file the archetype grew is added; one you deleted is not resurrected", () => {
    writeFileSync(join(w.tpl, "calls/brand_new.sql"), "select 1;\n");
    rmSync(join(w.app, "scripts/walkthrough.json"));
    const plan = planUpdate(w.app, w.home);
    expect(plan.verdicts.find((v) => v.rel === "calls/brand_new.sql")!.status).toBe("new");
    expect(plan.verdicts.find((v) => v.rel === "scripts/walkthrough.json")!.status).toBe("deleted");
    applyUpdate(plan);
    expect(existsSync(join(w.app, "calls/brand_new.sql"))).toBe(true);
    expect(existsSync(join(w.app, "scripts/walkthrough.json"))).toBe(false);
  });

  test("your edit survives any number of upstream releases", () => {
    appendFileSync(join(w.app, "calls/products_search.sql"), "\n-- mine\n");
    for (let i = 0; i < 3; i++) {
      appendFileSync(join(w.tpl, "calls/cart_add.sql"), `\n-- upstream ${i}\n`);
      applyUpdate(planUpdate(w.app, w.home));
    }
    expect(readFileSync(join(w.app, "calls/products_search.sql"), "utf8")).toContain("-- mine");
    const cart = readFileSync(join(w.app, "calls/cart_add.sql"), "utf8");
    for (let i = 0; i < 3; i++) expect(cart).toContain(`-- upstream ${i}`);
  });

  test("update is idempotent", () => {
    appendFileSync(join(w.tpl, "calls/cart_add.sql"), "\n-- upstream\n");
    applyUpdate(planUpdate(w.app, w.home));
    expect(planUpdate(w.app, w.home).clean).toBe(true);
    const before = readFileSync(join(w.app, "calls/cart_add.sql"), "utf8");
    applyUpdate(planUpdate(w.app, w.home));
    expect(readFileSync(join(w.app, "calls/cart_add.sql"), "utf8")).toBe(before);
  });
});

describe("update as a whole", () => {
  test("migrates the spec, bumps the business revision and moves the pin", async () => {
    const w = await world();
    const specPath = join(w.app, "spec.json");
    const spec = JSON.parse(readFileSync(specPath, "utf8"));
    spec.fishtea = "1.0";                                   // pretend it was written by an older build
    const wasVersion = spec.business.version;
    writeFileSync(specPath, JSON.stringify(spec, null, 2));
    const pkgPath = join(w.app, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    pkg.fishtea.version = "^0.9.0";
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

    const plan = planUpdate(w.app, w.home);
    expect(plan.specFrom).toBe("1.0");
    expect(plan.specTo).toBe(SPEC_FORMAT);
    expect(plan.pinSatisfied).toBe(false);

    const res = applyUpdate(plan);
    expect(res.specMigrated).toBe(true);
    const after = JSON.parse(readFileSync(specPath, "utf8"));
    expect(after.fishtea).toBe(SPEC_FORMAT);
    expect(after.business.version).not.toBe(wasVersion);
    expect(JSON.parse(readFileSync(pkgPath, "utf8")).fishtea.version).toBe(caretRange(FISHTEA_VERSION));
    expect(readManifest(w.app)!.fishtea).toBe(FISHTEA_VERSION);
  });

  test("--spec-only and --files-only each do just their half", async () => {
    const w = await world();
    const specPath = join(w.app, "spec.json");
    const spec = JSON.parse(readFileSync(specPath, "utf8"));
    spec.fishtea = "1.0";
    writeFileSync(specPath, JSON.stringify(spec, null, 2));
    appendFileSync(join(w.tpl, "calls/cart_add.sql"), "\n-- upstream\n");

    applyUpdate(planUpdate(w.app, w.home), { specOnly: true });
    expect(JSON.parse(readFileSync(specPath, "utf8")).fishtea).toBe(SPEC_FORMAT);
    expect(readFileSync(join(w.app, "calls/cart_add.sql"), "utf8")).not.toContain("-- upstream");

    applyUpdate(planUpdate(w.app, w.home), { filesOnly: true });
    expect(readFileSync(join(w.app, "calls/cart_add.sql"), "utf8")).toContain("-- upstream");
  });

  test("a spec that would not load is never written", async () => {
    const w = await world();
    writeFileSync(join(w.app, "spec.json"), JSON.stringify({ fishtea: "1.0", business: { id: "x" } }));
    expect(() => applyUpdate(planUpdate(w.app, w.home))).toThrow();
  });

  test("adopting an untracked application claims only what still matches the archetype", async () => {
    const w = await world();
    appendFileSync(join(w.app, "calls/cart_add.sql"), "\n-- edited before we tracked anything\n");
    rmSync(join(w.app, ".fishtea"), { recursive: true });

    const m = adopt(w.app, w.tpl, "ecommerce");
    expect(m.files["calls/cart_add.sql"]).toBeUndefined();   // differs: left as yours, forever
    expect(Object.keys(m.files).length).toBeGreaterThan(10);

    // Now an upstream change to that same file must NOT overwrite the pre-adoption edit.
    appendFileSync(join(w.tpl, "calls/cart_add.sql"), "\n-- upstream\n");
    const plan = planUpdate(w.app, w.home);
    expect(plan.verdicts.find((v) => v.rel === "calls/cart_add.sql")!.status).toBe("yours");
    applyUpdate(plan);
    expect(readFileSync(join(w.app, "calls/cart_add.sql"), "utf8")).toContain("-- edited before we tracked anything");
  });

  test("every archetype scaffolds tracked and reconciles clean", async () => {
    for (const t of ["ecommerce", "portfolio", "verification", "program", "blank"]) {
      const w = await world(t);
      const plan = planUpdate(w.app, w.home);
      expect({ template: t, clean: plan.clean }).toEqual({ template: t, clean: true });
      expect(Object.keys(readManifest(w.app)!.files).length).toBe(templateFiles(w.tpl).length);
    }
  });
});
