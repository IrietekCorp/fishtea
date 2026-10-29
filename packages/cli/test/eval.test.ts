/**
 * The labelled set, and the checks that keep it honest.
 *
 * This is the one artefact in the project a spec cannot derive, and the only one that can settle what
 * `rules.classify.floor` should be or whether a gate that replaces the model's confidence is any good.
 * That makes a quietly wrong label worse than a missing one: it moves a derived threshold and says
 * nothing. So most of what is tested here is the validator refusing labels that cannot mean what they
 * say, and the archetypes' own sets passing it.
 */
import { describe, expect, test } from "bun:test";
import { loadApp } from "@fishtea/spec";
import { join, resolve } from "node:path";
import {
  checkCases, coverage, floorSweep, loadCases, recommendFloor, REFUSAL_TAGS,
  runCases, score, type CaseResult, type EvalCase, type EvalClassifier,
} from "../src/eval.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const ARCHETYPES = ["ecommerce", "portfolio", "program", "verification"] as const;
const shop = loadApp(join(ROOT, "templates/ecommerce"));
const shopCases = loadCases(shop);

/** Every case but the first, plus a mutated first — so a mutant is one bad label among many. */
const withFirst = (cs: EvalCase[], patch: Partial<EvalCase>): EvalCase[] => [{ ...cs[0], ...patch }, ...cs.slice(1)];

describe("the archetypes ship a set that means what it says", () => {
  for (const t of ARCHETYPES) {
    test(`${t}: every label is consistent with its spec`, () => {
      const app = loadApp(join(ROOT, "templates", t));
      expect({ t, problems: checkCases(app, loadCases(app)) }).toEqual({ t, problems: [] });
    });

    test(`${t}: no shape and no persona goes unexercised`, () => {
      const app = loadApp(join(ROOT, "templates", t));
      expect({ t, ...coverage(app, loadCases(app)) }).toEqual({ t, shapes: [], personas: [] });
    });

    test(`${t}: enough refusals to tell a good floor from a permissive one`, () => {
      // A set of positives only cannot separate the two populations a floor exists to separate, so it
      // would recommend zero every time and look right doing it.
      const cases = loadCases(loadApp(join(ROOT, "templates", t)));
      const refusals = cases.filter((c) => c.shape === null).length;
      expect({ t, enough: refusals >= Math.floor(cases.length / 5) }).toEqual({ t, enough: true });
    });

    test(`${t}: paraphrases exist, because they are the reason the model is here`, () => {
      // `plain` carries a shape's own trigger and the shipped lexical router gets those for free. The
      // gap between plain and paraphrase is the honest measure of what the model buys.
      const cases = loadCases(loadApp(join(ROOT, "templates", t)));
      expect(cases.filter((c) => c.tag === "paraphrase").length).toBeGreaterThan(5);
    });
  }

  test("a paraphrase never contains its own shape's trigger, or it is not one", () => {
    // Otherwise the population that is supposed to be hard for a dictionary quietly fills with cases a
    // dictionary gets right, and the comparison that justifies the model stops meaning anything.
    const triggers = new Map<string, string[]>();
    for (const [name, s] of Object.entries(shop.spec.shapes as Record<string, any>)) {
      if (s && typeof s === "object") triggers.set(name, (s.triggers ?? []).map((x: string) => x.toLowerCase()));
    }
    for (const c of shopCases.filter((x) => x.tag === "paraphrase" && x.shape)) {
      const own = triggers.get(c.shape!) ?? [];
      const leaked = own.filter((t) => c.text.toLowerCase().includes(t.trim()));
      expect({ text: c.text, leaked }).toEqual({ text: c.text, leaked: [] });
    }
  });
});

describe("the validator refuses a label that cannot mean what it says", () => {
  const cases = () => structuredClone(shopCases);
  const fails = (cs: EvalCase[], needle: string) => {
    const problems = checkCases(shop, cs);
    expect(problems.join("\n")).toContain(needle);
  };

  test("a persona this spec does not have", () => fails(withFirst(cases(), { persona: "wholesaler" }), `persona "wholesaler" is not in this spec`));
  test("a shape this spec does not have", () => fails(withFirst(cases(), { shape: "findProduct" }), `"findProduct" is not a shape`));
  test("an argument the shape does not take", () => fails(withFirst(cases(), { args: { colour: "red" } }), `has no argument "colour"`));
  test("an unknown tag", () => fails(withFirst(cases(), { tag: "tricky" as never }), `tag "tricky" is not one of`));
  test("no text at all", () => fails(withFirst(cases(), { text: "   " }), "no text"));

  test("a shape the asking persona is never offered", () => {
    // The single most damaging label, because it looks like a hard case and is an impossible one: the
    // tool is not in the subset, so no classifier could ever produce it and the case is a guaranteed
    // miss dragging the score down.
    fails(withFirst(cases(), { persona: "stranger", shape: "checkout" }), `stranger may not ask "checkout"`);
  });

  test("a refusal tag that names a shape", () =>
    fails(withFirst(cases(), { tag: "off-topic" }), "those tags mean the right answer is silence"));

  test("a routing tag with no shape", () =>
    fails(withFirst(cases(), { shape: null }), "a case with no shape belongs to"));

  test("a bare case that demands arguments", () => {
    // "bare" means the trigger alone, so the engine's missingRequired pours a form. A bare case with
    // arguments is testing the opposite behaviour under the wrong name.
    const cs = cases();
    const i = cs.findIndex((c) => c.tag === "bare" && c.shape === "checkout");
    cs[i] = { ...cs[i], args: { email: "sam@weaver.co" } };   // a real argument of checkout, so only the bare rule can catch it
    fails(cs, "tagged \"bare\" but demands arguments");
  });

  test("an anaphora case with nothing to refer back to", () => {
    const cs = cases();
    const i = cs.findIndex((c) => c.tag === "anaphora");
    cs[i] = { ...cs[i], context: [] };
    fails(cs, "carries no context");
  });

  test("the same case twice, which would weight the score", () => {
    fails([...cases(), cases()[0]], "a duplicate counts twice");
  });

  test("but the same sentence asked by a different persona is a different case", () => {
    // "check out" means checkout for a customer and silence for a stranger. That pair is the point of
    // the out-of-subset population, so the duplicate rule must key on the persona too.
    const both = shopCases.filter((c) => c.text === "check out");
    expect(both.map((c) => c.persona).sort()).toEqual(["customer", "stranger"]);
    expect(checkCases(shop, both)).toEqual([]);
  });
});

describe("coverage finds the holes", () => {
  test("a shape no case ever asks for", () => {
    expect(coverage(shop, shopCases.filter((c) => c.shape !== "checkout")).shapes).toContain("checkout");
  });
  test("a persona no case ever asks as", () => {
    expect(coverage(shop, shopCases.filter((c) => c.persona !== "mid-purchase")).personas).toContain("mid-purchase");
  });
});

// ── running and scoring ─────────────────────────────────────────────────────

/** A classifier with a fixed opinion, so scoring can be tested without a model. */
const canned = (answer: (text: string, tools: string[]) => { name: string; confidence: number } | null): EvalClassifier => ({
  name: "canned",
  async classify(req) {
    const a = answer(req.text, req.tools.map((t) => t.name));
    return { calls: a ? [{ name: a.name, arguments: {} }] : [], confidence: a?.confidence ?? 0, ms: 1 };
  },
});

describe("running the set", () => {
  test("a classifier is only ever offered the asking persona's tools", async () => {
    // This is what makes out-of-subset a real population rather than a label: the tool is absent, so
    // the only answer available is silence.
    const seen: Record<string, string[]> = {};
    const spy: EvalClassifier = {
      name: "spy",
      async classify(req) { seen[req.text + "|" + (req.context[0] ?? "")] = req.tools.map((t) => t.name); return { calls: [], confidence: 0, ms: 0 }; },
    };
    await runCases(shop, spy, shopCases);
    const strangerCheckout = Object.entries(seen).find(([k]) => k.startsWith("check out|"))![1];
    expect(strangerCheckout).not.toContain("checkout");
    expect(strangerCheckout).toContain("findProducts");
  });

  test("the prior turn reaches the classifier as context", async () => {
    let got: string[] = [];
    const spy: EvalClassifier = { name: "spy", async classify(req) { if (req.context.length) got = req.context; return { calls: [], confidence: 0, ms: 0 }; } };
    await runCases(shop, spy, shopCases.filter((c) => c.tag === "anaphora"));
    expect(got[0]).toContain("last answer listed:");
  });

  test("silence is correct exactly when the label says so", async () => {
    const mute = canned(() => null);
    const results = await runCases(shop, mute, shopCases);
    const s = score(results);
    expect(s.refusals.correct).toBe(s.refusals.n);
    expect(s.positives.correct).toBe(0);
    expect(s.correct).toBe(s.refusals.n);
  });

  test("an argument is checked by value, and loosely enough to survive a number arriving as a string", async () => {
    const give = (args: Record<string, unknown>): EvalClassifier => ({
      name: "give", classify: async () => ({ calls: [{ name: "findProducts", arguments: args }], confidence: 1, ms: 1 }),
    });
    const one = shopCases.filter((c) => c.args?.maxPrice === 60).slice(0, 1);
    expect(one).toHaveLength(1);
    expect((await runCases(shop, give({ maxPrice: "60" }), one))[0].argsOk).toBe(true);
    expect((await runCases(shop, give({ maxPrice: 40 }), one))[0].argsOk).toBe(false);
  });

  test("arguments the label does not mention are not wrong", async () => {
    const extra: EvalClassifier = {
      name: "extra",
      classify: async () => ({ calls: [{ name: "findProducts", arguments: { maxPrice: 60, tag: "wedding", text: "bold" } }], confidence: 1, ms: 1 }),
    };
    const one = shopCases.filter((c) => c.args?.maxPrice === 60).slice(0, 1);
    expect((await runCases(shop, extra, one))[0].argsOk).toBe(true);
  });
});

describe("the floor the set implies", () => {
  /** n right answers at `hi` confidence and m wrong ones at `lo`. */
  const rows = (right: number, hi: number, wrong: number, lo: number): CaseResult[] => [
    ...Array.from({ length: right }, () => ({ case: { text: "x", persona: "stranger", shape: "trending", tag: "plain" } as EvalCase, got: "trending", args: {}, confidence: hi, ms: 1, correct: true })),
    ...Array.from({ length: wrong }, () => ({ case: { text: "y", persona: "stranger", shape: "trending", tag: "plain" } as EvalCase, got: "findProducts", args: {}, confidence: lo, ms: 1, correct: false })),
  ];

  test("a silence never votes on a floor", () => {
    // A floor filters answers; it cannot produce one. Counting refusals among the "right" population
    // would make an over-cautious classifier look like a well-calibrated one.
    const quiet: CaseResult = { case: { text: "z", persona: "stranger", shape: null, tag: "off-topic" }, got: null, args: {}, confidence: 0, ms: 1, correct: true };
    const { right, wrong } = floorSweep([...rows(3, 0.9, 2, 0.1), quiet, quiet, quiet]);
    expect({ right, wrong }).toEqual({ right: 3, wrong: 2 });
  });

  test("it finds the gap when the two populations separate", () => {
    const a = recommendFloor(rows(10, 0.9, 10, 0.1))!;
    expect(a.floor).toBeGreaterThan(0.1);
    expect(a.floor).toBeLessThanOrEqual(0.9);
    expect({ kept: a.kept, admitted: a.admitted }).toEqual({ kept: 10, admitted: 0 });
  });

  test("it says so plainly when they do not", () => {
    // Both populations at the same confidence: no threshold can tell them apart, and recommending one
    // anyway is how a number nobody can justify ends up in a spec.
    const a = recommendFloor(rows(10, 0.5, 10, 0.5))!;
    expect(a.note).toContain("not a usable gate");
  });

  test("it scores separation rather than survival, so a lopsided set cannot push it to zero", () => {
    // Ninety right answers and three wrong ones: maximising (kept − admitted) picks 0 and calls it
    // good. Youden's J weighs the two populations equally and does not.
    const a = recommendFloor([...rows(90, 0.9, 0, 0), ...rows(0, 0, 3, 0.1)])!;
    expect(a.floor).toBeGreaterThan(0.1);
    expect(a.admitted).toBe(0);
  });

  test("ties go to the lower floor, because a needless `ask` costs a turn", () => {
    const sweep = floorSweep(rows(5, 0.9, 5, 0.1), [0.2, 0.5, 0.8]);
    expect(sweep.rows.every((r) => r.j === 1)).toBe(true);
    expect(recommendFloor(rows(5, 0.9, 5, 0.1), [0.2, 0.5, 0.8])!.floor).toBe(0.2);
  });

  test("no answers at all is not a floor of zero, it is no advice", () => {
    expect(recommendFloor([])).toBeNull();
  });
});

describe("the score separates populations that answer different questions", () => {
  test("refusal tags are scored as refusals, not as a shape it failed to find", () => {
    for (const c of shopCases) {
      if (REFUSAL_TAGS.includes(c.tag)) expect(c.shape).toBeNull();
      else expect(c.shape).not.toBeNull();
    }
  });

  test("the per-tag breakdown adds up to the whole", async () => {
    const results = await runCases(shop, canned((t) => (t.includes("cart") ? { name: "viewCart", confidence: 0.9 } : null)), shopCases);
    const s = score(results);
    expect(Object.values(s.byTag).reduce((a, b) => a + b.n, 0)).toBe(s.n);
    expect(Object.values(s.byTag).reduce((a, b) => a + b.correct, 0)).toBe(s.correct);
    expect(s.positives.n + s.refusals.n).toBe(s.n);
  });

  test("a second classifier is scored against the same labels, not against the first", async () => {
    const results = await runCases(shop, canned(() => ({ name: "trending", confidence: 0.5 })), shopCases.slice(0, 6),
      { second: canned(() => ({ name: "findProducts", confidence: 0.5 })) });
    const s = score(results)!;
    expect(s.versus).toBeDefined();
    const total = s.versus!.agree + s.versus!.onlyPrimary + s.versus!.onlySecond + s.versus!.neither;
    expect(total).toBe(6);
  });
});
