import type { ToolSpec } from "@fishtea/spec";

export interface ClassifyRequest {
  text: string;
  /** last k turns, one line each, plus recalled turns labelled as prior context */
  context: string[];
  tools: ToolSpec[];
  budgetMs: number;
  /** Cap on tokens the classifier may emit. Latency is decode length, so this is the tail. */
  maxTokens?: number;
}

export interface FunctionCall { name: string; arguments: Record<string, unknown> }

export interface ClassifyResult {
  calls: FunctionCall[];
  confidence: number;
  reasoning?: string;
  embedding?: number[];
  ms: number;
  classifier: string;
  timedOut?: boolean;
  error?: string;
}

export interface Classifier {
  readonly name: string;
  classify(req: ClassifyRequest): Promise<ClassifyResult>;
  embed?(texts: string[]): Promise<number[][]>;
  /** subsets = the persona-filtered tool lists, so a pool can pre-warm one agent per persona */
  reload?(tools: ToolSpec[], subsets?: string[][]): Promise<void>;
  health(): Promise<{ ok: boolean; detail?: unknown }>;
}

export { LexicalClassifier } from "./lexical.ts";
export { NeedleClient } from "./needle.ts";

/**
 * Hold a classifier to the budget it was given, whatever it does internally.
 *
 * The shipped classifiers honour `budgetMs` themselves and this never fires for them. A plugin is a
 * different matter: it is somebody else's code on the request path, and the rule that every classify
 * call is bounded — past the budget the pour is `ask`, never a dumber brain — has to hold whether or
 * not the author remembered it. So the call races a timer, and a classifier that overruns produces the
 * same `timedOut` result a slow pool produces, which the engine already knows how to pour.
 *
 * The grace is because a well-behaved implementation returns *at* its budget; failing it at exactly
 * budgetMs would turn "just in time" into a timeout on every slow-but-correct call.
 */
export function withBudget(inner: Classifier, graceMs = 250): Classifier {
  return {
    get name() { return inner.name; },
    embed: inner.embed?.bind(inner),
    reload: inner.reload?.bind(inner),
    health: () => inner.health(),
    async classify(req: ClassifyRequest): Promise<ClassifyResult> {
      const t0 = performance.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const overrun = new Promise<ClassifyResult>((resolve) => {
        timer = setTimeout(() => resolve({
          calls: [], confidence: 0, ms: performance.now() - t0, classifier: inner.name,
          timedOut: true, error: `exceeded its ${req.budgetMs} ms budget`,
        }), req.budgetMs + graceMs);
      });
      try {
        return await Promise.race([inner.classify(req), overrun]);
      } catch (e) {
        // A throwing classifier must not throw out of the request: it is an unanswered turn, not a 500.
        return { calls: [], confidence: 0, ms: performance.now() - t0, classifier: inner.name, error: (e as Error).message };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
