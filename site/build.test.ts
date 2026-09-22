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
import { build, posts } from "./build.ts";

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
    expect(read("index.html")).toContain(`FishTea ${version}`);
  });
});

describe("welcome, glossary, blog and about", () => {
  test("the welcome explains the lineage and links onward", () => {
    const html = read("welcome.html");
    expect(html).toContain("2006");
    expect(html).toContain("getting-started.html");
    expect(html).toContain("glossary.html");
  });

  test("the glossary defines the vocabulary the rest of the docs assume", () => {
    const html = read("glossary.html");
    for (const term of ["Shape", "Vessel", "Pour", "Trail", "Persona", "Plugin", "Manifest"]) {
      expect({ term, defined: html.includes(`>${term}</strong>`) || html.includes(`<strong>${term}</strong>`) })
        .toEqual({ term, defined: true });
    }
  });

  test("every blog post is listed, newest first, and has its own page", () => {
    const all = posts();
    expect(all.length).toBeGreaterThan(0);
    const index = read("blog.html");
    for (const p of all) {
      expect({ slug: p.slug, listed: index.includes(`blog/${p.slug}.html`) }).toEqual({ slug: p.slug, listed: true });
      expect(existsSync(join(OUT, `blog/${p.slug}.html`))).toBe(true);
      expect(read(`blog/${p.slug}.html`)).toContain(p.title.replace(/&/g, "&amp;").replace(/"/g, "&quot;"));
    }
    // Filenames start with a date, so reverse-sorted order is newest first.
    const dates = all.map((p) => p.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  test("a post's frontmatter never reaches the page", () => {
    for (const p of posts()) expect(read(`blog/${p.slug}.html`)).not.toContain("summary:");
  });

  test("the about page profiles the creator, with the portrait shipped not hotlinked", () => {
    const html = read("about.html");
    expect(html).toContain("Shawn J. Stewart");
    expect(html).toContain("piscopour.com");
    expect(html).toContain("static/img/shawn-stewart.jpg");
    expect(html).not.toContain("piscopour.com/assets");      // served from here, not from another host
    expect(existsSync(join(OUT, "static/img/shawn-stewart.jpg"))).toBe(true);
    expect(existsSync(join(OUT, "static/img/shawn-stewart@2x.jpg"))).toBe(true);
  });

  test("the brand is FishTea everywhere it is written out", () => {
    for (const f of readdirSync(OUT).filter((f) => f.endsWith(".html"))) {
      const text = read(f).replace(/<[^>]+>/g, " ");
      expect({ page: f, stale: /\bFishtea\b/.test(text) }).toEqual({ page: f, stale: false });
    }
  });
});
