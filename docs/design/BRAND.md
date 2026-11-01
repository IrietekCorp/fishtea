Fishtea is a web framework: describe a business once in `spec.json`, derive everything else. The backend is **solid ground**; the interface is **water** that takes the shape of whatever question is being asked. The identity is deep slate and cool ivory, with one mint accent and one amber signal held back for meaning. Three rules: **ground first, colour last**; **hairlines, no shadow at rest**; **seven vessels, never a page**.

## Voice and content

- Plain, calm, second person. "What do you need?" not "Enter your query". "A few more details and I can answer that." not "Required fields missing."
- The product's own words, lowercase in running text: **spec**, **shape**, **call**, **vessel**, **pour**, **trail**, **utterance**, **envelope**, **persona**, **echo**.
- Sentence case. No exclamation marks. No emoji; the cup mark is the only illustration, and it appears as an icon rather than as a drawing.
- Name the thing that answered. Every answer ends with its provenance in `mono-small`: *`placeOrder` answered · read vendor, dish · wrote order · 1:10 PM*. A write is never silent — *wrote* is set in `broth-ink`.
- Errors come from the ground and say so in its words, in `danger`, inside the form that lets you reshape the question.
- Tagline: *solid ground, liquid UI*. Headline: *Describe a business once. Derive everything else.*
- Money is in US dollars in every example, and the catalogue examples are priced in whole dollars.

## Color

- **Slate** is the primary theme: `ground` near-black with a blue cast, `pot` one step up, `tan` one more. **Daylight** is the light theme, cool paper rather than warm. Every token has both; Slate is listed first.
- Surfaces stack by shade, not by line: ground → pot → tan, each edged with a 1px `line` hairline. **Nothing floats at rest** — `shadow-low` resolves to nothing, and `shadow-mid` is reserved for hover and for the moment a vessel pours.
- Text: `ink`, `ink-2`, `ink-3`. All three clear 4.5:1 on ground, pot **and** tan in both themes — `ink-3` on `tan` measures 4.60:1 on Slate and 4.74:1 on Daylight, which is the one thing the old warm ramp could not do.
- **Green** (a mint, `#2fb894` / `#0a7357`) is the accent for what is settled and what is primary: the one filled button on a screen, the confidence dot at high, done steps, the active nav bar (`accent-bar`), links in `green-ink`, *read* in provenance. Two green things on one screen is one too many.
- **Gold** (amber) is rarer still — the moment: the notice badge, the confidence dot at mid, *Shaping…* in `gold-ink`. Fill only on Daylight, where it is never text. If it appears twice on a screen, remove one.
- **Broth** is money and consequence: price badges; `broth-ink` for prices as text and for *wrote*. It is a warmer orange than gold, so the two never read as the same signal.
- **Focus** is the accent in both themes: a 2px ring in a colour that appears nowhere else on a focused control.
- **Wood** and `wood-2` are the band: the hero plank and any one panel that steps out of the page. They are surfaces, not text. The names survive the walnut they replaced; the values are now a shade of the ground, which is why the band needs no per-theme substitution.
- No gradients. No translucent overlays over content. No coloured left borders on cards — the `accent-bar` is for a selected row only.

## Type

- Two faces from one family tree. **Inter Tight** 600 for `display-xl`, `display-lg` and the vessel `title`, cut tight (−0.035em at display size); **Inter** 400/500/600 for text. Hosted on Google Fonts.
- `body-lg` for the mouth, `body` inside vessels, `small` for row subtext and chips, `key` uppercase 600 at 0.12em in `ink-3` above facts — wider tracking than the text it labels, because it is a label and not a word.
- `JetBrains Mono` for `mono` (CLI, spec) and `mono-small` (the verify strip, the understood line, the meta line).

## Layout and shape

- One column, max 720px; `space-4` gutters on phones; `space-5` between the mouth, the understood line, the vessel, the verify strip and the chips. Marketing pages widen to 1140px.
- Radii are tight: `radius-sm` 4px for badges and fields, `radius-md` 6px for vessels and buttons, `radius-lg` 10px for marketing panels, `radius-pill` for chips.
- Depth: `hairline` in `line` on everything raised, and nothing else at rest. `shadow-mid` on hover and while pouring. Buttons press by darkening 6%, not by moving.
- Focus: `outline: 2px solid var(--focus); outline-offset: 2px`.
- Motion: the vessel *pours* on `pour` timing — opacity, an 8px rise, a 1.5% scale-in. The mouth's caret blinks. Chips and buttons transition colour on `quick`. Nothing else moves. Honour `prefers-reduced-motion`.

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

- No icon set. The confidence dot, the check in `Confirm`, timeline dots and the caret are CSS or inline SVG in token colours, 1.5px strokes.
- The wordmark is flat type, `wordmark-dark.svg` on Slate and `wordmark-light.svg` on Daylight: "fish" in `ink`, "tea" in the accent, no outline. **It is the whole brand lockup in a header bar** — the cup does not accompany it there.
- The cup mark (`logo-mark.png`, and the master in `fishtea-logo-transparent.png`) is the favicon, the app icon and the social card: sizes at which it reads as a mark. It is not a hero illustration and not a header mark, because at 28px a drawing is neither legible nor abstract. Never recolour it; never place it on the accent.
- A marketing page demonstrates the product rather than illustrating it: the hero carries a **console** — a visitor's words, the understood line, a vessel that poured and the chips that follow — in the product's own tokens.
- Product imagery sits at `radius-sm` with a `hairline` edge.
