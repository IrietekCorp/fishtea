import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { validateSpec, SpecError } from "../src/index.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const DIR = resolve(ROOT, "templates/portfolio");
const problems = (site: unknown): string[] => {
  const s = JSON.parse(readFileSync(resolve(DIR, "spec.json"), "utf8"));
  s.rules.site = site;
  try { validateSpec(s, { dir: DIR }); return []; } catch (e) { if (e instanceof SpecError) return e.problems; throw e; }
};

describe("rules.site", () => {
  test("a sound site map validates", () => {
    expect(problems({
      home: "askAbout", sections: [{ shape: "askAbout", label: "Ask" }, { shape: "projects", label: "Work" }],
      parents: { interview: "askAbout" }, actions: { contact: { shape: "getInTouch", label: "Get in touch" } },
      copy: { ask: "Ask anything", cta: { title: "Hiring?", label: "Talk" } },
    })).toEqual([]);
  });
  test("every name is a shape, a parent is a section, an action is not one", () => {
    const p = problems({
      home: "interview", sections: [{ shape: "askAbout", label: "Ask" }, { shape: "ghost", label: "Boo" }],
      parents: { projects: "interview", askAbout: "askAbout" }, actions: { contact: { shape: "askAbout", label: "x" }, gone: { shape: "nope", label: "y" } },
    }).join("\n");
    expect(p).toContain('rules.site.home: "interview" is not one of the sections');
    expect(p).toContain('rules.site.sections[1]: no shape "ghost"');
    expect(p).toContain('rules.site.parents.projects: "interview" is not a section');
    expect(p).toContain("rules.site.parents.askAbout: a section has no parent");
    expect(p).toContain('rules.site.actions.contact: "askAbout" is a section');
    expect(p).toContain('rules.site.actions.gone: no shape "nope"');
  });
  test("the schema refuses keys it does not know, so a typo is not silently ignored", () => {
    expect(problems({ home: "askAbout", sections: [{ shape: "askAbout", label: "Ask" }], sectoins: [] }).join("\n")).toContain("must NOT have additional properties");
  });
});
