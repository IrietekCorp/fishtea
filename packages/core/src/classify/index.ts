import type { ToolSpec } from "@fishtea/spec";

export interface ClassifyRequest {
  text: string;
  /** last k turns, one line each, plus recalled turns labelled as prior context */
  context: string[];
  tools: ToolSpec[];
  budgetMs: number;
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
