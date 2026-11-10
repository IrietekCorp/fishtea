/**
 * The site is generated from the repository, so the thing worth testing is that the generation is real:
 * that the spec reference actually came from the schema and the CLI reference from the CLI, rather than
 * from prose somebody wrote once and stopped updating.
 *
 * A page that silently renders empty is the failure mode here — it looks fine in a file listing.
 */
import { describe, expect, test, beforeAll, beforeEach, afterAll } from "bun:test";
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { build, posts, readTokens, stageReleases, PUBLISH_INSTALL, SOURCE_URL } from "./build.ts";
import { FISHTEA_VERSION } from "@fishtea/spec";

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

  test("until tarballs are published, the site serves no installer", () => {
    if (PUBLISH_INSTALL) return;                     // the published shape is asserted below instead

    // Absent, not merely unlinked. `fishtea.io/install` is not a URL anyone has to guess, so the test
    // is that the file is not there — and that no page hands out the command either, which is the way
    // this would quietly come back: one <pre> in one doc page, published and forgotten.
    expect(existsSync(join(OUT, "install"))).toBe(false);
    expect(existsSync(join(OUT, "releases"))).toBe(false);

    const offenders = readdirSync(OUT, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".html"))
      .filter((f) => /fishtea\.io\/install|curl -fsSL/.test(read(f)));
    expect(offenders).toEqual([]);

    // The way in is the source, and it has to be reachable from the front door.
    expect(read("index.html")).toContain(`href="${SOURCE_URL}"`);
  });

  test("the installer is served, and the landing page offers it", () => {
    if (!PUBLISH_INSTALL) return;                    // not published yet: asserted absent above
    expect(existsSync(join(OUT, "install"))).toBe(true);
    expect(read("install")).toContain("FISHTEA_ROOT");
  });

  test("releases are published with a latest marker and checksums that match", () => {
    const dir = join(OUT, "releases");
    if (!existsSync(dir)) return;                    // no build artefacts on disk: nothing to assert
    const tarballs = readdirSync(dir).filter((f) => f.endsWith(".tar.gz"));
    expect(tarballs.length).toBeGreaterThan(0);

    const latest = read("releases/latest").trim();
    expect(latest).toMatch(/^\d+\.\d+\.\d+/);
    // Whatever `latest` claims must actually be downloadable, or the installer 404s on a fresh machine.
    expect(tarballs.some((f) => f.includes(`-${latest}-`) || f.startsWith(`fishtea-${latest}-`))).toBe(true);

    // Every checksum must describe a file that is here, and be correct.
    const sums = read("releases/SHA256SUMS").trim().split("\n").map((l) => l.split(/\s+/));
    expect(sums.length).toBe(tarballs.length);
    for (const [hash, name] of sums) {
      expect({ name, listed: tarballs.includes(name) }).toEqual({ name, listed: true });
      const actual = createHash("sha256").update(readFileSync(join(dir, name))).digest("hex");
      expect({ name, ok: actual === hash }).toEqual({ name, ok: true });
    }
  });

  test("the installer verifies what it downloads", () => {
    if (!PUBLISH_INSTALL) return;
    const sh = read("install");
    expect(sh).toContain("SHA256SUMS");
    expect(sh).toContain("checksum mismatch");
  });

  test("the stylesheet ships, and the palette comes from the tokens", () => {
    const css = read("static/site.css");
    expect(css).toContain('@import url("tokens.generated.css")');

    // Ebony is primary, so it is what bare :root carries; Oak arrives by preference and by data-theme.
    // If this ever inverts, every page loads with the wrong ground before a single rule is read.
    const tokens = read("static/tokens.generated.css");
    const t = readTokens();
    const ground = t.color.tokens.find((x: any) => x.name === "ground")!.value as Record<string, string>;
    expect(tokens).toContain(`:root {\n  color-scheme: dark;\n  --ground: ${ground.dark};`);
    expect(tokens).toContain("@media (prefers-color-scheme: light)");
    expect(tokens).toContain('[data-theme="light"]');
    expect(tokens).toContain(`--ground: ${ground.light};`);

    // Nothing in the hand-written sheet may hard-code a colour: every one is a token or it is a bug.
    const literals = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/#[0-9a-f]{3,8}\b|\brgba?\(/gi) ?? [];
    expect(literals).toEqual([]);
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
    expect(html).toContain("shawnstewart.me");
    expect(html).toContain("static/img/shawn-stewart.jpg");
    expect(html).not.toContain("shawnstewart.me/assets");    // served from here, not from another host
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

  test("the build-with-it page can actually be replied to", () => {
    const html = read("beta.html");
    expect(html).toContain("shawn@irietek.com");
    expect(html).toContain('id="beta-form"');
    // A visible plain address as well, so someone without a mail client is not stuck.
    expect(html).toContain("mailto:shawn@irietek.com");
    // And no personal mailbox anywhere on the site: the project's address is the only one it publishes.
    for (const f of readdirSync(OUT, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".html"))) {
      expect({ page: f, leaks: /@gmail\.com/i.test(read(f)) }).toEqual({ page: f, leaks: false });
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

/**
 * `dist/` is build output nobody clears, so it accumulates — it held 1.1.0 through 1.4.x while the
 * framework was at 1.6.0. Staging whatever is there makes `latest` mean "the newest tarball on this
 * disk", which is not the current version, and both `install.sh` and `fishtea upgrade` believe it.
 */
describe("a release set must contain the version it is built from", () => {
  const DIST = join(HOME, "dist");
  const tarball = (v: string, t = "linux-x64") => {
    mkdirSync(DIST, { recursive: true });
    writeFileSync(join(DIST, `fishtea-${v}-${t}.tar.gz`), "not a real tarball");
  };
  const clear = () => rmSync(DIST, { recursive: true, force: true });

  beforeEach(clear);
  afterAll(clear);

  test("a dist holding only old versions is refused, and says what to do", () => {
    tarball("1.1.0");
    expect(() => stageReleases()).toThrow(/has tarballs for 1\.1\.0 but not/);
    expect(() => stageReleases()).toThrow(/rm -rf dist/);
  });

  test("the current version alongside older ones is fine, and latest is the newest", () => {
    tarball("1.1.0");
    tarball(FISHTEA_VERSION);
    const written = stageReleases();
    expect(written.some((f) => f.includes(`fishtea-${FISHTEA_VERSION}-`))).toBe(true);
    expect(written.some((f) => f.includes("fishtea-1.1.0-"))).toBe(true);   // still downloadable
    expect(read("releases/latest").trim()).toBe(FISHTEA_VERSION);
  });

  test("no dist at all publishes nothing, rather than failing", () => {
    expect(stageReleases()).toEqual([]);
  });
});
