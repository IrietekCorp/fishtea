/** seed: "insert" — the seed file adds missing rows and leaves changed ones alone, against a real Postgres. */
import { expect, test, afterAll } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadApp } from "@fishtea/spec";
import { connect, migrate, seed, reset } from "../src/index.ts";

const db = connect(process.env.FISHTEA_TEST_DATABASE_URL ?? "postgres://fishtea:fishtea@localhost:5434/fishtea");
const dir = mkdtempSync(join(tmpdir(), "fishtea-seed-"));
afterAll(async () => { await db.end(); rmSync(dir, { recursive: true, force: true }); });

test("an insert-seeded entity keeps an operator's edit; an upsert-seeded one is reset by the file", async () => {
  cpSync(resolve(import.meta.dir, "../../../templates/ecommerce"), dir, { recursive: true });
  const spec = JSON.parse(readFileSync(join(dir, "spec.json"), "utf8"));
  spec.entities.customer.seed = "insert";
  writeFileSync(join(dir, "spec.json"), JSON.stringify(spec, null, 2));
  writeFileSync(join(dir, "seed/customer.json"), JSON.stringify([{ id: "cu_seed", email: "seed@example.com", name: "From the file" }]));
  const app = loadApp(dir);
  await reset(db); await migrate(db, app); await seed(db, app);
  await db`UPDATE business.customer SET name = 'Edited at /admin' WHERE id = 'cu_seed'`;
  writeFileSync(join(dir, "seed/customer.json"), JSON.stringify([{ id: "cu_seed", email: "seed@example.com", name: "From the file" }, { id: "cu_new", email: "new@example.com", name: "New" }]));
  await seed(db, app);
  const rows = await db`SELECT id, name FROM business.customer WHERE id IN ('cu_seed', 'cu_new') ORDER BY id`;
  expect([...rows]).toEqual([{ id: "cu_new", name: "New" }, { id: "cu_seed", name: "Edited at /admin" }]);

  spec.entities.customer.seed = "upsert";
  writeFileSync(join(dir, "spec.json"), JSON.stringify(spec, null, 2));
  await seed(db, loadApp(dir));
  expect((await db`SELECT name FROM business.customer WHERE id = 'cu_seed'`)[0].name).toBe("From the file");
});
