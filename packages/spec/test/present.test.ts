import { describe, expect, test } from "bun:test";
import { resolve as resolvePath } from "node:path";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { loadApp, validateSpec, SpecError, resolvePresent, checkPresent, bindPresent, textPresent } from "../src/index.ts";

const ROOT = resolvePath(import.meta.dir, "../../..");
const TEMPLATES = readdirSync(resolvePath(ROOT, "templates")).filter((t) => existsSync(resolvePath(ROOT, "templates", t, "spec.json")));
const portfolio = loadApp(resolvePath(ROOT, "templates/portfolio"));
const raw = () => JSON.parse(readFileSync(resolvePath(ROOT, "templates/portfolio/spec.json"), "utf8"));
const withPresent = (present: unknown) => { const s = raw(); s.rules.present = present; return s; };
const problems = (present: unknown): string[] => {
  try { validateSpec(withPresent(present), { dir: resolvePath(ROOT, "templates/portfolio") }); return []; }
  catch (e) { if (e instanceof SpecError) return e.problems; throw e; }
};

describe("present: derived layouts", () => {
  test("every shape of every template lays out, with nothing to declare", () => {
    for (const t of TEMPLATES) {
      const { spec } = loadApp(resolvePath(ROOT, "templates", t));
      expect(checkPresent(spec as never)).toEqual([]);
      for (const shape of Object.keys(spec.shapes).filter((s) => s !== "version")) {
        const tree = resolvePresent(spec as never, shape);
        expect(tree.source).toBe("derived");
        expect(tree.organisms[0]?.organism).toBe("hero");
      }
    }
  });

  test("an enum named level is drawn as a meter on its declared scale", () => {
    const tree = resolvePresent(portfolio.spec as never, "skills", [{ id: "s", name: "Go", level: "strong", category: "languages", evidence: "Ten years" }]);
    const m = tree.organisms.find((o) => o.molecule)!.molecule!;
    expect(m.as).toBe("chip");
    expect(m.levels).toEqual(["familiar", "working", "strong", "expert"]);
    expect(textPresent(m.hint, { level: "strong", evidence: "Ten years" })).toBe("strong · Ten years");
  });

  test("a molecule's click is read off next[] — including $item inside a sentence", () => {
    const skills = resolvePresent(portfolio.spec as never, "skills", []).organisms.find((o) => o.molecule)!;
    expect(skills.molecule!.go).toEqual({ shape: "projects", args: { skill: "$name" } });
    const projects = resolvePresent(portfolio.spec as never, "projects", []).organisms.find((o) => o.molecule)!;
    expect(projects.molecule!.go).toEqual({ shape: "askAbout", args: { question: "Tell me about {name}" } });
    expect(bindPresent(projects.molecule!.go!.args!.question, { name: "Fleet" })).toBe("Tell me about Fleet");
  });

  test("the same spec and answer give the same tree", () => {
    const a = [{ id: "p", name: "Fleet", skills: ["Go"] }];
    expect(resolvePresent(portfolio.spec as never, "projects", a)).toEqual(resolvePresent(portfolio.spec as never, "projects", a));
  });
});

describe("present: declared layouts", () => {
  test("a declared shape is used as written, and a declared molecule leaves out what it leaves out", () => {
    const spec = validateSpec(withPresent({
      molecules: { project: { as: "card", title: "$name" } },
      shapes: { projects: [{ organism: "hero", title: "Work" }, { organism: "grid", from: "$" }] },
    }), { dir: resolvePath(ROOT, "templates/portfolio") });
    const tree = resolvePresent(spec as never, "projects", [{ id: "p", name: "Fleet", summary: "A fleet", year: 2024 }]);
    expect(tree.source).toBe("declared");
    expect(tree.organisms.map((o) => o.organism)).toEqual(["hero", "grid"]);
    const m = tree.organisms[1].molecule!;
    expect(tree.organisms[1].moleculeSource).toBe("declared");
    expect(m.title).toBe("$name");
    expect(m.body).toBeUndefined();
    expect(m.go?.shape).toBe("askAbout");
  });
});

describe("present: bindings", () => {
  test("templates drop their empty segments", () => {
    expect(bindPresent("{pillar} · {org} · {year}", { org: "Irietek", year: 2026 })).toBe("Irietek · 2026");
    expect(bindPresent("{pillar}", {})).toBe("");
    expect(bindPresent("Plain text", {})).toBe("Plain text");
  });
  test("filters are a closed set: count, before/after, or, pad, date, year, upper", () => {
    const rows = { items: [{ kind: "patent" }, { kind: "award" }, { kind: "patent" }] };
    expect(bindPresent("{items|count}", rows)).toBe("3");
    expect(bindPresent("{items|count:kind=patent}", rows)).toBe("2");
    expect(bindPresent("{name|before:·}", { name: "01 · Assess" })).toBe("01");
    expect(bindPresent("{name|after:·}", { name: "01 · Assess" })).toBe("Assess");
    expect(bindPresent("{problem|or:description}", { description: "Why" })).toBe("Why");
    expect(bindPresent("{n|pad}", { n: 3 })).toBe("03");
    expect(bindPresent("{d|year}", { d: "2024-12-03T00:00:00.000Z" })).toBe("2024");
    expect(bindPresent("{k|upper}", { k: "podcast" })).toBe("PODCAST");
    expect(bindPresent("{k|nonsense}", { k: "x" })).toBe("x");
  });
  test("the object form picks by a field's value", () => {
    const cta = { by: "$kind", map: { podcast: "Listen" }, else: "Open" };
    expect(bindPresent(cta, { kind: "podcast" })).toBe("Listen");
    expect(bindPresent(cta, { kind: "talk" })).toBe("Open");
  });
});

describe("present: validation", () => {
  test("a spec with a sound layout validates", () => {
    expect(problems({ shapes: { projects: [{ organism: "grid", from: "$" }] } })).toEqual([]);
  });
  test("unknown organisms, missing fields, shapes and entities are problems at load", () => {
    const p = problems({
      molecules: { nosuch: { as: "card" }, project: { as: "tile", go: { shape: "ghost" } } },
      shapes: {
        ghost: [],
        askAbout: [{ organism: "carousel" }, { organism: "grid", from: "replies" }, { organism: "grid", from: "answers", molecule: "nosuch" }],
      },
    });
    expect(p.join("\n")).toContain('present.molecules.nosuch: no entity "nosuch"');
    expect(p.join("\n")).toContain('"tile" is not a molecule');
    expect(p.join("\n")).toContain('no shape "ghost"');
    expect(p.join("\n")).toContain("present.shapes.ghost: no such shape");
    expect(p.join("\n")).toContain('"carousel" is not an organism');
    expect(p.join("\n")).toContain('the answer has no "replies"');
  });
  test("a facet must set an argument its shape takes", () => {
    const p = problems({ shapes: { skills: [{ organism: "facets", facets: [{ label: "Colour", arg: "colour", from: "$", field: "category" }] }] } });
    expect(p.join("\n")).toContain('sets "colour", which skills does not take (it takes area, text)');
  });
});
