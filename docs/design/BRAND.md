Fishtea is a web framework: describe a business once in `spec.json`, derive everything else. The backend is **solid ground**; the interface is **water** that takes the shape of whatever question is being asked. The identity is dark wood and warm ivory, with the green and gold of the logo held back as accents. Three rules: **earth first, colour last**; **hairlines and one low shadow, never outlines**; **seven vessels, never a page**.

## Voice and content

- Plain, calm, second person. "What do you need?" not "Enter your query". "A few more details and I can answer that." not "Required fields missing."
- The product's own words, lowercase in running text: **spec**, **shape**, **call**, **vessel**, **pour**, **trail**, **utterance**, **envelope**, **persona**.
- Sentence case. No exclamation marks. No emoji; the cup mark is the only illustration.
- Name the thing that answered. Every answer ends with its provenance in `mono-small`: *`placeOrder` answered · read vendor, dish · wrote order · 1:10 PM*. A write is never silent — *wrote* is set in `broth-ink`.
- Errors come from the ground and say so in its words, in `danger`, inside the form that lets you reshape the question.
- Tagline: *solid ground, liquid UI*. Headline: *Describe a business once. Derive everything else.*

## Color

- **Ebony** is the primary theme: `ground` near-black walnut, `pot` one shade up, `tan` one more. **Oak** is the light theme, sanded and warm. Every token has both; Ebony is listed first.
- Surfaces stack by shade, not by line: ground → pot → tan, each edged with a 1px `line` hairline and lifted with `shadow-low`. Never a 2px outline, never a hard shadow.
- Text: `ink` (ivory on Ebony), `ink-2`, `ink-3` (not on `tan`). All ≥ 4.5:1 on their grounds in both themes.
- **Green** is the accent for what is settled and what is primary: the one filled button on a screen, the confidence dot at high, done steps, the active nav bar (`accent-bar`), links in `green-ink`, *read* in provenance. Two green things on one screen is one too many.
- **Gold** is rarer still — the moment: focus ring on Ebony, the notice badge, the confidence dot at mid, *Shaping…* in `gold-ink`. Fill only. If gold appears twice on a screen, remove one.
- **Amber** (`broth`) is money and consequence: price badges; `broth-ink` for prices as text and for *wrote*.
- **Wood** and `wood-2` are the marketing accents: hero bands, the header, the cover. They are surfaces, not text.
- No gradients. No translucent overlays over content. No coloured left borders on cards — the `accent-bar` is for a selected row only.

## Type

- One family. **Manrope** 700 with −0.02em tracking for `display-xl`, `display-lg` and the vessel `title`; Manrope 400/600 for text. Hosted on Google Fonts.
- `body-lg` for the mouth, `body` inside vessels, `small` for row subtext and chips, `key` uppercase 600 at 0.08em in `ink-3` above facts.
- `JetBrains Mono` for `mono` (CLI, spec) and `mono-small` (the verify strip, the meta line).

## Layout and shape

- One column, max 720px; `space-4` gutters on phones; `space-5` between the mouth, the understood line, the vessel, the verify strip and the chips. Marketing pages widen to 1120px on a 12-column grid.
- Radii: `radius-sm` badges and fields, `radius-md` vessels and buttons, `radius-lg` marketing panels, `radius-pill` chips.
- Depth: `hairline` in `line` on everything raised, `shadow-low` at rest, `shadow-mid` on hover and while pouring. Buttons press by darkening 6%, not by moving.
- Focus: `outline: 2px solid var(--focus); outline-offset: 2px`.
- Motion: the vessel *pours* on `pour` timing — opacity, an 8px rise, a 1.5% scale-in. Chips and buttons transition colour on `quick`. Nothing else moves. Honour `prefers-reduced-motion`.

## The vessels

The interface is a fixed vocabulary of containers; the answer's shape picks one, deterministically. Consumers render vessels and nothing else.

| Vessel | When | Component |
|---|---|---|
| ask | the shape isn't known | `Ask` |
| form | the shape is known, the question isn't finished (or a write needs confirming) | `Form` |
| list | many records | `List` |
| card | one small record | `Card` |
| detail | one record with children | `Detail` |
| compare | two things side by side | `Compare` |
| timeline | ordered events | `Timeline` |
| confirm | something happened | `Confirm` |

Around every vessel: `Mouth` above, `Understood` between, `VerifyStrip` below, `Chip`s last. A `Notice` is a turn authored by the system or the operator and sits above the vessel.

## Iconography and imagery

- No icon set. The confidence dot, the check in `Confirm`, timeline dots and the steam are CSS or inline SVG in token colours, 1.5px strokes.
- The wordmark is flat type, `assets/Logos/fishtea-wordmark-A-dark.svg` on Ebony and wood, `-A-light.svg` on Oak: "fish" in `ink`, "tea" in `green`, no outline. It is the header brand at 28–36px and the hero at up to 120px. The cup mark (`fishtea-cup-mark.png`) is the app icon, the favicon and the hero illustration. Never recolour either; never place them on green or gold.
- Product imagery sits at `radius-sm` with a `hairline` edge.
