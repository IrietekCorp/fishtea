/**
 * The site is generated from the repository, so the thing worth testing is that the generation is real:
 * that the spec reference actually came from the schema and the CLI reference from the CLI, rather than
 * from prose somebody wrote once and stopped updating.
 *
 * A page that silently renders empty is the failure mode here — it looks fine in a file listing.
 */
import { describe, expect, test, beforeAll } from "bun:test";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { build } from "./build.ts";

const HOME = join(import.meta.dir, "..");
const OUT = join(HOME, "site/dist");
const read = (f: string) => readFileSync(join(OUT, f), "utf8");

beforeAll(async () => { await build(); });

describe("the site builds", () => {
  test("every page is written, and none of them is empty", () => {
    const pages = readdirSync(OUT).filter((f) => f.endsWith(".html"));
    expect(pages.length).toBeGreaterThanOrEqual(10);
    for (const p of pages) {
      const html = read(p);
      expect({ page: p, hasTitle: /<title>.+<\/title>/.test(html) }).toEqual({ page: p, hasTitle: true });
      // A rendered page is several KB; an empty one still has a layout, so check the article itself.
      const article = html.match(/<article class="prose">([\s\S]*?)<\/article>/)?.[1] ?? html;
      expect({ page: p, bytes: article.length > 600 }).toEqual({ page: p, bytes: true });
    }
  });

  test("the installer is served from the site root", () => {
    expect(existsSync(join(OUT, "install"))).toBe(true);
    expect(read("install")).toContain("FISHTEA_ROOT");
  });

  test("the stylesheet ships and defines both themes", () => {
    const css = read("static/site.css");
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).toContain("--accent");
  });
});

describe("generated, not written", () => {
  test("the spec reference lists every section the schema declares", () => {
    const schema = JSON.parse(readFileSync(join(HOME, "packages/spec/schema/spec.schema.json"), "utf8"));
    const html = read("spec-reference.html");
    for (const section of Object.keys(schema.properties)) {
      expect({ section, present: html.includes(`id="section-${section.toLowerCase()}"`) }).toEqual({ section, present: true });
    }
    // Including the newest one, which is the point: a new section cannot be forgotten here.
    expect(html).toContain('id="section-plugins"');
  });

  test("the spec reference cross-links its definitions", () => {
    const html = read("spec-reference.html");
    expect(html).toContain('id="def-entity"');
    expect(html).toContain('href="#def-call"');
  });

  test("the CLI reference is the CLI's own help, including the newest commands", () => {
    const html = read("cli-reference.html");
    for (const cmd of ["fishtea plugin", "fishtea update", "fishtea versions", "fishtea upgrade"]) {
      expect({ cmd, present: html.includes(cmd) }).toEqual({ cmd, present: true });
    }
  });

  test("docs pages render their markdown rather than escaping it", () => {
    const html = read("versioning.html");
    expect(html).toContain("<table>");           // the three-versions table
    expect(html).toContain("<h2 id=");           // headings got ids
    expect(html).not.toContain("| version |");   // raw markdown never reached the page
  });

  test("the version in the footer is the framework's own", () => {
    const version = readFileSync(join(HOME, "packages/spec/src/release.ts"), "utf8").match(/FISHTEA_VERSION = "([^"]+)"/)![1];
    expect(read("index.html")).toContain(`Fishtea ${version}`);
  });
});
