/**
 * Performance harness (BLUEPRINT §11). Runs a fixed script of utterances against a running core (HTTP),
 * N iterations, reports p50/p95/p99 per metric, writes results/<date>.json, diffs against baseline.json,
 * fails when a budget in budgets.json is exceeded. `--conventional` also measures the multi-page baseline
 * in conventional/ (a minimal Hono app doing the same task with routes and full page loads).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runConventional } from "./conventional.ts";

/** Same shape as the CLI's parsed flags; a repeated flag arrives as an array. */
export type Flags = Record<string, string | boolean | string[] | undefined>;
export interface BenchOptions { flags: Flags; positional: string[]; fishteaHome: string }

const here = new URL(".", import.meta.url).pathname;

export function pct(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

interface Sample { classify: number[]; plan: number[]; utterSingle: number[]; utterBridge: number[]; utterStructured: number[]; resume: number[]; bytes: number[]; kinds: Record<string, number> }

const SCRIPT: (Record<string, unknown> & { kind: "single" | "bridge" | "structured" | "arrive" })[] = [
  { arrive: true, kind: "arrive" },
  { text: "something bold for a wedding under 60 dollars", kind: "single" },
  { text: "what's trending", kind: "single" },
  { shape: "becomeKnown", args: { email: "bench@example.com" }, confirm: true, kind: "structured" },
  { text: "compare p_pearl_drop and p_brass_threaders", kind: "bridge" },
  { text: "more like p_pearl_drop", kind: "bridge" },
  { shape: "addToCart", args: { productId: "p_bandana" }, confirm: true, kind: "structured" }, // stock 50: survives many iterations
  { text: "show my cart", kind: "single" },
  { shape: "checkout", args: { email: "bench@example.com", shipTo: { name: "B", line1: "1", city: "Austin", region: "TX", postal: "78701", country: "US" } }, confirm: true, kind: "structured" },
  { arrive: true, kind: "arrive" },
];

export async function bench(o: BenchOptions) {
  const core = String(o.flags.core ?? process.env.FISHTEA_CORE_URL ?? "http://localhost:3000");
  const iterations = Number(o.flags.iterations ?? 20);
  const budgets = JSON.parse(readFileSync(join(here, "..", "budgets.json"), "utf8"));
  const health = await fetch(`${core}/healthz`).then((r) => r.json()).catch(() => null) as any;
  if (!health) throw new Error(`core not reachable at ${core}`);
  console.log(`bench: ${core} · classifier ${health.classifier?.name} · ${iterations} iterations × ${SCRIPT.length} steps`);
  const s: Sample = { classify: [], plan: [], utterSingle: [], utterBridge: [], utterStructured: [], resume: [], bytes: [], kinds: {} };

  for (let i = 0; i < iterations; i++) {
    let visitor: string | null = null;
    for (const step of SCRIPT) {
      const { kind, ...body } = step;
      const t0 = performance.now();
      const res = kind === "arrive"
        ? await fetch(`${core}/`, { headers: visitor ? { "x-fishtea-visitor": visitor } : {} })
        : await fetch(`${core}/utter`, { method: "POST", headers: { "content-type": "application/json", ...(visitor ? { "x-fishtea-visitor": visitor } : {}) }, body: JSON.stringify(body) });
      const text = await res.text();
      const ms = performance.now() - t0;
      s.bytes.push(text.length);
      const j = JSON.parse(text);
      visitor = j.visitor?.id ?? visitor;
      const k = `${kind}:${j.pour ? `${j.pour.kind}${j.pour.reason ? `(${j.pour.reason})` : ""}${j.pour.error ? "(error)" : ""}` : `http ${res.status}`}`;
      s.kinds[k] = (s.kinds[k] ?? 0) + 1;
      if (kind === "arrive") { s.resume.push(ms); continue; }
      if (kind === "structured") { s.utterStructured.push(ms); if (j.timings?.planMs) s.plan.push(j.timings.planMs); continue; }
      if (j.timings?.classifyMs) s.classify.push(j.timings.classifyMs);
      if (j.timings?.planMs && kind === "single") s.plan.push(j.timings.planMs);
      (kind === "bridge" ? s.utterBridge : s.utterSingle).push(ms);
    }
  }

  const row = (name: string, xs: number[]) => ({ name, n: xs.length, p50: +pct(xs, 50).toFixed(1), p95: +pct(xs, 95).toFixed(1), p99: +pct(xs, 99).toFixed(1) });
  const rows = [row("classify", s.classify), row("plan.single", s.plan), row("utter.single", s.utterSingle), row("utter.bridge", s.utterBridge), row("utter.structured", s.utterStructured), row("resume", s.resume)];
  const checks: { metric: string; value: number; budget: number; ok: boolean }[] = [];
  const check = (metric: string, value: number) => { const b = budgets[metric]; if (b !== undefined) checks.push({ metric, value, budget: b, ok: value <= b }); };
  check("classify.p50", rows[0].p50); check("classify.p95", rows[0].p95); check("plan.single.p95", rows[1].p95); check("utter.single.p95", rows[2].p95); check("utter.bridge.p95", rows[3].p95); check("utter.structured.p95", rows[4].p95); check("resume.p95", rows[5].p95);

  console.log("\n  metric             n    p50     p95     p99");
  for (const r of rows) console.log(`  ${r.name.padEnd(17)} ${String(r.n).padStart(3)} ${String(r.p50).padStart(7)} ${String(r.p95).padStart(7)} ${String(r.p99).padStart(7)}`);
  console.log("\n  budget                 value   budget");
  for (const c of checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.metric.padEnd(20)} ${String(c.value).padStart(7)} ${String(c.budget).padStart(8)}`);
  const bytesPerTask = s.bytes.reduce((a, b) => a + b, 0) / iterations;
  console.log(`\n  bytes per task (JSON pours): ${Math.round(bytesPerTask)}`);
  const textSteps = SCRIPT.filter((x) => x.kind === "single" || x.kind === "bridge").length * iterations;
  console.log(`  pours: ${Object.entries(s.kinds).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  const answered = (s.kinds["single:answer"] ?? 0) + (s.kinds["bridge:answer"] ?? 0);
  console.log(`  text utterances answered: ${answered}/${textSteps} (an ask/form counts as latency but not as an answer)`);
  checks.push({ metric: "text.answered.ratio", value: +(answered / textSteps).toFixed(2), budget: budgets["text.answered.ratio"] ?? 0.9, ok: answered / textSteps >= (budgets["text.answered.ratio"] ?? 0.9) });

  let conventional: any = null;
  if (o.flags.conventional) {
    conventional = await runConventional({ iterations, fishteaHome: o.fishteaHome });
    console.log(`\n  conventional multi-page baseline: task ${conventional.taskMs.p50.toFixed(0)} ms p50 / ${conventional.taskMs.p95.toFixed(0)} ms p95 over ${conventional.requests} requests, ${conventional.bytes} bytes`);
    const fishteaTask = pct(sumTasks(s), 50);
    console.log(`  fishtea task              ${fishteaTask.toFixed(0)} ms p50 over ${SCRIPT.length} requests, ${Math.round(bytesPerTask)} bytes`);
  }

  const out = { at: new Date().toISOString(), core, classifier: health.classifier?.name, iterations, rows, checks, bytesPerTask, kinds: s.kinds, conventional };
  const dir = join(here, "..", "results");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  const baselinePath = join(here, "..", "baseline.json");
  if (existsSync(baselinePath)) {
    const base = JSON.parse(readFileSync(baselinePath, "utf8"));
    console.log("\n  vs baseline (p95):");
    for (const r of rows) { const b = base.rows?.find((x: any) => x.name === r.name); if (b) console.log(`  ${r.name.padEnd(17)} ${String(b.p95).padStart(7)} → ${String(r.p95).padStart(7)}  ${r.p95 <= b.p95 * 1.1 ? "ok" : "slower"}`); }
  } else if (o.flags.baseline) { writeFileSync(baselinePath, JSON.stringify(out, null, 2)); console.log(`\n  wrote baseline.json`); }
  console.log(`\n  results → ${file}`);
  const failed = checks.filter((c) => !c.ok);
  if (failed.length && o.flags["no-fail"] !== true) { console.error(`\n✗ ${failed.length} budget(s) exceeded`); process.exit(1); }
}

function sumTasks(s: Sample): number[] {
  const n = Math.min(s.resume.length / 2, s.utterSingle.length / 3);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(s.resume[i * 2] + s.utterSingle[i * 3] + s.utterSingle[i * 3 + 1] + s.utterSingle[i * 3 + 2] + s.utterBridge[i * 2] + s.utterBridge[i * 2 + 1] + s.utterStructured[i * 3] + s.utterStructured[i * 3 + 1] + s.utterStructured[i * 3 + 2] + s.resume[i * 2 + 1]);
  return out;
}
