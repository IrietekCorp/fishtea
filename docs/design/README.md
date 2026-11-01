# Brand assets

Everything the site serves lives in `site/static/img/`, and all of it comes out of one place:

```bash
bun scripts/brand-assets.ts     # the SVGs, then every favicon, the app icon and the raster marks
bun run site && bun scripts/og-card.ts   # the social card, which embeds the mark
```

| file | what it is |
|---|---|
| `scripts/brand-assets.ts` | **the source.** Twelve numbers of path data; every asset below is derived from them |
| `logo-mark.svg`, `logo-mark-light.svg` | the mark, transparent, one per theme |
| `icon.svg` | the same mark on its own slate ground, for a tab bar or a home screen |
| `favicon.ico`, `favicon-16/32.png`, `apple-touch-icon.png` | rasterised from `icon.svg` |
| `logo-mark.png`, `logo-mark@2x.png` | rasterised from `logo-mark.svg`, for anything that cannot take an SVG |
| `og-image.png` | the social card, rendered from the built stylesheet (below) |
| `docs/design/fishtea-logo.png` | the original cartoon artwork, untouched |
| `docs/design/fishtea-logo-transparent.png` | that artwork with its baked-in checkerboard removed |

**The last two are history, not sources.** The mark is a drawn vector now and nothing in
`site/static/img/` derives from the cartoon any more. The section below is kept because the technique
is genuinely hard-won and the files are still in the repository — if you ever need to rescue that
artwork again, this is how.

## The supplied file had its transparency baked in

`fishtea-logo.png` is **RGB, not RGBA** — three channels, no alpha. What looks like a transparent
background is a **checkerboard rendered into the pixels**: the corner samples alternate `255,255,255` and
`198,198,198`, which is a transparency *preview* that got flattened on export.

A normal background removal does not work on it. Flood-filling from the corners only clears one of the two
checker tones, because squares of the same colour touch diagonally and flood fill is four-connected. Using
a fuzz wide enough to span both tones also reaches the cream of the cup, which is closer to white than the
two greys are to each other.

What works is that **the checkerboard is perfectly neutral and the artwork is not**. Every checker pixel
has `R == G == B`; the cup is `246,227,187`, the steam `177,168,159`, the soup `220,154,31`. So sweeping
the neutral band removes the background and cannot touch the drawing:

```bash
args=""
for v in 186 192 198 204 210 216 222 228 234 240 246 252 255; do
  args="$args -fuzz 3% -transparent srgb($v,$v,$v)"
done
magick docs/design/fishtea-logo.png -alpha set $args /tmp/cut.png
magick /tmp/cut.png -trim +repage docs/design/fishtea-logo-transparent.png
```

The step of 6 with 3% fuzz overlaps, so the anti-aliased grid lines *between* squares go too — those are
what a plain exact-colour removal leaves behind, and they are very visible against a dark background.

The sweep stops at 186 deliberately. The steam is the darkest near-neutral thing in the drawing, and going
lower starts eating it.

**Always check the result over a dark background *and* a light one.** A missed region shows up as a pale
blob on dark, and the cup is cream, so light backgrounds are where you find out whether the outline is
carrying it.

## Regenerating from the cartoon (historical)

The commands that used to build the favicons out of `fishtea-logo-transparent.png` are gone; the mark
is geometry now, and `scripts/brand-assets.ts` is both shorter and exact at every size. What the old
pipeline could never do was 16px: a 945px drawing resampled to a 16px favicon is mud, and the header
mark at 28px was the same problem one notch up. That is the whole reason the mark was redrawn.

## The social card

The card is not drawn beside the design system; it is rendered *out of* it.

```bash
bun run site                 # the card reads the built stylesheet, so build first
bun scripts/og-card.ts       # writes site/static/img/og-image.png
```

It opens a 1200×630 page in headless Chromium using `site/dist/static/site.css`, the generated tokens
and the real wordmark, and screenshots it. That is why it shows a console rather than the cup: the one
image most people meet before they meet the site is made of the same parts the site is.

The earlier version composed the card with `magick -annotate`, which meant hand-typing four hex colours
and substituting a font the brand does not use. Every one of those drifted the moment the palette moved
— which is exactly what happened when it did.

It is deliberately not part of `bun run site`: that build has no runtime dependencies and needs no
browser, and this needs both. The PNG is committed, like every other brand asset.

A screenshot of flat colour and type compresses well on its own; the card lands around 54 KB with no
palette reduction, where the old composed one needed `-colors 128` to come down from ~390 KB.

## There is a vector now

There was not, for a long time. An earlier package advertised an `.svg`, but it was a base64 PNG wrapped
in an `<svg>` element — it would not have scaled crisply, and the site used fixed-size PNGs rather than
pretend otherwise.

`scripts/brand-assets.ts` is the answer: the mark is three paths, a stroke width and a transform, so the
header lockup, the favicon and a 180px app icon are all the same drawing rather than three resamples of
one. Change a path and run it, and everything moves together.

The wordmark is still supplied artwork (`wordmark-dark.svg`, `wordmark-light.svg`) — real outlines, but
drawn from Manrope, which the site no longer sets. It is legible and it is a wordmark, so it is allowed
its own letterforms; redrawing it in Inter Tight is a thing to do deliberately, not by accident.
