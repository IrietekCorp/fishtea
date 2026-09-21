/**
 * Run the full loop with no UI (BLUEPRINT §10 "Headless proof"). A script is a list of utterances; each is
 * text, a chip {shape,args}, a form submit {shape,args,submit}, a confirm {shape,args,confirm}, an arrival
 * {arrive:true}, a rewind {rewind: <seq>} or a new-visit marker {newTrail: true}.
 */
import type { Engine, Utterance, Response } from "./engine.ts";

export type ScriptStep = Utterance | { rewind: number } | { newTrail: true } | { note: string };

export interface HeadlessOptions { visitorId?: string | null; envelope?: Record<string, string>; print?: (line: string) => void; pretty?: boolean }

export async function runScript(engine: Engine, script: ScriptStep[], opts: HeadlessOptions = {}): Promise<{ visitorId: string; responses: Response[] }> {
  const print = opts.print ?? ((l) => console.log(l));
  let visitorId = opts.visitorId ?? null;
  let hadToken = false;
  const responses: Response[] = [];
  const seqToTurn = new Map<number, string>();
  let branchFrom: string | null = null;
  for (const step of script) {
    if ("note" in step) { print(`# ${step.note}`); continue; }
    if ("newTrail" in step) {
      if (visitorId) await engine.newVisit(visitorId, { ...(opts.envelope ?? {}), cookie: visitorId });
      print(`# new trail for ${visitorId}`);
      continue;
    }
    if ("rewind" in step) {
      const id = seqToTurn.get(step.rewind);
      if (!id || !visitorId) { print(`# cannot rewind to seq ${step.rewind}`); continue; }
      const r = await engine.rewind(visitorId, id);
      branchFrom = id;
      print(`# rewound to seq ${r.seq} (${id})`);
      continue;
    }
    const res = await engine.utter(step, { visitorId, envelope: opts.envelope, hadToken, branchFrom });
    branchFrom = null;
    visitorId = res.visitor.id;
    hadToken = true;
    seqToTurn.set(res.turn.seq, res.turn.id);
    responses.push(res);
    print(opts.pretty ? pretty(step, res) : JSON.stringify({ utterance: step, ...res }));
  }
  return { visitorId: visitorId!, responses };
}

export function pretty(step: Utterance, res: Response): string {
  const u = "text" in step ? `"${step.text}"` : "shape" in step ? `[${step.shape}${step.confirm ? " ✓" : step.submit ? " ⏎" : ""} ${JSON.stringify(step.args ?? {})}]` : "(arrive)";
  const p = res.pour as any;
  const head = `#${res.turn.seq} ${res.persona.padEnd(12)} ${u}`;
  let body = "";
  switch (p.kind) {
    case "answer": body = `→ answer ${p.shape} · ${p.vessel} · ${p.provenance.records} records · calls ${p.provenance.calls.map((c: any) => c.call).join(" → ")}${p.provenance.wrote.length ? ` · wrote ${p.provenance.wrote.join(",")}` : ""}`; break;
    case "form": body = `→ form ${p.shape}${p.error ? ` ✗ ${p.error}` : ""}${p.errors ? ` missing ${Object.keys(p.errors).join(",")}` : ""}${p.hint ? ` · ${p.hint}` : ""}`; break;
    case "confirm-write": body = `→ confirm-write ${p.shape} · ${p.summary}`; break;
    case "ask": body = `→ ask (${p.reason}) ${p.phrase} · options ${p.options.map((o: any) => o.shape).join(",")}`; break;
    case "notification": body = `→ notification ${p.text}`; break;
  }
  const meta = res.understood ? ` · ${res.understood.shape}@${res.understood.confidence.toFixed(2)}` : "";
  const notes = res.notifications.length ? `\n     🔔 ${res.notifications.map((n: any) => n.text).join(" | ")}` : "";
  return `${head}\n     ${body}${meta} · ${res.timings.totalMs}ms (classify ${res.timings.classifyMs}, plan ${res.timings.planMs}) · ${res.classifier}${notes}`;
}
