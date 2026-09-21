/**
 * Dev/offline classifier and benchmark baseline (BLUEPRINT D5, §9). Never used in production.
 * Vocabulary matching over tool names/descriptions/parameters plus optional value vocabularies
 * (distinct values of indexed array fields, e.g. moods) so it can fill arguments from text.
 */
import type { ToolSpec } from "@fishtea/spec";
import type { Classifier, ClassifyRequest, ClassifyResult, FunctionCall } from "./index.ts";

const STOP = new Set(["a", "an", "the", "i", "me", "my", "we", "us", "our", "you", "your", "it", "to", "for", "of", "in", "on", "at", "and", "or", "is", "are", "be", "do", "does", "with", "that", "this", "these", "those", "want", "like", "need", "please", "can", "could", "would", "show", "find", "get", "give", "something", "some", "one", "by", "from", "toward", "towards", "into", "look", "looking", "feel", "feeling", "today", "what", "whats", "how", "much", "any", "all", "so", "just", "really", "very", "under", "over", "than", "less", "more"]);
const stem = (w: string) => w.replace(/(ies)$/, "y").replace(/(sses|shes|ches|xes)$/, (m) => m.slice(0, -2)).replace(/(ing|ed|es|s)$/, "");
export const tokens = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9$@.]+/).filter((w) => w.length > 1 && !STOP.has(w));
const splitCamel = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[._-]/g, " ").toLowerCase();

export interface LexicalOptions {
  /** param name → known values (e.g. mood → ["bold","quiet"]) */
  vocab?: Record<string, string[]>;
  /** extra phrases per tool name that strongly indicate it */
  triggers?: Record<string, string[]>;
}

export class LexicalClassifier implements Classifier {
  readonly name = "lexical";
  private vocab: Record<string, string[]>;
  private triggers: Record<string, string[]>;
  constructor(opts: LexicalOptions = {}) { this.vocab = opts.vocab ?? {}; this.triggers = opts.triggers ?? {}; }
  setVocab(v: Record<string, string[]>) { this.vocab = v; }

  async health() { return { ok: true, detail: { classifier: "lexical", devOnly: true } }; }

  async classify(req: ClassifyRequest): Promise<ClassifyResult> {
    const t0 = performance.now();
    const text = req.text.toLowerCase();
    const utt = new Set(tokens(text).map(stem));
    const scored: { tool: ToolSpec; score: number; args: Record<string, unknown> }[] = [];
    for (const tool of req.tools) {
      let score = 0;
      const nameWords = tokens(splitCamel(tool.name)).map(stem);
      const descWords = tokens(tool.description ?? "").map(stem);
      for (const w of nameWords) if (utt.has(w)) score += 3;
      if (text.replace(/[^a-z]/g, "").includes(tool.name.toLowerCase())) score += 4;
      for (const w of new Set(descWords)) if (utt.has(w)) score += 1.5;
      for (const phrase of [...(tool.triggers ?? []), ...(this.triggers[tool.name] ?? [])]) if (text.includes(phrase.toLowerCase())) score += 6;
      const args = this.extract(tool, text, utt);
      // catch-all arguments (text/question/query) are filled from the whole utterance and prove nothing
      score += Object.keys(args).filter((k) => !/^(text|question|query|q|message|need|role)$/i.test(k)).length * 2;
      if (score >= 3 || (score >= 2 && Object.keys(args).length)) scored.push({ tool, score, args });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    const calls: FunctionCall[] = [];
    let confidence = 0;
    if (top) {
      const second = scored[1]?.score ?? 0;
      confidence = Math.min(0.97, 0.35 + top.score / 12 + (top.score - second) / 20);
      calls.push({ name: top.tool.name, arguments: top.args });
      if (scored[1] && scored[1].score >= top.score * 0.8 && scored[1].score >= 4) calls.push({ name: scored[1].tool.name, arguments: scored[1].args });
    }
    return { calls, confidence: top ? Number(confidence.toFixed(3)) : 0, reasoning: top ? `lexical: ${scored.slice(0, 3).map((s) => `${s.tool.name}=${s.score.toFixed(1)}`).join(" ")}` : "lexical: no overlap", ms: performance.now() - t0, classifier: this.name };
  }

  private extract(tool: ToolSpec, text: string, utt: Set<string>): Record<string, unknown> {
    const args: Record<string, unknown> = {};
    const props: Record<string, any> = tool.parameters?.properties ?? {};
    const money = text.match(/(?:under|below|less than|max|up to|budget of|<)\s*\$?\s*(\d+(?:\.\d+)?)|\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:dollars|bucks|usd)/);
    const email = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
    const fromToRaw = text.match(/(?:from\s+)?(.+?)\s+(?:to|toward|towards|into)\s+(.+?)(?:[,.]|$| under| below| for| max)/);
    const fromTo = fromToRaw ? [fromToRaw[0], fromToRaw[1].replace(/^(?:move|take|shift|go|bring|turn|i want to go|i'd like to go|i want|help me go)?\s*(?:my|the|a|from)?\s*/, "").replace(/\s+(?:look|style|vibe|aesthetic)$/, ""), fromToRaw[2].replace(/\s+(?:look|style|vibe|aesthetic)$/, "")] : null;
    const ints = [...text.matchAll(/\b(\d{1,3})\b/g)].map((m) => Number(m[1]));
    const ids = [...text.matchAll(/\b((?:p|ord|reg|fam|cmp|june|july|aug)[_-][a-z0-9_-]+)\b/g)].map((m) => m[1]);
    for (const [name, schema] of Object.entries(props)) {
      const lname = name.toLowerCase();
      if (schema.type === "number" && /price|budget|max|amount/.test(lname) && money) { args[name] = Number(money[1] ?? money[2] ?? money[3]); continue; }
      if (schema.format === "email" || lname === "email") { if (email) args[name] = email[0]; continue; }
      if (lname === "from" && fromTo) { args[name] = fromTo[1].trim(); continue; }
      if (lname === "to" && fromTo) { args[name] = fromTo[2].trim(); continue; }
      if (schema.enum) { const hit = schema.enum.find((v: string) => new RegExp(`\\b${v.toLowerCase()}\\b`).test(text)); if (hit) args[name] = hit; continue; }
      if (schema.type === "integer" && /age|qty|quantity|campers|days|kids|children/.test(lname)) {
        const m = text.match(new RegExp(`(\\d{1,3})\\s*(?:-|\\s)?(?:year|yr|yo|years old)`)) ?? (lname === "campers" ? text.match(/(\d+)\s*(?:kids|children|campers|siblings)/) : null) ?? (lname === "days" ? text.match(/(\d+)\s*days?/) : null) ?? (lname === "qty" ? text.match(/(\d+)\s*(?:x|of|pcs|pieces)/) : null);
        if (m) args[name] = Number(m[1]); else if (lname === "age" && ints.length === 1 && ints[0] >= 5 && ints[0] <= 18) args[name] = ints[0];
        continue;
      }
      if (/id$/i.test(name) && ids.length) { const [a, b] = ids; args[name] = lname.startsWith("right") ? (b ?? a) : a; continue; }
      if (schema.type === "string") {
        const vocab = this.vocab[name] ?? this.vocab[lname];
        if (vocab) {
          const hit = vocab.find((v) => text.includes(v.toLowerCase()) || utt.has(stem(v.toLowerCase())));
          if (hit) { args[name] = hit; continue; }
        }
        if (lname === "question" || lname === "text") args[name] = text.trim();
        if (lname === "need" && /because|need|afford|hardship|single|income/.test(text)) args[name] = text.trim();
      }
    }
    return args;
  }
}
