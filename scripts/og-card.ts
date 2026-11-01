#!/usr/bin/env bun
/**
 * The social card, rendered from the design system rather than drawn beside it.
 *
 *   bun scripts/og-card.ts            # writes site/static/img/og-image.png
 *
 * Why a browser and not ImageMagick: the card is the one image most people see before they see the
 * site, so it should be made of the same things the site is made of — the real wordmark, the real
 * display face, the real tokens, a real console. Composing it with `magick -annotate` meant hand-typing
 * four colours and a substitute font, and every one of those drifted the moment the palette moved.
 *
 * This reads `site/dist/static/` for the stylesheet and the generated tokens, so run it after
 * `bun run site`. It is not part of that build: the site build has no runtime dependencies and takes no
 * browser, and this needs both. The output is committed, like every other brand asset.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { chromium } from "playwright";

const HOME = resolve(dirname(new URL(import.meta.url).pathname), "..");
const DIST = join(HOME, "site/dist/static");
const OUT = join(HOME, "site/static/img/og-image.png");

if (!existsSync(join(DIST, "site.css"))) {
  console.error("run `bun run site` first — this reads the built stylesheet so the card cannot drift from it");
  process.exit(1);
}

const inline = (f: string) => readFileSync(join(DIST, f), "utf8");
// The stylesheet's first line imports the tokens by relative URL, which a data: page cannot resolve.
const css = inline("tokens.generated.css") + inline("site.css").replace(/@import url\("tokens\.generated\.css"\);/, "");
const wordmark = readFileSync(join(DIST, "img/wordmark-dark.svg"), "utf8");
const logomark = readFileSync(join(DIST, "img/logo-mark.svg"), "utf8");

const html = `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8">
<style>${css}
  html, body { width: 1200px; height: 630px; margin: 0; overflow: hidden; }
  body { background: var(--ground); display: grid; grid-template-columns: 1fr 1fr;
         align-items: center; gap: 56px; padding: 0 72px; }
  .lockup { display: flex; align-items: center; gap: 14px; margin-bottom: 30px; }
  .lockup .cup { height: 56px; width: 56px; }
  .lockup .mark { height: 52px; width: auto; display: block; }
  .tag { font: var(--text-key); letter-spacing: var(--tracking-key); text-transform: uppercase;
         color: var(--ink-3); margin: 0 0 18px; display: flex; align-items: center; gap: 14px; }
  .tag::before { content: ""; width: 34px; height: var(--accent-bar); background: var(--green); }
  h1 { font: var(--text-display-lg); letter-spacing: var(--tracking-display-lg); color: var(--ink);
       margin: 0 0 20px; }
  p.l { font: var(--text-body); color: var(--ink-2); margin: 0; max-width: 26rem; }
  .console { box-shadow: none; }
</style></head><body>
<div>
  <div class="lockup">${logomark.replace("<svg", '<svg class="cup"')}${wordmark.replace("<svg", '<svg class="mark"')}</div>
  <p class="tag">solid ground, liquid UI</p>
  <h1>Describe a business once.<br>Derive everything else.</h1>
  <p class="l">One spec gives you the schema, the classifier's tools, the planner, the UI and the
  operator console.</p>
</div>
<div class="console">
  <div class="console-bar"><span class="pip"></span><span class="pip"></span><span class="pip"></span>
    <span class="what">a shop, described once</span></div>
  <div class="console-body">
    <p class="said">something linen for a summer wedding, under $80</p>
    <p class="understood"><span class="dot high"></span> findProducts · fabric: linen · max: 80</p>
    <div class="vessel">
      <h4>Three that fit</h4>
      <div class="row"><span class="name">Ravello linen shirt</span><span class="price">$68</span></div>
      <div class="row"><span class="meta">oatmeal · in stock</span><span class="meta">ships Thu</span></div>
      <p class="verify"><span class="read">read</span> products, stock · 41 ms</p>
    </div>
  </div>
</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, colorScheme: "dark" });
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
writeFileSync(OUT, await page.screenshot({ type: "png" }));
await browser.close();
console.log(`wrote ${OUT}`);
