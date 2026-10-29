#!/usr/bin/env bun
/**
 * fishtea.io — a static site, built from what the repository already knows.
 *
 * Release binaries are published too, when `bun run build-release --tarball` has left any in dist/.
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
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { marked } from "marked";
import { compareVersions } from "../packages/spec/src/release.ts";

const HOME = resolve(dirname(new URL(import.meta.url).pathname), "..");
const OUT = join(HOME, "site/dist");
const VERSION = readFileSync(join(HOME, "packages/spec/src/release.ts"), "utf8").match(/FISHTEA_VERSION = "([^"]+)"/)![1];

/** Whether this build publishes the installer and the release tarballs. Closed beta: it does not. */
export const PUBLISH_INSTALL = process.env.PUBLISH_INSTALL === "1";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (s: string) => s.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");


// ---- design tokens ---------------------------------------------------------------------------------
/**
 * The stylesheet's custom properties are generated from `docs/design/tokens.json`, which is the design
 * system synced out of the Design System artifact. Hand-copying twenty colours into CSS guarantees they
 * drift; this way re-syncing one file moves the whole site, which is the same "describe once, derive
 * everything" bargain the framework itself makes.
 *
 * Ebony (dark) is listed first in the system and is therefore the primary theme: it is what `:root`
 * carries, with Oak applied under `prefers-color-scheme: light` and by an explicit `data-theme`.
 */
interface Tokens {
  color: { themes: { id: string; name: string }[]; tokens: { name: string; value: Record<string, string> | string }[] };
  type: { families: Record<string, string>; groups: { name: string; family: string; styles: any[] }[] };
  [family: string]: any;
}

export function readTokens(): Tokens {
  return JSON.parse(readFileSync(join(HOME, "docs/design/tokens.json"), "utf8"));
}

const cssVar = (name: string) => `--${name}`;

/** One theme's colour block. A token with a plain string value belongs to the first theme only. */
function colourBlock(t: Tokens, theme: string, fallback: string): string {
  return t.color.tokens.map((tok) => {
    const v = typeof tok.value === "string" ? (theme === fallback ? tok.value : undefined) : (tok.value[theme] ?? tok.value[fallback]);
    return v ? `  ${cssVar(tok.name)}: ${v};` : "";
  }).filter(Boolean).join("\n");
}

export function tokenCss(t: Tokens = readTokens()): string {
  const [primary, secondary] = t.color.themes.map((x) => x.id);

  const scales = ["spacing", "radius", "border", "shadow", "timing"]
    .filter((f) => t[f]?.tokens)
    .map((f) => t[f].tokens.map((tok: any) => {
      const v = typeof tok.value === "string" ? tok.value : tok.value[primary];
      return `  ${cssVar(tok.name)}: ${v};`;
    }).join("\n")).join("\n");

  // Shadows differ per theme, so any family with per-theme values is re-emitted in the theme blocks.
  const themed = (theme: string) => ["shadow"]
    .filter((f) => t[f]?.tokens)
    .map((f) => t[f].tokens.filter((tok: any) => typeof tok.value === "object")
      .map((tok: any) => `  ${cssVar(tok.name)}: ${tok.value[theme] ?? tok.value[primary]};`).join("\n"))
    .filter(Boolean).join("\n");

  const families = Object.entries(t.type.families).map(([k, v]) => `  --font-${k}: ${v};`).join("\n");
  const styles = t.type.groups.flatMap((g) => g.styles.map((st: any) =>
    `  --text-${st.name}: ${st.fontWeight ?? 400} ${st.fontSize}/${st.lineHeight} var(--font-${g.family});` +
    (st.letterSpacing ? `\n  --tracking-${st.name}: ${st.letterSpacing};` : ""))).join("\n");

  return `/* Generated from docs/design/tokens.json by site/build.ts. Do not edit; edit the tokens. */
:root {
  color-scheme: dark;
${colourBlock(t, primary, primary)}
${scales}
${themed(primary)}
${families}
${styles}
}

@media (prefers-color-scheme: light) {
  :root:not([data-theme="${primary}"]) {
    color-scheme: light;
${colourBlock(t, secondary, primary).replace(/^ {2}/gm, "    ")}
${themed(secondary).replace(/^ {2}/gm, "    ")}
  }
}

:root[data-theme="${secondary}"] {
  color-scheme: light;
${colourBlock(t, secondary, primary).replace(/^ {2}/gm, "  ")}
${themed(secondary)}
}
`;
}

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

/**
 * A documentation page: the section list, the article, and a rail of the article's own h2s.
 *
 * The rail is built from the rendered HTML rather than from the Markdown, because the heading ids it
 * links to are minted by the renderer — reading them back is the only way the two cannot disagree. Pages
 * with fewer than three sections get no rail; a list of two is furniture, not navigation.
 */
function docsMain(page: Page, side: string): string {
  const body = page.body();
  const heads = [...body.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)]
    .map((m) => ({ id: m[1], text: m[2].replace(/<a class="anchor"[\s\S]*$/, "").replace(/<[^>]+>/g, "").trim() }));
  const rail = heads.length < 3 ? "" :
    `<nav class="rail" aria-label="On this page"><h4>On this page</h4><ul>${heads
      .map((h) => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`).join("")}</ul></nav>`;

  return `<main id="main" class="wrap docs${rail ? " has-rail" : ""}">` +
    `<details class="side" open><summary>Documentation</summary><div class="side-inner">${side}</div></details>` +
    `<article class="prose">${body}</article>${rail}</main>`;
}

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
    ["beta", "beta"],
  ].map(([label, s]) => `<a href="${href(s)}"${page.slug === s || (s === "blog" && page.slug.startsWith("blog/")) ? ' aria-current="page"' : ""}>${label}</a>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}${page.landing ? "" : " — FishTea"}</title>
<meta name="description" content="Describe a business once in JSON; derive the database, the classifier's tools, the planner, the UI and the operator console from it.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${root}static/site.css">
<link rel="icon" href="${root}static/img/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="${root}static/img/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="${root}static/img/favicon-16.png">
<link rel="apple-touch-icon" href="${root}static/img/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="FishTea">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="Describe a business once in JSON; derive the database, the classifier's tools, the planner, the UI and the operator console from it.">
<meta property="og:image" content="https://fishtea.io/static/img/og-image.png">
<meta property="og:url" content="https://fishtea.io/${page.slug}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(page.title)}">
<meta name="twitter:image" content="https://fishtea.io/static/img/og-image.png">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="wrap">
  <a class="brand" href="${href("")}" aria-label="FishTea">
    <img class="cup" src="${root}static/img/logo-mark.png" srcset="${root}static/img/logo-mark.png 1x, ${root}static/img/logo-mark@2x.png 2x" alt="" width="34" height="32">
    <img class="wordmark on-ebony" src="${root}static/img/wordmark-dark.svg" alt="FishTea" width="97" height="39">
    <img class="wordmark on-oak" src="${root}static/img/wordmark-light.svg" alt="" aria-hidden="true" width="97" height="39">
  </a>
  <nav>${topNav}</nav>
  <div class="header-end">
    <span class="badge gold">beta</span>
    <a class="btn small" href="${href("beta")}">Apply for access</a>
  </div>
</div></header>
${isDoc ? docsMain(page, side) : `<main id="main">${page.body()}</main>`}
<script>
/* The docs sidebar is a <details> that ships open, so with no JavaScript it behaves as it always has.
   On a phone it is closed on load instead, so an article starts at the top of the screen rather than
   below fifteen links. CSS alone cannot do this: a closed <details> lays its children out but does not
   paint them, so forcing a display value on them at desktop width does nothing. */
(function () {
  var d = document.querySelector("details.side");
  if (d && !window.matchMedia("(min-width: 64rem)").matches) d.removeAttribute("open");
})();
</script>
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
  // The four nouns the whole framework is built from. The design system asks for one card per concept and
  // for exactly one of them to carry the wood accent — so SPEC, the thing everything else derives from.
  const concepts: [string, string, string, string][] = [
    ["spec", "SPEC", "One file", "A business described once: entities, shapes, calls, rules, personas. Everything below is derived from it, and nothing may contradict it."],
    ["shape", "SHAPE", "A question it answers", "Not a route. A shape is something a visitor may ask, with typed arguments — which is also, exactly, a tool the classifier can choose."],
    ["call", "CALL", "A typed step", "SQL or a compute module, declared with its inputs and outputs. The planner composes calls; the model never writes one."],
    ["vessel", "VESSEL", "Where the answer pours", "Seven shapes of answer — list, card, detail, form, confirm, timeline, note. Never a page; the vessel is chosen by the answer."],
  ];

  return `
<div class="hero"><div class="wrap">
  <div>
    <p class="tag">solid ground, liquid UI</p>
    <h1>Describe a business once.<br>Derive everything else.</h1>
    <p class="lede">
      One <code>spec.json</code> gives you the Postgres schema, the classifier's tool list, the planner, the
      UI and an operator console. Conversation replaces routing: a small on-device model turns what a
      visitor says into a <strong>shape</strong>, the planner composes typed <strong>calls</strong>, and the
      answer pours into one of seven <strong>vessels</strong>.
    </p>
    <div class="cta">
      <a class="btn" href="beta.html">Apply for access</a>
      <a class="btn ghost" href="welcome.html">Read the argument</a>
    </div>
    <p class="stack">FishTea ${VERSION}, in closed beta. The binary and the source come with the
    invitation — <a href="welcome.html">start with Welcome</a> to see whether it is for you.</p>
    <p class="stack">Bun · PostgreSQL + pgvector · needle3 on device · React. No cloud model in the hot path.</p>
  </div>
  <div class="hero-art">
    <img src="static/img/logo-mark@2x.png" alt="" width="256" height="242">
  </div>
</div></div>

<section><div class="wrap">
  <p class="key">Try it — the answer shapes itself</p>
  <h2>One turn, end to end</h2>
  <p class="sub">What a visitor types, what the classifier understood, what poured, and the provenance
  underneath it. Every part of this is derived; none of it is a page.</p>
  <div class="demo">
    <div>
      <p class="mouth">something linen for a summer wedding, under £80</p>
      <p class="understood"><span class="dot high"></span> findProducts · fabric: linen · occasion: wedding · max: 80</p>
      <p class="post-meta">The classifier picks a shape and fills its arguments. Below the budget it asks
      instead of guessing — never a dumber model.</p>
    </div>
    <div class="vessel">
      <h4>Three that fit</h4>
      <div class="row"><span class="name">Ravello linen shirt</span><span class="price">£68</span></div>
      <div class="row"><span class="meta">oatmeal · in stock</span><span class="meta">ships Thu</span></div>
      <hr style="border:0;border-top:var(--hairline) solid var(--line);margin:var(--space-3) 0">
      <div class="row"><span class="name">Bari linen trouser</span><span class="price">£74</span></div>
      <div class="row"><span class="meta">sand · two left</span><span class="meta">ships Thu</span></div>
      <p class="verify"><span class="read">read</span> products, stock · 41 ms · shape findProducts</p>
    </div>
    <div>
      <p class="mouth">not those, something warmer</p>
      <p class="understood shaping"><span class="dot mid"></span> same shape, next turn — tone: warm</p>
      <p class="post-meta">A refinement is not a filter control. It is the next thing said, and the trail
      keeps both turns so the visitor can rewind to either.</p>
    </div>
  </div>
</div></section>

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
      <ul class="claims">
        <li><strong>Browsing is not a funnel.</strong> It is how a customer works out what they implicitly
        like. Most of it is not purchase intent, and treating it as a path to checkout measures the wrong
        thing.</li>
        <li><strong>Search is not a result set to filter.</strong> The search <em>is</em> the question, and
        what comes back is an opportunity to ignore or to go deeper.</li>
        <li><strong>Personalisation stops being a layer.</strong> If the interaction <em>is</em> the
        conversation, every surface is already personal — by what was actually said, not by a profile.</li>
      </ul>
      <p><a href="blog/why-a-business-is-not-a-set-of-pages.html">The longer argument →</a></p>
    </div>
  </div>
  <div class="cards" style="margin-top:var(--space-6)">
    ${concepts.map(([id, key, lead, d], i) =>
      `<div class="card${i === 0 ? " wood" : ""}"><p class="key">${key}</p><h3>${lead}</h3><p>${d}</p></div>`).join("\n    ")}
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
  <p class="key">Start from an archetype</p>
  <h2>Five, each one already running</h2>
  <p class="sub">Every archetype is a complete application with seed data and an onboarding interview that
  turns it into <em>your</em> business.</p>
  <dl class="archetypes">
    ${archetypes.map(([n, d]) => `<div class="item"><dt>${n}</dt><dd>${d}</dd></div>`).join("\n    ")}
  </dl>
</div></section>

<section><div class="wrap">
  <h2>Plugins for everything outside the conversation</h2>
  <p class="sub">Six seams, one mechanism. A plugin is a directory with a manifest; what it contributes is
  merged when the spec loads and never written into your <code>spec.json</code>.</p>
  <div class="cards">
    ${seams.map(([n, d]) => `<div class="card"><p class="key">${n}</p><p>${d}</p></div>`).join("\n    ")}
  </div>
  <p style="margin-top:var(--space-5)"><a href="plugins.html">How plugins work →</a></p>
</div></section>

<section><div class="wrap">
  <h2>Upgrade without regenerating</h2>
  <p class="sub">An application pins a framework range and records where every file came from, so an
  upstream fix reaches it without touching a line you wrote.</p>
  <div class="split">
    <div>
      <pre><code>$ fishtea update

framework  1.5.0 → 1.6.0  (pinned ^1.5.0)
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

<section style="border-bottom:0"><div class="wrap">
  <h2>The homepage is where the conversation is</h2>
  <p class="sub">FishTea ${VERSION} · beta · the source is private for now.</p>
  <div class="cta">
    <a class="btn" href="beta.html">Apply for access</a>
    <a class="btn ghost" href="welcome.html">Start with Welcome</a>
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


// ---- beta ------------------------------------------------------------------------------------------
/**
 * FishTea is not publicly installable yet — there are no published release binaries — so the landing
 * page asks to be let in rather than handing out a `curl | bash` that would fail at the download.
 *
 * The form composes a mailto: in the browser and opens the visitor's mail client. Nothing is posted
 * anywhere, there is no backend and no third party sees an address, which is the right trade for a
 * static site collecting a handful of names. The plain address is on the page too, so anyone without a
 * configured mail client is not stuck.
 */
const BETA_EMAIL = "shawn@irietek.com";

function beta(): string {
  return `<h1>Join the beta</h1>
<p>FishTea installs today — <a href="getting-started.html">four commands</a> and you have a running
application. What is still private is the <strong>source</strong>, and the help that goes with it.</p>
<p>Ask for access if you want to read the code, file issues, or have a hand getting something real
built. Tell me what you would make with it.</p>

<form class="beta-form" id="beta-form" novalidate>
  <div class="field">
    <label for="beta-name">Your name</label>
    <input id="beta-name" name="name" type="text" autocomplete="name" required>
  </div>
  <div class="field">
    <label for="beta-email">Your email</label>
    <input id="beta-email" name="email" type="email" autocomplete="email" required>
  </div>
  <div class="field">
    <label for="beta-what">What would you build?</label>
    <textarea id="beta-what" name="what" rows="5"
      placeholder="A shop, a booking system, something stranger — and roughly what you would want to ask it."></textarea>
  </div>
  <div class="field">
    <button type="submit" class="btn">Compose the email</button>
    <p class="post-meta" id="beta-note">This opens your mail client with the message ready to send. Nothing
    is submitted to a server.</p>
  </div>
</form>

<p>Or write to <a href="mailto:${BETA_EMAIL}?subject=FishTea%20beta">${BETA_EMAIL}</a> directly.</p>

<h2 id="what-happens-next">What happens next</h2>
<p>You get a reply with the installer and a checkout, and one command to run. There is nothing to download
from this site in the meantime: while the beta is closed the binaries are not published here, so the
invitation is the way in rather than a formality in front of a public link.</p>
<p>Builds exist for linux-x64, linux-arm64, darwin-x64, darwin-arm64 and windows-x64. Postgres and the
classifier pool run in Docker; everything else is one binary.</p>

<script>
(function () {
  var form = document.getElementById("beta-form");
  if (!form) return;
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var name = (form.name.value || "").trim();
    var email = (form.email.value || "").trim();
    var what = (form.what.value || "").trim();
    if (!name || !email) {
      document.getElementById("beta-note").textContent = "A name and an email, please — the rest is optional.";
      (!name ? form.name : form.email).focus();
      return;
    }
    var body = "Name: " + name + "\\nEmail: " + email + "\\n\\nWhat I would build:\\n" + (what || "(not said)") + "\\n";
    window.location.href = "mailto:${BETA_EMAIL}"
      + "?subject=" + encodeURIComponent("FishTea beta — " + name)
      + "&body=" + encodeURIComponent(body);
  });
})();
</script>`;
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
    <p><a href="https://shawnstewart.me" rel="me">shawnstewart.me</a></p>
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
    { slug: "connectors", title: "Connectors", nav: "Connectors", group: "Operating", body: () => fromMarkdown("docs/CONNECTORS.md", "Connectors") },

    { slug: "glossary", title: "Glossary", nav: "Glossary", group: "Reference", body: () => fromMarkdown("docs/GLOSSARY.md", "Glossary") },
    { slug: "spec-reference", title: "Spec reference", nav: "Spec reference", group: "Reference", body: specReference },
    { slug: "cli-reference", title: "CLI reference", nav: "CLI reference", group: "Reference", body: () => cli },

    { slug: "blueprint", title: "The blueprint", nav: "The blueprint", group: "Design", body: () => fromMarkdown("docs/BLUEPRINT.md", "The blueprint") },
    { slug: "measured", title: "What the build measured", nav: "What we measured", group: "Design", body: () => fromMarkdown("docs/DESIGN.md", "What the build measured") },
    { slug: "nested-shapes", title: "Shapes within shapes", nav: "Shapes within shapes", group: "Design", body: () => fromMarkdown("docs/NESTED-SHAPES.md", "Shapes within shapes") },
    { slug: "addresses", title: "Addresses and the timeline", nav: "Addresses & the timeline", group: "Design", body: () => fromMarkdown("docs/ADDRESSES.md", "Addresses and the timeline") },
    { slug: "generative-ui", title: "Generative UI: what to take from json-render", nav: "Generative UI", group: "Design", body: () => fromMarkdown("docs/GENERATIVE-UI.md", "Generative UI") },
    { slug: "access", title: "Access control", nav: "Access control", group: "Operating", body: () => fromMarkdown("docs/ACCESS.md", "Access control") },
    { slug: "tuning", title: "A classifier for one business", nav: "Tuning the classifier", group: "Operating", body: () => fromMarkdown("docs/TUNING.md", "A classifier for one business") },

    { slug: "beta", title: "Join the beta", nav: "Join the beta", group: "Project", body: beta },
    { slug: "blog", title: "Blog", nav: "Blog", group: "Project", body: blogIndex },
    { slug: "about", title: "About", nav: "About", group: "Project", body: about },
    ...posts().map((p): Page => ({ slug: `blog/${p.slug}`, title: p.title, body: () => blogPost(p) })),
  ];
}


/**
 * Publish whatever `bun run build-release --tarball` has left in dist/.
 *
 * Release binaries are not in the repository — they are build output, 26-39 MB each — so this copies
 * whatever is on disk at deploy time. No tarballs simply means no releases directory, and the installer
 * and `fishtea upgrade` both already fail politely with a pointer at `--from <checkout>`.
 *
 * `latest` is the newest version by semver, not by filename or mtime, and is what install.sh reads when
 * no version is named. SHA256SUMS is written here rather than by the build so it always describes exactly
 * what is being published together.
 */
export function stageReleases(): string[] {
  const from = join(HOME, "dist");
  if (!existsSync(from)) return [];
  const tarballs = readdirSync(from).filter((f) => f.endsWith(".tar.gz")).sort();
  if (!tarballs.length) return [];

  const out = join(OUT, "releases");
  mkdirSync(out, { recursive: true });
  const written: string[] = [];
  const sums: string[] = [];

  for (const f of tarballs) {
    cpSync(join(from, f), join(out, f));
    sums.push(`${createHash("sha256").update(readFileSync(join(from, f))).digest("hex")}  ${f}`);
    written.push(`releases/${f}`);
  }

  const versions = [...new Set(tarballs.map((f) => f.match(/^fishtea-(\d+\.\d+\.\d+[^-]*)-/)?.[1]).filter(Boolean) as string[])];

  /**
   * Refuse a release set that does not contain the framework this build *is*.
   *
   * `dist/` is build output that nobody clears, so it accumulates. Staging whatever happens to be
   * there means `latest` is "the newest tarball on this disk", which is not the same thing as the
   * current version — a dist holding only 1.1.0 while the framework says 1.6.0 publishes 1.1.0 as
   * newest, and `install.sh` and `fishtea upgrade` both believe it.
   *
   * Older versions alongside the current one are fine and wanted: somebody pinning ^1.5.0 should still
   * be able to download it. What is never right is shipping a set the current build is absent from.
   */
  if (!versions.includes(VERSION)) {
    throw new Error(
      `dist/ has tarballs for ${versions.join(", ") || "nothing"} but not ${VERSION}, so "latest" would ` +
      `advertise ${versions.sort(compareVersions).at(-1)} as the newest release.\n` +
      `  Build this version:  bun run build-release --target <t> --tarball\n` +
      `  Or clear the stale output: rm -rf dist`,
    );
  }
  const latest = versions.sort(compareVersions).at(-1) ?? VERSION;

  writeFileSync(join(out, "SHA256SUMS"), sums.join("\n") + "\n");
  writeFileSync(join(out, "latest"), latest + "\n");
  written.push("releases/SHA256SUMS", "releases/latest");
  return written;
}

// ---- build -------------------------------------------------------------------------------------------
export async function build(): Promise<{ written: string[] }> {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  cpSync(join(HOME, "site/static"), join(OUT, "static"), { recursive: true });
  // The palette is not written by hand. site.css imports this; tokens.json is the only place a colour,
  // a step of spacing or a radius is decided, and it is shared verbatim with the design system.
  writeFileSync(join(OUT, "static/tokens.generated.css"), tokenCss());

  const all = await pages();
  const written: string[] = [];
  for (const page of all) {
    const file = join(OUT, page.slug === "" ? "index.html" : `${page.slug}.html`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, layout(page, all));
    written.push(file.slice(OUT.length + 1));
  }
  // While the beta is closed, the site publishes no way to install: no `/install`, no `/releases`.
  //
  // Not hidden — absent. A route that merely goes unlinked is still a route, and `fishtea.io/install` is
  // not a URL anybody has to guess. Access comes with the invitation instead, which is the whole point of
  // asking people to apply. `bun run site` and `bun run deploy` both honour PUBLISH_INSTALL=1, so opening
  // it back up is one environment variable and a deploy, not a hunt through this file.
  if (PUBLISH_INSTALL) {
    cpSync(join(HOME, "install.sh"), join(OUT, "install"));
    written.push("install");
    written.push(...stageReleases());
  }
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
        // extensionless file — the thing `curl fishtea.io/install | bash` fetches — and appending .html
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
