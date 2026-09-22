#!/usr/bin/env bun
/**
 * fishtea.dev — a static site, built from what the repository already knows.
 *
 *   bun run site          build into site/dist
 *   bun run site --serve  build, then serve it on :4000 and rebuild on request
 *
 * Two rules, so this stays maintainable rather than becoming a second product:
 *
 *   **Nothing is written twice.** Every documentation page is a markdown file that already exists in
 *   docs/, and the two reference pages are *generated* — the spec reference from the JSON Schema, the CLI
 *   reference from the CLI's own `help` output. So a new flag or a new spec section cannot be documented
 *   wrongly here; it either appears or the build is out of date.
 *
 *   **No framework, no runtime dependencies.** `marked` renders markdown at build time; the output is
 *   plain HTML and one stylesheet. Nothing ships to the browser but content.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { marked } from "marked";

const HOME = resolve(dirname(new URL(import.meta.url).pathname), "..");
const OUT = join(HOME, "site/dist");
const VERSION = readFileSync(join(HOME, "packages/spec/src/release.ts"), "utf8").match(/FISHTEA_VERSION = "([^"]+)"/)![1];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (s: string) => s.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");

// ---- markdown ------------------------------------------------------------------------------------
// Headings get stable ids and a quiet anchor; tables get a scroll container so a wide one cannot make
// the page scroll sideways on a phone.
const renderer = new marked.Renderer();
renderer.heading = ({ tokens, depth }: any) => {
  const text = marked.parseInline(tokens.map((t: any) => t.raw).join(""), { async: false }) as string;
  const id = slug(text.replace(/<[^>]+>/g, ""));
  const anchor = depth === 2 || depth === 3 ? `<a class="anchor" href="#${id}" aria-label="link to this section">#</a>` : "";
  return `<h${depth} id="${id}">${text}${anchor}</h${depth}>\n`;
};
renderer.table = function (this: any, token: any) {
  const body = (marked.Renderer.prototype.table as any).call(this, token);
  return `<div class="scroll">${body}</div>`;
};
marked.use({ renderer, gfm: true });

const md = (source: string) => marked.parse(source, { async: false }) as string;

// ---- pages ---------------------------------------------------------------------------------------
interface Page {
  slug: string;            // "" is the landing page
  title: string;
  nav?: string;            // sidebar label; omitted means "not in the docs sidebar"
  group?: string;
  body: () => string;
  landing?: boolean;
}

const NAV_GROUPS = ["Start", "Operating", "Reference", "Design", "Project"] as const;

function layout(page: Page, pages: Page[]): string {
  const docPages = pages.filter((p) => p.nav);
  const isDoc = !page.landing;
  const root = page.slug.includes("/") ? "../" : page.slug ? "" : "";
  const href = (s: string) => (s === "" ? (root ? "../index.html" : "index.html") : `${root}${s}.html`);

  const side = NAV_GROUPS.map((g) => {
    const items = docPages.filter((p) => p.group === g);
    if (!items.length) return "";
    return `<h4>${g}</h4><ul>${items.map((p) =>
      `<li><a href="${href(p.slug)}"${p.slug === page.slug ? ' aria-current="page"' : ""}>${esc(p.nav!)}</a></li>`).join("")}</ul>`;
  }).join("");

  const topNav = [
    ["docs", "welcome"],
    ["glossary", "glossary"],
    ["spec", "spec-reference"],
    ["blog", "blog"],
    ["about", "about"],
  ].map(([label, s]) => `<a href="${href(s)}"${page.slug === s || (s === "blog" && page.slug.startsWith("blog/")) ? ' aria-current="page"' : ""}>${label}</a>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}${page.landing ? "" : " — FishTea"}</title>
<meta name="description" content="Describe a business once in JSON; derive the database, the classifier's tools, the planner, the UI and the operator console from it.">
<link rel="stylesheet" href="${root}static/site.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='13' font-size='13'>🍵</text></svg>">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="wrap">
  <a class="brand" href="${href("")}">Fish<span>Tea</span></a>
  <nav>${topNav}</nav>
</div></header>
${isDoc
    ? `<main id="main" class="wrap docs"><aside class="side">${side}</aside><article class="prose">${page.body()}</article></main>`
    : `<main id="main">${page.body()}</main>`}
<footer class="bottom"><div class="wrap">
  <span>FishTea ${VERSION} — solid ground, liquid UI.</span>
  <span><a href="${href("welcome")}">Docs</a> · <a href="${href("blog")}">Blog</a> · <a href="${href("about")}">About</a></span>
</div></footer>
</body>
</html>
`;
}

// ---- the landing page ----------------------------------------------------------------------------
function landing(): string {
  const archetypes: [string, string][] = [
    ["ecommerce", "A catalogue, a cart, orders — and vendor feeds, so stock can come from somewhere else."],
    ["portfolio", "A person you can interview: skills, projects, an honest assessment of fit."],
    ["verification", "Consent, attestation, and disclosure limited to the purpose asked for."],
    ["program", "Sessions and registration: capacity, ages, sibling discounts, scholarships."],
    ["blank", "One entity, one read, one write. Start here when nothing else fits."],
  ];
  const seams: [string, string][] = [
    ["integration", "Calls, entities and shapes — Stripe, a frontier model, a shipping quote."],
    ["ui", "A design system: tokens, and optionally its own vessels."],
    ["auth", "How a visitor becomes known."],
    ["classifier", "An alternative to the on-device needle pool."],
    ["channel", "Where a notification is delivered."],
    ["archetype", "A template <code>fishtea new</code> can start from."],
  ];

  return `
<div class="hero"><div class="wrap">
  <p class="tag">solid ground, liquid UI</p>
  <h1>Describe a business once.<br>Derive everything else.</h1>
  <p class="lede">
    One <code>spec.json</code> gives you the Postgres schema, the classifier's tool list, the planner, the
    UI and an operator console. Conversation replaces routing: a small on-device model turns what a
    visitor says into a <strong>shape</strong>, the planner composes typed <strong>calls</strong>, and the
    answer pours into one of seven <strong>vessels</strong>.
  </p>
  <div class="cta">
    <a class="btn" href="getting-started.html">Get started</a>
    <a class="btn ghost" href="spec-reference.html">Spec reference</a>
  </div>
  <p style="margin-top:2rem;max-width:34rem">
    <span class="install"><span class="prompt">$</span> curl -fsSL https://fishtea.dev/install | bash</span>
  </p>
</div></div>

<section><div class="wrap">
  <h2>A business is not a set of pages. It is an authority that answers questions.</h2>
  <p class="sub">A shoe store is a place where you can ask anything about shoes. That is the whole
  definition — and none of it requires a page.</p>
  <div class="split">
    <div>
      <p>Software is assembled from modules built for everyone, so every variation — a different customer,
      tier, market or permission — becomes conditional logic draped over something generic. That is
      inherited, not careless: we store data in rows and columns, so we build software in the shape of
      that storage, and anything not uniform arrives late as a layer bolted on top. It shows up most
      painfully in the URL, a string we have spent two decades forcing to act like a memory.</p>
      <p>FishTea starts from the other end. Describe what may be asked and by whom, and let the
      interface be the last and thinnest thing.</p>
    </div>
    <div>
      <p><strong>Browsing is not a funnel.</strong> It is how a customer works out what they implicitly
      like. Most of it is not purchase intent, and treating it as a path to checkout measures the wrong
      thing.</p>
      <p><strong>Search is not a result set to filter.</strong> The search <em>is</em> the question, and
      what comes back is an opportunity to ignore or to go deeper. "Not those, something warmer" is not a
      refinement — it is the next turn.</p>
      <p><strong>Personalisation stops being a layer.</strong> If the interaction <em>is</em> the
      conversation, every surface is already personal — by what was actually said, not by a profile.</p>
      <p><a href="blog/why-a-business-is-not-a-set-of-pages.html">The longer argument →</a></p>
    </div>
  </div>
</div></section>

<section><div class="wrap">
  <h2>A whole application in one command</h2>
  <p class="sub">Answer an interview about your business; get a running stack. The archetype is a starting
  point, not a cage — everything it wrote is yours to edit.</p>
  <div class="split">
    <div>
      <pre><code>$ fishtea new myshop --template ecommerce --interactive
$ cd myshop
$ fishtea up

  db          postgres + pgvector   ready
  classifier  needle3, 3 workers    warm
  core        http://10.0.0.19:3000 listening
  ui          http://10.0.0.19:5173</code></pre>
    </div>
    <div>
      <p>The visitor types <em>"something linen for a summer wedding, under £80"</em>. The classifier picks
      the <code>findProducts</code> shape and fills its arguments; the planner runs the typed calls the
      shape names; the answer pours into a list vessel with the provenance strip underneath — which shape
      answered, what it read, what it wrote, how long it took.</p>
      <p>Nothing about that is hand-written. It is all derived from the spec.</p>
    </div>
  </div>
</div></section>

<section><div class="wrap">
  <h2>Five archetypes</h2>
  <p class="sub">Each one is a complete, runnable application with seed data and an onboarding interview
  that turns it into <em>your</em> business.</p>
  <div class="grid">
    ${archetypes.map(([n, d]) => `<div class="card"><h3><code>${n}</code></h3><p>${d}</p></div>`).join("\n    ")}
  </div>
</div></section>

<section><div class="wrap">
  <h2>Plugins for everything outside the conversation</h2>
  <p class="sub">Six seams, one mechanism. A plugin is a directory with a manifest; what it contributes is
  merged when the spec loads and never written into your <code>spec.json</code>.</p>
  <div class="grid">
    ${seams.map(([n, d]) => `<div class="card"><h3><code>${n}</code></h3><p>${d}</p></div>`).join("\n    ")}
  </div>
  <p style="margin-top:1.5rem"><a href="plugins.html">How plugins work →</a></p>
</div></section>

<section><div class="wrap">
  <h2>Upgrade without regenerating</h2>
  <p class="sub">An application pins a framework range and records where every file came from, so an
  upstream fix reaches it without touching a line you wrote.</p>
  <div class="split">
    <div>
      <pre><code>$ fishtea update

framework  1.1.0 → 1.2.0  (pinned ^1.1.0)
spec       format 1.1 → 1.2
files      2 to update, 1 new, 1 conflicting, 3 yours

   ↑ calls/cart_add.sql
   + calls/products_newest.sql
   ! calls/products_related.sql — you changed it and so
     did the archetype; the new one lands as .new</code></pre>
    </div>
    <div>
      <p>Every framework version you install stays on disk and <code>fishtea use &lt;version&gt;</code>
      switches between them by moving one symlink. Going back is as cheap as going forward — which is the
      only reason going forward is comfortable.</p>
      <p><a href="versioning.html">Versioning and updates →</a></p>
    </div>
  </div>
</div></section>
`;
}

// ---- generated: the spec reference -----------------------------------------------------------------
function specReference(): string {
  const schema = JSON.parse(readFileSync(join(HOME, "packages/spec/schema/spec.schema.json"), "utf8"));
  const defs = schema.$defs ?? {};

  const typeOf = (s: any): string => {
    if (!s) return "any";
    if (s.$ref) return `<a href="#def-${slug(s.$ref.split("/").pop())}"><code>${esc(s.$ref.split("/").pop())}</code></a>`;
    if (s.enum) return s.enum.map((v: string) => `<code>${esc(String(v))}</code>`).join(" | ");
    if (s.type === "array") return `${typeOf(s.items)}[]`;
    if (s.type === "object" && s.additionalProperties && typeof s.additionalProperties === "object") {
      return `map of ${typeOf(s.additionalProperties)}`;
    }
    return `<code>${esc(s.type ?? "any")}</code>`;
  };

  const propTable = (props: Record<string, any>, required: string[] = []) => {
    const rows = Object.entries(props)
      .filter(([k]) => k !== "version" && k !== "doc")
      .map(([k, v]: [string, any]) => `<tr><td><code>${esc(k)}</code>${required.includes(k) ? ' <span class="pill req">required</span>' : ""}</td><td>${typeOf(v)}</td><td>${esc(v.description ?? "")}</td></tr>`)
      .join("");
    return rows ? `<div class="scroll"><table><thead><tr><th>field</th><th>type</th><th>notes</th></tr></thead><tbody>${rows}</tbody></table></div>` : "";
  };

  const sections = Object.entries(schema.properties as Record<string, any>).map(([name, s]) => {
    const req = (schema.required ?? []).includes(name);
    const entries = s.additionalProperties && typeof s.additionalProperties === "object"
      ? `<p>Every key other than <code>version</code> and <code>doc</code> is one ${typeOf(s.additionalProperties)} definition.</p>` : "";
    return `<div class="ref-section" id="section-${slug(name)}">
  <h3>${esc(name)} ${req ? '<span class="pill req">required</span>' : '<span class="pill">optional</span>'}</h3>
  ${s.description ? `<p>${esc(s.description)}</p>` : ""}
  ${propTable(s.properties ?? {}, s.required ?? [])}
  ${entries}
</div>`;
  }).join("\n");

  const definitions = Object.entries(defs).map(([name, d]: [string, any]) => `<div class="ref-section" id="def-${slug(name)}">
  <h3>${esc(name)}</h3>
  ${d.description ? `<p>${esc(d.description)}</p>` : ""}
  ${d.enum ? `<p>One of: ${d.enum.map((v: string) => `<code>${esc(String(v))}</code>`).join(", ")}</p>` : ""}
  ${propTable(d.properties ?? {}, d.required ?? [])}
</div>`).join("\n");

  return `<h1>Spec reference</h1>
<p>Generated from <code>packages/spec/schema/spec.schema.json</code> at build time, so it cannot drift from
what the loader actually accepts. Spec format <code>${readFileSync(join(HOME, "packages/spec/src/release.ts"), "utf8").match(/SPEC_FORMAT = "([^"]+)"/)![1]}</code>.</p>
<h2 id="sections">Sections</h2>
<p>A spec is one JSON object. Each top-level key is a section with its own <code>version</code>, and every
section is content-hashed so the console and the engine can tell exactly what changed.</p>
${sections}
<h2 id="definitions">Definitions</h2>
${definitions}
`;
}

// ---- generated: the CLI reference --------------------------------------------------------------------
async function cliReference(): Promise<string> {
  const proc = Bun.spawn(["bun", join(HOME, "packages/cli/src/index.ts"), "help"], {
    env: { ...process.env, NO_COLOR: "1", FISHTEA_HOME: HOME },
    stdout: "pipe", stderr: "pipe",
  });
  const text = (await new Response(proc.stdout).text()).replace(/\x1b\[[0-9;]*m/g, "");
  await proc.exited;
  return `<h1>CLI reference</h1>
<p>Captured from <code>fishtea help</code> when this page was built, so it is whatever the shipped binary
actually does.</p>
<pre><code>${esc(text.trim())}</code></pre>
<h2 id="where-commands-run">Where commands run</h2>
<p>Every command takes <code>--app &lt;dir&gt;</code>, defaulting to <code>FISHTEA_APP</code> and then to the
current directory if it has a <code>spec.json</code>. A generated application wraps these in its own
<code>package.json</code> scripts, so <code>bun run dev</code> and <code>fishtea serve</code> are the same
thing.</p>
`;
}


// ---- the blog ---------------------------------------------------------------------------------------
/**
 * Posts are markdown files in site/blog with a small frontmatter block. The filename carries the date so
 * the directory sorts itself, and the slug is whatever follows it.
 */
interface Post { slug: string; title: string; date: string; summary: string; author: string; tags: string[]; body: string }

function frontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: raw.slice(m[0].length) };
}

export function posts(): Post[] {
  const dir = join(HOME, "site/blog");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse()   // newest first. Filenames start with the date, so this is date-descending; posts sharing
                 // a date fall back to reverse-alphabetical, which is stable and good enough.
    .map((f) => {
      const { meta, body } = frontmatter(readFileSync(join(dir, f), "utf8"));
      const named = f.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "");
      return {
        slug: named,
        title: meta.title ?? named,
        date: meta.date ?? f.slice(0, 10),
        summary: meta.summary ?? "",
        author: meta.author ?? "",
        tags: meta.tags ? meta.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        body,
      };
    });
}

const readableDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function blogIndex(): string {
  const all = posts();
  if (!all.length) return `<h1>Blog</h1><p>Nothing published yet.</p>`;
  return `<h1>Blog</h1>
<p>Notes on building FishTea: what we measured, what we got wrong, and why the design is shaped the way it
is.</p>
${all.map((p) => `<article class="post-card">
  <h2 id="${p.slug}"><a href="blog/${p.slug}.html">${esc(p.title)}</a></h2>
  <p class="post-meta"><time datetime="${p.date}">${readableDate(p.date)}</time>${p.author ? ` · ${esc(p.author)}` : ""}${p.tags.length ? ` · ${p.tags.map((t) => `<span class="pill">${esc(t)}</span>`).join(" ")}` : ""}</p>
  <p>${esc(p.summary)}</p>
  <p><a href="blog/${p.slug}.html">Read →</a></p>
</article>`).join("\n")}`;
}

function blogPost(p: Post): string {
  return `<p class="post-meta"><a href="../blog.html">← Blog</a></p>
<h1>${esc(p.title)}</h1>
<p class="post-meta">${p.author ? `By ${esc(p.author)} · ` : ""}<time datetime="${p.date}">${readableDate(p.date)}</time>${p.tags.length ? ` · ${p.tags.map((t) => `<span class="pill">${esc(t)}</span>`).join(" ")}` : ""}</p>
${md(p.body)}
<hr>
<p class="post-meta"><a href="../blog.html">← More posts</a></p>`;
}

// ---- about ------------------------------------------------------------------------------------------
function about(): string {
  return `<h1>About</h1>
<p>FishTea is built by Shawn J. Stewart. It is the second life of a project he first wrote in 2006 — and
the first version able to finish the idea, because the piece that was missing then is a small language
model that now runs on an ordinary machine.</p>

<div class="profile">
  <img src="static/img/shawn-stewart.jpg" srcset="static/img/shawn-stewart.jpg 1x, static/img/shawn-stewart@2x.jpg 2x"
       width="160" height="160" alt="Shawn J. Stewart" loading="lazy">
  <div>
    <h2 id="shawn-j-stewart" style="border:0;padding:0;margin-top:0">Shawn J. Stewart</h2>
    <p class="post-meta">The AI-Native Architect</p>
    <p>Technical executive and venture builder with 25+ years scaling global engineering organizations,
    working in AI infrastructure, distributed systems and engineering leadership.</p>
    <p><a href="https://piscopour.com" rel="me">piscopour.com</a></p>
  </div>
</div>

<h2 id="why-this-exists">Why this exists</h2>
<p>We assemble software from modules built for everyone, and pay for every variation in conditional logic.
That habit is inherited from storing data in rows and columns and then building software in the shape of
the storage — which is why permissions and personalisation always arrive late, as layers on something
that never expected them.</p>
<p>FishTea starts from a different premise: a business is an authority that answers questions, and the
interface is the last and thinnest layer rather than the first and thickest.</p>
<p>The first FishTea, in 2006, had that idea and could only build half of it. Working out what a visitor
meant, cheaply enough to sit in front of every request, was not possible then at any price. A small
tool-calling model on ordinary hardware removed that constraint, and the rest follows from it.</p>
<p>The full argument is in <a href="welcome.html">Welcome</a>; the design, including the decisions that
are settled and why, is in <a href="blueprint.html">the blueprint</a>.</p>

<h2 id="contributing">Contributing</h2>
<p>The most useful contribution is a plugin. Everything outside the conversation itself is one:
integrations, design systems, auth, notification channels, whole archetypes. Write it locally with
<code>fishtea plugin create</code>, and when it is good, <code>fishtea plugin promote</code> moves it into
the framework — a move, not a rewrite, so the application you wrote it for keeps working untouched.</p>
<p>See <a href="plugins.html">Plugins</a> for the mechanism.</p>`;
}

// ---- documentation pages from markdown ----------------------------------------------------------------
/** Read a markdown file, drop its first H1 (the page title renders it), and render the rest. */
function fromMarkdown(file: string, title: string): string {
  const raw = readFileSync(join(HOME, file), "utf8").replace(/^#\s+.*\n/, "");
  return `<h1>${esc(title)}</h1>\n${md(raw)}`;
}

async function pages(): Promise<Page[]> {
  const cli = await cliReference();
  return [
    { slug: "", title: "FishTea — describe a business once, derive everything else", body: landing, landing: true },

    { slug: "welcome", title: "Welcome", nav: "Welcome", group: "Start", body: () => fromMarkdown("docs/WELCOME.md", "Welcome") },
    { slug: "getting-started", title: "Getting started", nav: "Getting started", group: "Start", body: () => fromMarkdown("docs/GETTING-STARTED.md", "Getting started") },
    { slug: "archetypes", title: "Archetypes", nav: "Archetypes", group: "Start", body: () => fromMarkdown("docs/ARCHETYPES.md", "Archetypes") },

    { slug: "versioning", title: "Versioning and updates", nav: "Versioning & updates", group: "Operating", body: () => fromMarkdown("docs/VERSIONING.md", "Versioning and updates") },
    { slug: "plugins", title: "Plugins", nav: "Plugins", group: "Operating", body: () => fromMarkdown("docs/PLUGINS.md", "Plugins") },
    { slug: "operating", title: "Running it", nav: "Running it", group: "Operating", body: () => fromMarkdown("docs/OPERATING.md", "Running it") },

    { slug: "glossary", title: "Glossary", nav: "Glossary", group: "Reference", body: () => fromMarkdown("docs/GLOSSARY.md", "Glossary") },
    { slug: "spec-reference", title: "Spec reference", nav: "Spec reference", group: "Reference", body: specReference },
    { slug: "cli-reference", title: "CLI reference", nav: "CLI reference", group: "Reference", body: () => cli },

    { slug: "blueprint", title: "The blueprint", nav: "The blueprint", group: "Design", body: () => fromMarkdown("docs/BLUEPRINT.md", "The blueprint") },
    { slug: "measured", title: "What the build measured", nav: "What we measured", group: "Design", body: () => fromMarkdown("docs/DESIGN.md", "What the build measured") },

    { slug: "blog", title: "Blog", nav: "Blog", group: "Project", body: blogIndex },
    { slug: "about", title: "About", nav: "About", group: "Project", body: about },
    ...posts().map((p): Page => ({ slug: `blog/${p.slug}`, title: p.title, body: () => blogPost(p) })),
  ];
}

// ---- build -------------------------------------------------------------------------------------------
export async function build(): Promise<{ written: string[] }> {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  cpSync(join(HOME, "site/static"), join(OUT, "static"), { recursive: true });

  const all = await pages();
  const written: string[] = [];
  for (const page of all) {
    const file = join(OUT, page.slug === "" ? "index.html" : `${page.slug}.html`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, layout(page, all));
    written.push(file.slice(OUT.length + 1));
  }
  // The installer is served from the site root, so `curl fishtea.dev/install | bash` is one file to host.
  cpSync(join(HOME, "install.sh"), join(OUT, "install"));
  written.push("install");
  return { written };
}

if (import.meta.main) {
  const { written } = await build();
  console.log(`✓ site/dist — ${written.length} files`);
  for (const w of written) console.log(`  ${w}`);

  if (process.argv.includes("--serve")) {
    const port = Number(process.env.PORT ?? 4000);
    Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url);
        const p = url.pathname === "/" ? "/index.html" : url.pathname;
        // Exact path first, then the .html a pretty URL implies. Order matters: `install` is a real
        // extensionless file — the thing `curl fishtea.dev/install | bash` fetches — and appending .html
        // to it unconditionally made the headline install command 404 locally.
        for (const candidate of [p, p.includes(".") ? null : `${p}.html`]) {
          if (!candidate) continue;
          const file = Bun.file(join(OUT, candidate));
          if (await file.exists()) {
            return new Response(file, candidate === "/install" ? { headers: { "content-type": "text/plain; charset=utf-8" } } : undefined);
          }
        }
        return new Response("not found", { status: 404 });
      },
    });
    console.log(`\n  http://localhost:${port}`);
  }
}
