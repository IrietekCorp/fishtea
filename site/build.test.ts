/**
 * The site is generated from the repository, so the thing worth testing is that the generation is real:
 * that the spec reference actually came from the schema and the CLI reference from the CLI, rather than
 * from prose somebody wrote once and stopped updating.
 *
 * A page that silently renders empty is the failure mode here — it looks fine in a file listing.
 */
import { describe, expect, test, beforeAll } from "bun:test";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
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

  test("the installer is NOT published while the beta is private", () => {
    // install.sh with no arguments downloads from FISHTEA_RELEASES, and nothing is published there —
    // so a curl|bash would fetch a script that fails at the download. No URL beats a half-working one.
    expect(existsSync(join(OUT, "install"))).toBe(false);
    expect(read("index.html")).not.toContain("curl -fsSL https://fishtea.io/install");
  });

  test("the landing page asks for the beta instead", () => {
    const html = read("index.html");
    expect(html).toContain("beta.html");
    expect(html).toContain("Join the beta");
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

  test("the welcome gives the real etymology, tied to the architecture", () => {
    const html = read("welcome.html");
    expect(html).toContain("Jamaican broth");
    expect(html).toContain("no tea");                 // the name is about the form, not an ingredient
    expect(html).toContain("Scotch bonnet");          // the model: all the heat, never burst into the broth
  });

  test("the argument appears on the landing page, not only buried in the docs", () => {
    const html = read("index.html");
    expect(html).toContain("authority that answers questions");
    expect(html).toContain("Browsing is not a funnel");
    expect(html).toContain("welcome.html");
  });

  test("every post carries a byline", () => {
    for (const p of posts()) {
      expect({ slug: p.slug, author: p.author }).toEqual({ slug: p.slug, author: "Shawn J. Stewart" });
      expect(read(`blog/${p.slug}.html`)).toContain("By Shawn J. Stewart");
    }
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

  test("the essay leads the blog and is reachable from both entry points", () => {
    const all = posts();
    expect(all[0].slug).toBe("why-a-business-is-not-a-set-of-pages");
    expect(read("welcome.html")).toContain("blog/why-a-business-is-not-a-set-of-pages.html");
    expect(read("index.html")).toContain("blog/why-a-business-is-not-a-set-of-pages.html");
  });
});

describe("links", () => {
  /**
   * Every internal href must resolve to something that was actually written. The site cross-links
   * heavily between docs, blog posts and generated reference pages, and a page one directory deep has to
   * reach back up with `../` — which is exactly the sort of thing that is wrong silently.
   */
  test("no internal link is broken", () => {
    const broken: string[] = [];
    const pages = readdirSync(OUT, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".html"));
    for (const page of pages) {
      const dir = dirname(join(OUT, page));
      for (const m of read(page).matchAll(/(?:href|src)="([^"]+)"/g)) {
        const href = m[1];
        if (/^(https?:|data:|mailto:|#)/.test(href)) continue;
        const target = join(dir, href.split("#")[0]);
        if (!existsSync(target)) broken.push(`${page} → ${href}`);
      }
    }
    expect(broken).toEqual([]);
  });

  test("the beta page can actually be replied to", () => {
    const html = read("beta.html");
    expect(html).toContain("shawn@irietek.com");
    expect(html).toContain('id="beta-form"');
    // A visible plain address as well, so someone without a mail client is not stuck.
    expect(html).toContain("mailto:shawn@irietek.com");
    // And no personal Gmail anywhere on the site.
    for (const f of readdirSync(OUT, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".html"))) {
      expect({ page: f, leaks: read(f).includes("shawn.jr.stewart@gmail.com") }).toEqual({ page: f, leaks: false });
    }
  });

  test("the brand assets ship and are wired into every page", () => {
    for (const f of ["favicon.ico", "favicon-32.png", "favicon-16.png", "apple-touch-icon.png",
                     "logo-mark.png", "logo-mark@2x.png", "og-image.png"]) {
      expect({ asset: f, present: existsSync(join(OUT, "static/img", f)) }).toEqual({ asset: f, present: true });
    }
    for (const f of readdirSync(OUT, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".html"))) {
      const html = read(f);
      expect({ page: f, favicon: html.includes("favicon.ico") }).toEqual({ page: f, favicon: true });
      expect({ page: f, card: html.includes("og:image") }).toEqual({ page: f, card: true });
      expect({ page: f, emoji: html.includes("text y='13'") }).toEqual({ page: f, emoji: false });
    }
  });
});
