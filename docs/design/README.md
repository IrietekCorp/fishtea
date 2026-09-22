# Brand assets

| file | what it is |
|---|---|
| `fishtea-logo-package.zip` | the original delivery, untouched |
| `fishtea-logo-transparent.png` | the master the site is built from — 1007×952, genuinely transparent |

Everything the site serves lives in `site/static/img/` and is derived from the master. Regenerate with the
commands below if the logo changes.

## What was wrong with the original package

Three things did not match the description, and two mattered:

- **The PNG was not transparent.** Alpha was 255 in all four corners — an opaque white background inside an
  RGBA image. Fixed by flood-filling from the corners *and* from inside the cup handle, which is an
  enclosed region the corner fills cannot reach. Filling by colour instead would have punched holes
  through the steam, the fish bones and the eye highlights, which are also white.
- **The `.ico` was not square** — 16×14, 32×28, 48×42 and so on, inherited from the 1092×960 artwork.
  Non-square favicons render badly. The shipped `.ico` is padded to square at 16/32/48.
- **The `.svg` is not vector.** It is a base64 PNG wrapped in an `<svg>` element, so it will not scale
  crisply. Nothing can fix that short of redrawing it; the site therefore uses PNGs at fixed sizes rather
  than pretending otherwise. **If you ever commission a real vector, replace the master and this note.**

## Regenerating the web assets

```bash
M=docs/design/fishtea-logo-transparent.png

# square canvas — the artwork is wider than tall, so pad rather than distort
magick $M -background none -gravity center -extent 1092x1092 /tmp/sq.png

# favicons
for s in 16 32 48; do magick /tmp/sq.png -resize ${s}x${s} /tmp/fav-$s.png; done
magick /tmp/fav-16.png /tmp/fav-32.png /tmp/fav-48.png site/static/img/favicon.ico
cp /tmp/fav-32.png site/static/img/favicon-32.png
cp /tmp/fav-16.png site/static/img/favicon-16.png

# iOS needs an opaque background, or it composites onto black
magick /tmp/sq.png -resize 168x168 -background "#fbf7f0" -gravity center -extent 180x180 \
  site/static/img/apple-touch-icon.png

# header mark
magick $M -resize x72  site/static/img/logo-mark.png
magick $M -resize x144 site/static/img/logo-mark@2x.png
```

The social card (`og-image.png`, 1200×630) is composed with the logo and wordmark on the dark brand
background; the exact command is in the commit that introduced it.

## Recreating the transparent master

```bash
magick docs/design/<original>.png -alpha set -channel RGBA -fuzz 12% \
  -fill none -floodfill +0+0 white \
  -fill none -floodfill +1091+0 white \
  -fill none -floodfill +0+959 white \
  -fill none -floodfill +1091+959 white \
  -fill none -floodfill +146+571 white \
  /tmp/cut.png
magick /tmp/cut.png -trim +repage docs/design/fishtea-logo-transparent.png
```

`+146+571` is the inside of the cup handle. Always check the result over a dark background — that is where
a missed enclosed region shows up as a white blob.
