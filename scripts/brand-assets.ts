#!/usr/bin/env bun
/**
 * The FishTea mark, as geometry, and every asset derived from it.
 *
 *   bun scripts/brand-assets.ts        # rewrites the SVGs, then the PNGs and the .ico
 *
 * The mark is a cup whose lower two-thirds is a wave: the brand's own claim — a solid vessel, and a
 * liquid that takes its shape — drawn rather than described. It replaced a raster cartoon that had no
 * vector at all (an earlier package advertised one, but it was a base64 PNG wrapped in an `<svg>`), so
 * every size was a resample of a 945px drawing and the header mark at 28px was a smudge.
 *
 * Everything here comes out of the twelve numbers below. Change a path and the favicon, the app icon,
 * the header lockup and the social card all move together, which is the only way a mark stays one mark.
 *
 * Rasterising goes through headless Chromium rather than ImageMagick's own SVG renderer, which is a
 * fallback renderer and shows it on curves at 16px. Playwright is already a dev dependency for the
 * browser walkthrough, and `magick` is used for one thing only: packing three PNGs into an .ico.
 */
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { chromium } from "playwright";

const HOME = resolve(dirname(new URL(import.meta.url).pathname), "..");
const IMG = join(HOME, "site/static/img");

// ---- the geometry ----------------------------------------------------------------------------------
const BOWL = "M5 12.5 H23 V17 Q23 26 14 26 Q5 26 5 17 Z";
const HANDLE = "M23.4 16.2 Q28.8 16.2 28.8 19.6 Q28.8 23 23.4 23";
const LIQUID = "M4 17.6 Q9.5 14.4 14 17.6 T24 17.6 V27 H4 Z";

/**
 * Two cuts of one mark, because 16px is not a small 32px.
 *
 * `full` is the drawing: cup, handle, wave, a 2.1 stroke, centred on the whole bounding box (the
 * handle makes it wider right and lower bottom, so the box's centre is not the bowl's).
 *
 * `small` is the same bowl and the same wave with the handle removed and the stroke taken to 3.2,
 * recentred on the bowl alone and scaled to fill. At 16 CSS px one unit is half a pixel: the 2.1
 * stroke lands on 1.05px and antialiases to the grey smudge the handle had already become, while the
 * rim and the liquid's edge merge. Dropping the handle is what buys the room to thicken the rest —
 * and a handle at 16px was never legible as a handle, only as dirt beside the cup.
 */
type Cut = { stroke: number; cx: number; cy: number; scale: number; handle: boolean };
const FULL: Cut = { stroke: 2.1, cx: 16.9, cy: 19.25, scale: 1.12, handle: true };
const SMALL: Cut = { stroke: 3.2, cx: 14, cy: 19.25, scale: 1.41, handle: false };

/** `uid` keeps the clip path unique: two of these can be inlined on one page (the social card does it). */
function mark(ink: string, accent: string, uid: string, ground?: string, cut: Cut = FULL): string {
  const bg = ground ? `\n  <rect width="32" height="32" rx="7" fill="${ground}"/>` : "";
  const handle = cut.handle
    ? `\n    <path d="${HANDLE}" stroke="${ink}" stroke-width="${cut.stroke}" stroke-linecap="round" fill="none"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="FishTea">${bg}
  <defs><clipPath id="${uid}"><path d="${BOWL}"/></clipPath></defs>
  <g transform="translate(16,16) scale(${cut.scale}) translate(${-cut.cx},${-cut.cy})">
    <g clip-path="url(#${uid})"><path d="${LIQUID}" fill="${accent}"/></g>
    <path d="${BOWL}" stroke="${ink}" stroke-width="${cut.stroke}" stroke-linejoin="round" fill="none"/>${handle}
  </g>
</svg>
`;
}

// The two the page uses, transparent, one per theme — the same swap the wordmark uses, because both
// artworks carry their own fills and an <img> cannot inherit currentColor.
const SLATE = ["#e8edf2", "#4fe0b8"] as const;      // ink, accent — tokens.json, dark
const DAYLIGHT = ["#0e1419", "#0b6e58"] as const;   // tokens.json, light
const GROUND = "#0b0d10";
writeFileSync(join(IMG, "logo-mark.svg"), mark(...SLATE, "d"));
writeFileSync(join(IMG, "logo-mark-light.svg"), mark(...DAYLIGHT, "l"));
// The icon lands on a browser tab or a home screen, which may be any colour, so it carries its own
// ground rather than hoping. Slate reads under a light tab bar and a dark one.
writeFileSync(join(IMG, "icon.svg"), mark(...SLATE, "i", GROUND));

// ---- the rasters -----------------------------------------------------------------------------------
const browser = await chromium.launch();
async function png(svg: string, size: number, out: string, transparent: boolean) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;width:${size}px;height:${size}px}
    svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  writeFileSync(join(IMG, out), await page.screenshot({ omitBackground: transparent }));
  await page.close();
  console.log(`  ${out}  ${size}px`);
}
const transparent = mark(...SLATE, "d");
const icon = mark(...SLATE, "i", GROUND);
const iconSmall = mark(...SLATE, "s", GROUND, SMALL);
await png(transparent, 72, "logo-mark.png", true);
await png(transparent, 144, "logo-mark@2x.png", true);
// 16 is the only size that gets the small cut. 32 upward has the pixels for the handle, and the tab
// strip shows 32 on every display anyone has bought this decade — 16 is the history we still serve.
await png(iconSmall, 16, "favicon-16.png", false);
await png(icon, 32, "favicon-32.png", false);
await png(icon, 48, "favicon-48.png", false);
await png(icon, 180, "apple-touch-icon.png", false);
await browser.close();

const ico = Bun.spawnSync(["magick", join(IMG, "favicon-16.png"), join(IMG, "favicon-32.png"),
  join(IMG, "favicon-48.png"), join(IMG, "favicon.ico")]);
if (ico.exitCode !== 0) {
  console.error("magick failed — favicon.ico not rebuilt:", ico.stderr.toString());
  process.exit(1);
}
// 48 exists only to go into the .ico; nothing links it.
await Bun.file(join(IMG, "favicon-48.png")).delete();
console.log("  favicon.ico  16+32+48");
console.log("\nThe social card embeds the mark too: bun run site && bun scripts/og-card.ts");
