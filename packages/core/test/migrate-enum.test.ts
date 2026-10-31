/**
 * migrate and enum CHECKs (1.8.2). An enum that gains a value on a database that already exists used to
 * keep its old CHECK, so the new value was refused at the first insert — ChicDuJour's staging seeded
 * vendors with a new adapter on start and restarted forever. Real Postgres, real migrations, no mocks.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadApp } from "@fishtea/spec";
import { connect, migrate, reset } from "../src/index.ts";
import { checkLiterals } from "../src/db/index.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const URL_ = process.env.FISHTEA_TEST_DATABASE_URL ?? "postgres://fishtea:fishtea@localhost:5434/fishtea";
const db = connect(URL_);
const dir = mkdtempSync(join(tmpdir(), "fishtea-enum-"));
cpSync(resolve(ROOT, "templates/ecommerce"), dir, { recursive: true });
const specPath = join(dir, "spec.json");
const original = readFileSync(specPath, "utf8");

/** The ecommerce app with vendor.adapter's values replaced. */
function withAdapters(values: string[]) {
  const s = JSON.parse(original);
  s.entities.vendor.fields.adapter = { ...s.entities.vendor.fields.adapter, values };
  writeFileSync(specPath, JSON.stringify(s, null, 2));
  return loadApp(dir);
}
// async: a postgres.js query is a lazy thenable, and expect().rejects needs a real Promise to run it
const insertVendor = async (id: string, adapter: string) => {
  await db`INSERT INTO business.vendor (id, name, adapter, status) VALUES (${id}, ${id}, ${adapter}, 'active')`;
};
const allowed = async () => {
  const [r] = await db`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'business."vendor"'::regclass AND conname = 'vendor_adapter_check'`;
  return checkLiterals(r.def).sort();
};

const BASE = JSON.parse(original).entities.vendor.fields.adapter.values as string[];

beforeAll(async () => { await reset(db); await migrate(db, withAdapters(BASE)); });
afterAll(async () => { await db.end(); rmSync(dir, { recursive: true, force: true }); });

describe("an enum's CHECK follows the spec", () => {
  test("reads values back from Postgres' rewritten form and from ours", () => {
    expect(checkLiterals(`CHECK ((adapter = ANY (ARRAY['local'::text, 'it''s'::text])))`)).toEqual(["local", "it's"]);
    expect(checkLiterals(`adapter IN ('a','b')`)).toEqual(["a", "b"]);
  });

  test("a value added to the spec is accepted after migrate, which says what it changed", async () => {
    await expect(insertVendor("v_before", "awin")).rejects.toThrow(/vendor_adapter_check/);
    const report = await migrate(db, withAdapters([...BASE, "awin", "rakuten"]));
    expect(report.changed).toEqual(["vendor.adapter: +awin +rakuten"]);
    expect(report.refused).toEqual([]);
    await insertVendor("v_awin", "awin");
    expect(await allowed()).toEqual([...BASE, "awin", "rakuten"].sort());
  });

  test("an unchanged enum is left alone (no churn on every start)", async () => {
    const report = await migrate(db, withAdapters([...BASE, "awin", "rakuten"]));
    expect(report.changed).toEqual([]);
  });

  test("removing a value is destructive: refused by default, the old CHECK kept", async () => {
    const report = await migrate(db, withAdapters([...BASE, "awin"]));
    expect(report.changed).toEqual([]);
    expect(report.refused).toEqual(["vendor.adapter: -rakuten (removes enum values)"]);
    expect(await allowed()).toContain("rakuten");
  });

  test("with allowDestructive it narrows, unless rows still hold the value", async () => {
    // awin is in use by v_awin: narrowing it away must fail and keep the constraint as it was
    const blocked = await migrate(db, withAdapters(BASE), { allowDestructive: true });
    expect(blocked.changed).toEqual([]);
    expect(blocked.refused[0]).toMatch(/^vendor\.adapter: -awin -rakuten \(rows still use a removed value/);
    expect(await allowed()).toContain("awin");

    await db`DELETE FROM business.vendor WHERE id = 'v_awin'`;
    const ok = await migrate(db, withAdapters(BASE), { allowDestructive: true });
    expect(ok.changed).toEqual(["vendor.adapter: -awin -rakuten"]);
    expect(await allowed()).toEqual([...BASE].sort());
  });

  test("a missing CHECK is restored", async () => {
    await db.unsafe(`ALTER TABLE business.vendor DROP CONSTRAINT vendor_adapter_check`);
    const report = await migrate(db, withAdapters(BASE));
    expect(report.changed).toEqual(["vendor.adapter: " + BASE.map((v) => `+${v}`).join(" ")]);
    await expect(insertVendor("v_bad", "teleport")).rejects.toThrow(/vendor_adapter_check/);
  });
});
