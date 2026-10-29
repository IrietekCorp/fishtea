/**
 * Client for the needle3 pool service (packages/classifier). Hard budget: past budgetMs the request is
 * aborted and the caller pours `ask` (BLUEPRINT §9). Never waits past budget.
 */
import type { ToolSpec } from "@fishtea/spec";
import type { Classifier, ClassifyRequest, ClassifyResult } from "./index.ts";

export class NeedleClient implements Classifier {
  readonly name = "needle3";
  constructor(private baseUrl = process.env.CLASSIFIER_URL ?? "http://localhost:8081") {}

  async classify(req: ClassifyRequest): Promise<ClassifyResult> {
    const t0 = performance.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), req.budgetMs);
    try {
      const res = await fetch(`${this.baseUrl}/classify`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: req.text, context: req.context, tools: req.tools.map((t) => t.name), budgetMs: req.budgetMs, maxTokens: req.maxTokens }),
        signal: ctl.signal,
      });
      if (!res.ok) return { calls: [], confidence: 0, ms: performance.now() - t0, classifier: this.name, error: `pool ${res.status}` };
      const j: any = await res.json();
      return {
        calls: (j.function_calls ?? []).map((c: any) => ({ name: c.name, arguments: c.arguments ?? {} })),
        confidence: Number(j.confidence ?? 0),
        reasoning: j.reasoning,
        embedding: Array.isArray(j.embedding) ? j.embedding : undefined,
        ms: performance.now() - t0,
        classifier: this.name,
      };
    } catch (e) {
      const timedOut = (e as Error).name === "AbortError" || (e as Error).name === "TimeoutError";
      return { calls: [], confidence: 0, ms: performance.now() - t0, classifier: this.name, timedOut, error: timedOut ? "budget exceeded" : String((e as Error).message) };
    } finally { clearTimeout(timer); }
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/embed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ texts }), signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`embed ${res.status}`);
    return ((await res.json()) as any).embeddings;
  }

  async reload(tools: ToolSpec[], subsets?: string[][]): Promise<void> {
    const res = await fetch(`${this.baseUrl}/reload`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tools, subsets }), signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`reload ${res.status}: ${await res.text()}`);
  }

  async health(): Promise<{ ok: boolean; detail?: unknown }> {
    try {
      const res = await fetch(`${this.baseUrl}/healthz`, { signal: AbortSignal.timeout(1500) });
      const j = await res.json().catch(() => ({}));
      return { ok: res.ok && (j as any).ok !== false, detail: j };
    } catch (e) { return { ok: false, detail: String((e as Error).message) }; }
  }
}
