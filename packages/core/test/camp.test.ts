/** The second sample must run on the same engine with zero code changes (D13, Phase 9 check). */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { loadApp } from "@fishtea/spec";
import { connect, migrate, seed, reset, Engine, runScript, LexicalClassifier, type Response } from "../src/index.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const URL = process.env.FISHTEA_TEST_DATABASE_URL ?? "postgres://fishtea:fishtea@localhost:5434/fishtea";
const db = connect(URL);
const app = loadApp(resolve(ROOT, "templates/program"));
let engine: Engine;
let responses: Response[] = [];
const lines: string[] = [];

beforeAll(async () => {
  await reset(db);
  const r = await migrate(db, app);
  expect(r.created.length).toBe(9);
  const counts = await seed(db, app);
  expect(counts.session).toBe(3);
  expect(counts.event).toBe(120);
  engine = new Engine({ app, db, classifier: new LexicalClassifier() });
  await engine.primeLexical();
  const script = JSON.parse(readFileSync(resolve(ROOT, "templates/program/scripts/walkthrough.json"), "utf8"));
  responses = (await runScript(engine, script, { print: (l) => lines.push(l), pretty: true })).responses;
});
afterAll(async () => { console.log(lines.join("\n")); await db.end(); });

const find = (pred: (r: Response) => boolean) => responses.find(pred)!;

describe("program template on the same engine", () => {
  test("sessions answer with computed spotsLeft, filtered by age", () => {
    const r = find((r) => r.pour.kind === "answer" && (r.pour as any).shape === "findSession");
    expect((r.pour as any).answer.length).toBe(2); // teens week excluded for a 10-year-old
    expect((r.pour as any).answer[0].spotsLeft).toBe(15);
    expect((r.pour as any).next.some((c: any) => c.shape === "registerCamper")).toBe(true);
  });
  test("price quote applies the sibling discount from rules", () => {
    const r = find((r) => r.pour.kind === "answer" && (r.pour as any).shape === "quotePrice");
    expect((r.pour as any).answer).toMatchObject({ campers: 2, each: 450, siblingDiscount: 67.5, total: 832.5 });
    expect((r.pour as any).vessel).toBe("card");
  });
  test("FAQ search answers a question", () => {
    const r = find((r) => r.pour.kind === "answer" && (r.pour as any).shape === "askAboutCamp");
    expect((r.pour as any).answer.length).toBeGreaterThan(0);
  });
  test("register as stranger is gated to becomeKnown; as parent it runs the 6-step plan", () => {
    const gate = find((r) => r.pour.kind === "form" && (r.pour as any).shape === "becomeKnown");
    expect(gate.persona).toBe("stranger");
    const reg = find((r) => r.pour.kind === "answer" && (r.pour as any).shape === "registerCamper");
    expect(reg.persona).toBe("parent");
    const calls = (reg.pour as any).provenance.calls.map((c: any) => c.call);
    expect(calls).toEqual(["family.byVisitor", "sessions.get", "registrations.countByFamily", "enrol.check", "camper.add", "registration.create"]);
    expect((reg.pour as any).answer.registration.status).toBe("confirmed");
    expect((reg.pour as any).answer.registration.price).toBe(450);
  });
  test("second child gets the sibling discount; persona becomes enrolled", () => {
    const regs = responses.filter((r) => r.pour.kind === "answer" && (r.pour as any).shape === "registerCamper");
    expect(regs.length).toBe(2);
    expect((regs[1].pour as any).answer.registration.siblingDiscount).toBe(67.5);
    expect((regs[1].pour as any).answer.registration.price).toBe(382.5);
    expect(regs[1].persona).toBe("enrolled");
  });
  test("the ground refuses a 6-year-old: plan fails into a form with the rule's message", () => {
    const r = find((r) => r.pour.kind === "form" && (r.pour as any).shape === "registerCamper" && (r.pour as any).error);
    expect((r.pour as any).error).toMatch(/ages 8 to 14/);
    expect((r.pour as any).known.firstName).toBe("Tiny");
  });
  test("status is a timeline; schedule is a timeline of 40 events", () => {
    const st = find((r) => r.pour.kind === "answer" && (r.pour as any).shape === "registrationStatus");
    expect((st.pour as any).vessel).toBe("timeline");
    expect((st.pour as any).answer.registrations.length).toBe(2);
    const sc = find((r) => r.pour.kind === "answer" && (r.pour as any).shape === "sessionSchedule");
    expect((sc.pour as any).answer.events.length).toBe(40);
  });
});
