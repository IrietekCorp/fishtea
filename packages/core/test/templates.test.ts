/** Every archetype in templates/ must validate, migrate, seed and run its walkthrough on the same engine (D13, generalised). */
import { describe, expect, test, afterAll } from "bun:test";
import { resolve, join } from "node:path";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { loadApp, deriveTools } from "@fishtea/spec";
import { connect, migrate, seed, reset, Engine, runScript, LexicalClassifier, PlanError } from "../src/index.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const URL = process.env.FISHTEA_TEST_DATABASE_URL ?? "postgres://fishtea:fishtea@localhost:5434/fishtea";
const db = connect(URL);
afterAll(async () => { await db.end(); });

for (const name of readdirSync(join(ROOT, "templates")).sort()) {
  const dir = join(ROOT, "templates", name);
  if (!existsSync(join(dir, "spec.json"))) continue;
  describe(`template ${name}`, () => {
    test("validates, derives, has an onboarding interview", () => {
      const app = loadApp(dir);
      expect(deriveTools(app.spec).length).toBeGreaterThan(0);
      const onboard = JSON.parse(readFileSync(join(dir, "onboard.json"), "utf8"));
      expect(onboard.questions.length).toBeGreaterThan(2);
      for (const q of onboard.questions) expect(q.path || q.seed || q.apply, `${name}: question ${q.id} patches nothing`).toBeTruthy();
    });
    test("migrates, seeds and runs its walkthrough without plan errors", async () => {
      const app = loadApp(dir);
      await reset(db);
      await migrate(db, app);
      await seed(db, app);
      const engine = new Engine({ app, db, classifier: new LexicalClassifier() });
      await engine.primeLexical();
      const script = JSON.parse(readFileSync(join(dir, "scripts", "walkthrough.json"), "utf8"));
      const lines: string[] = [];
      const { responses } = await runScript(engine, script, { print: (l) => lines.push(l), pretty: true });
      const failed = responses.filter((r) => r.pour.kind === "form" && (r.pour as any).error && !/ages \d+ to \d+|not found|refuse/i.test((r.pour as any).error));
      if (failed.length) console.log(lines.join("\n"));
      expect(failed.map((r) => (r.pour as any).error)).toEqual([]);
      expect(responses.some((r) => r.pour.kind === "answer")).toBe(true);
      console.log(`\n== ${name} ==\n` + lines.join("\n"));
    }, 60000);
  });
}
