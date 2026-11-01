# Brand assets

| file | what it is |
|---|---|
| `fishtea-logo.png` | the supplied artwork, untouched |
| `fishtea-logo-transparent.png` | the master the site is built from — 945×892, genuinely transparent |

Everything the site serves lives in `site/static/img/` and is derived from the master. Regenerate with the
commands below whenever the logo changes.

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

## Regenerating the web assets

```bash
M=docs/design/fishtea-logo-transparent.png

# square canvas — the artwork is wider than tall, so pad rather than distort
magick $M -background none -gravity center -extent 945x945 /tmp/sq.png

# favicons
for s in 16 32 48; do magick /tmp/sq.png -resize ${s}x${s} /tmp/fav-$s.png; done
magick /tmp/fav-16.png /tmp/fav-32.png /tmp/fav-48.png site/static/img/favicon.ico
cp /tmp/fav-32.png site/static/img/favicon-32.png
cp /tmp/fav-16.png site/static/img/favicon-16.png

# iOS needs an opaque background, or it composites transparency onto black. The cup is cream, so it
# sits on the dark ground rather than a pale one, and reads on an iOS home screen in either mode.
magick /tmp/sq.png -resize 168x168 -background "#0b0d10" -gravity center -extent 180x180 \
  site/static/img/apple-touch-icon.png

# header mark — still generated, though the site header is the wordmark alone (BRAND.md)
magick $M -resize x72  site/static/img/logo-mark.png
magick $M -resize x144 site/static/img/logo-mark@2x.png
```

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

## If you commission a vector

There isn't one. An earlier package advertised an `.svg`, but it was a base64 PNG wrapped in an `<svg>`
element — it would not have scaled crisply. The site therefore uses PNGs at fixed sizes rather than
pretending otherwise. A real vector would let the header mark and favicons be generated at any size
without resampling; if one ever arrives, replace the master and simplify all of the above.
