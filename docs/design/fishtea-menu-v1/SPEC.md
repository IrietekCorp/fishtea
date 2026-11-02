# Fishtea menu v1 — component spec

Status: **locked v1** (6 Oct 2026). Design source: the "Conversational navigation" canvas, row "Fishtea menu v1". The interactive prototype is `design/prototype.dc.html`.

## 1. What it is

The Fishtea menu is the app's **only top-level navigation**. It merges three things into one component:

1. **The mouth.** A prompt bar where anyone can type freely ("Ask").
2. **Rooms.** The top-level conversation shapes, shown as a short row of links (Browse, Buy, Track, Visit…). Rooms replace a traditional menu. Each one links to a room, page or shape.
3. **The trail.** The breadcrumb of the current conversation. It lives in a drawer that slides out from under the bar. Each turn is a pill, and hovering a pill shows a summary card. Clicking a pill rewinds the conversation to that turn.

The idea behind it: the conversation is the unit of navigation. The menu takes as little space as possible, so the focused conversation underneath gets the screen.

## 2. Anatomy

```
┌──────────────────────────────────────────────────────────────┐
│ ROOMS STRIP (muted)                                          │
│ ╭────────╮                                                   │
│ │✦ Ask   │   Browse   Buy   Track•   Visit                   │
├─┘        └───────────────────────────────────────────────────┤  ← Ask tab joins the field below (no line under it)
│ INPUT  "Ask anything — something linen for a summer wedding" │
│ [suggestion] [suggestion] [suggestion]          (only empty) │
│ ╭────────────╮                                               │
│ │ + Trail (4)│                              @   /   🎤  [↑]  │  ← TOOLS ROW
└──────────────────────────────────────────────────────────────┘
   when open, the trail toggle becomes a tab that runs into the drawer:
┌──────────────────────────────────────────────────────────────┐
│ │ × Close    │                              @   /   🎤  [↑]  │
├─┘            └───────────────────────────────────────────────┤  ← bar's bottom corners square off
│ DRAWER (muted, same colour as the tab and the rooms strip)   │
│ TRAIL                       hover for the turn · click to rewind
│ (≡ linen · wedding…) › (≡ warmer) › (▤ Ardmore shirt) › (◫ Ardmore or Harlow)●
│        ╭───────────────────────╮                             │
│        │ TURN 2 · BROWSE  2:16 │  ← floating summary card    │
│        │ “something warmer”    │     (hover / focus)         │
│        │ ▢ ▢ ▢                 │                             │
│        │ 7 pieces in rust…     │                             │
│        │ findProducts · list   ↺ Rewind here                 │
│        ╰───────────────────────╯                             │
└──────────────────────────────────────────────────────────────┘
```

| Part | Element | Notes |
|---|---|---|
| Root | `div.ft-menu` | `position: relative`. Holds the bar and the drawer. Width follows the page column (Fishtea: max 720–880px). |
| Bar | `form` | Raised surface (`pot`), 1px `line` hairline, radius 12, `shadow-low`. While the drawer is open: bottom radius 0 and no shadow. |
| Rooms strip | `nav[aria-label=Rooms]` | Muted background (`drawer`), top radius 11, hairline underneath. Items sit on the bottom edge. |
| Ask tab | `label[for=input]` | **Always first.** A tab: `pot` fill, hairline on top/left/right, no bottom border, overlaps the strip's hairline by 1px so it joins the input. 15px / 700. Gold sparkle icon on the left that pulses. `aria-current="page"`. |
| Room links | `a` | 17px / 600, `ink-2`, `ink` on hover. 48px tall. No icons. An optional notice dot (7px, gold) follows the label. 8px gap after the Ask tab, no divider. |
| Input | `input` | 18px / 28px (`body-lg`). Transparent, no border. Placeholder: `Ask anything — {suggestion}`, rotating. |
| Suggestions | `button` pills | Only while the input is empty. Up to 3. 32px tall, 13px, `ink-3`, hairline. A click **fills** the input and focuses it; it does not submit. |
| Tools row | `div` | Left: trail toggle. Right: `@` mention, `/` shape picker, mic, send. Icon buttons are 44×44. |
| Trail toggle | `button` | See §3.2. Closed: `+`, "Trail", count badge. Open: `×` (the `+` turned 135°), "Close", drawn as a tab. |
| Send | `button` | Three states: idle (`tan` fill, `ink-3` arrow); charged when there's text (`ink` fill, `ground` arrow); busy (stop square, calls `onStop`). |
| Drawer | `div#trail` | Absolutely positioned **under** the bar, full width, `top: 100%`. Muted background, hairline on left/right/bottom, bottom radius 12, `shadow-mid`. Overlays the page; it never pushes content down. |
| Pills | `ol > li > button` | One per turn, joined by `›` chevrons. 40px tall, radius pill, icon for the vessel + short label (ellipsis at 190px). |
| Summary card | `div[role=tooltip]` | 300px wide, floats 12px under its pill with a caret. `tan` fill, `shadow-mid` (deeper). |

## 3. Behaviour

### 3.1 Ask and rooms
- Ask is the free prompt and is always the first item. Clicking the Ask tab focuses the input (it is the input's `<label>`).
- Rooms come from `spec.json`: the top-level shape groups. They are ordinary links (`href`) to a room, page or shape entry. Wiring them is the app's job; the component just renders `rooms`.
- `notice: true` on a room shows the gold dot. Use it for an unread operator or system `Notice` in that room.

### 3.2 Trail toggle → tab
- **Closed:** transparent button with `+`, the label "Trail" and a count badge (`turns.length`). Disabled when there are no turns.
- **Opening (one motion):**
  - The `+` turns 135° into an `×` (spring, 420ms).
  - The button gets the drawer's background and a hairline on top/left/right.
  - It grows 9px taller and pulls 9px down (bar padding 8 + bar border 1), so it covers the bar's bottom hairline and runs straight into the drawer.
  - The bar's bottom corners go square and its shadow drops.
  - The drawer slides down from behind the bar: `translateY(-100%)` → `0`, spring, 460ms. Opacity fades in over 160ms.
- **Closing:** the reverse. The drawer slides back up in 260ms (standard ease), then `visibility: hidden`.
- **Closes on:** the toggle; `Esc` (focus goes back to the toggle); a pointer press outside the component; rewinding to a turn.
- ARIA: `aria-expanded`, `aria-controls` → drawer id, and `aria-label` "Open the trail" / "Close the trail".

### 3.3 Trail pills
- One pill per turn, oldest first.
- Icon by the answer's vessel: list (`List`), detail (`FileText`), compare (`Columns2`), card (`Square`), timeline (`Clock`), form (`SquarePen`), confirm (`CircleCheck`), ask (`MessageCircle`).
- **Current turn:** solid `ink` fill, `ground` text, weight 600, `aria-current="step"`.
- **Hovered or focused:** `tan` fill, `ink-3` border, `ink` text.
- **Rest:** `pot` fill, `line` border, `ink-2` text.
- **Hover or focus** shows that pill's summary card. Leaving or blurring hides it.
- **Click:**
  - On a past turn: calls `onRewind(turnId)` and closes the drawer.
  - On the current turn: nothing happens.
- **Touch devices** (`(hover: none)`): the first tap shows the card, the second tap rewinds.
- **Keyboard:** ←/→ move focus between pills; Home/End jump to the ends; Enter/Space activate.

### 3.4 Summary card
- **Content, top to bottom:**
  - `TURN n · ROOM` (key style) with the time on the right (mono).
  - The utterance in quotes (15px, `ink`).
  - A preview row: up to 4 colour swatches or image thumbnails, 40×40, radius 8.
  - The summary (14px, `ink-2`).
  - A hairline divider.
  - `shape · vessel` (mono), with "You are here" (current turn) or "↺ Rewind here" (`green-ink`) on the right.
- **Motion:** in: opacity 180ms plus a spring from `translateY(-6px) scale(.96)` (280ms). Out: 120ms.
- `role="tooltip"`; the pill points to it with `aria-describedby`.
- The card is informational only. It holds no buttons, so it can't trap focus.

### 3.5 Rotating placeholder and suggestions
- `suggestions` (strings) feed both the rotating placeholder and the chips.
- The placeholder advances every 3.2s **only while the input is empty and not focused**.
- The chips show the first 3 suggestions. They hide once the input has text.
- Suggestions should come from the classifier or spec (likely next shapes for this visitor). Static lists are fine to start.

### 3.6 Submitting
- Enter or the send button calls `onSubmit(text)` with trimmed, non-empty text, then clears the input.
- While `busy`, send becomes a stop button (`onStop`). The input stays editable.

### 3.7 Rewind semantics (decision)
- Rewinding **keeps newer turns** and starts a fork from the chosen turn. The trail is never destroyed.
- v1 shows only the active path as pills. Showing forks in the drawer (the tree from canvas frame 3) is a v2 item.
- The component doesn't own this. It reports `onRewind(turnId)`, and the app re-renders with a new `turns` / `currentTurnId`.

## 4. Data contract

See `reference/types.ts`.

```ts
interface Room { id: string; label: string; href: string; notice?: boolean }

interface Turn {
  id: string;
  index: number;          // 1-based position on the active path
  roomId: string;         // matches a Room.id, shown in the card
  utterance: string;      // what the visitor said
  short: string;          // pill label, ~3–5 words
  summary: string;        // one line describing the answer
  shape: string;          // e.g. "findProducts"
  vessel: Vessel;         // 'list' | 'card' | 'detail' | 'compare' | 'form' | 'timeline' | 'confirm' | 'ask'
  at: string | Date;      // when it was answered
  preview?: { kind: 'swatches'; colors: string[] } | { kind: 'images'; items: { src: string; alt: string }[] };
}
```

Every field comes from what Fishtea already records per turn: the utterance, the shape and args from needle3, the vessel the planner picked, and the provenance. `short` and `summary` can be templated per shape in `spec.json` (e.g. `findProducts` → "{count} pieces, ${min} to ${max}").

## 5. Tokens

All colours are CSS variables from the Fishtea design system (`reference/tokens.css`). Ebony (dark) is the default; Oak (light) is under `[data-theme="oak"]`.

| Token | Ebony | Oak | Used for |
|---|---|---|---|
| `--ft-ground` | #14100c | #efe6d6 | page, current pill text |
| `--ft-pot` | #1e1813 | #f9f4ea | bar, Ask tab, resting pills |
| `--ft-drawer` *(new)* | #18130f | #f3ecdf | rooms strip, open toggle tab, drawer |
| `--ft-tan` | #2b2119 | #e4d6bf | summary card, hovered pill, idle send |
| `--ft-line` | #3d3128 | #cdbea6 | all hairlines |
| `--ft-ink` / `-2` / `-3` | #f1e8d8 / #c9bca6 / #978a76 | #1c1510 / #4f4335 / #6b5f50 | text |
| `--ft-gold` | #f0c808 | #f0c808 | Ask sparkle, notice dot |
| `--ft-green-ink` | #7cd494 | #146c30 | "Rewind here" |
| `--ft-focus` | #f0c808 | #188038 | 2px focus ring, offset 2px |

`--ft-drawer` is new: it sits between `ground` and `pot` and marks "belongs to the bar, but secondary". Add it to the design system.

**Type:** Manrope 400/600/700; JetBrains Mono for meta lines.

**Motion:**
- `--ft-spring: cubic-bezier(.34,1.3,.64,1)` (new): toggle icon, drawer, card.
- `--ft-pour: cubic-bezier(.16,1,.3,1)`.
- `--ft-quick: 150ms ease`.
- **Sparkle pulse:** 2.2s ease-in-out, infinite. Scale .94→1.12, opacity .8→1, gold glow from 0 to 6px.
- **Reduced motion:** no pulse, and transitions shortened to ~0.

## 6. Icons

[Lucide](https://lucide.dev) via `lucide-react`. It is ISC-licensed, needs no attribution, and is shadcn/ui's default set. Iconify serves the same icons as `lucide:*` if you prefer Iconify. 1.5–1.75px strokes, 14–18px.

The icons used: `Sparkles` (Ask), `Plus` (toggle), `AtSign`, `SquareSlash`, `Mic`, `ArrowUp`, `Square` (stop), `ChevronRight` (separator), `RotateCcw` (rewind), and the vessel icons above.

> The design system currently says "no icon set". This component deliberately adopts Lucide; update the README rule.

## 7. Accessibility checklist
- Real elements throughout: `label`, `a`, `input`, `button`, `ol`. No clickable divs.
- Every icon-only button has an `aria-label`.
- Focus ring: `outline: 2px solid var(--ft-focus); outline-offset: 2px` on every interactive element.
- Contrast: all text ≥ 4.5:1 on its surface in both themes. `ink-3` is never placed on `tan`, so the card uses `ink-2` for its meta.
- **Notice dot:** visually it is colour only, but it carries `aria-label="new"` / visually hidden text.
- The drawer is `visibility: hidden` when closed, so it's out of the tab order and the accessibility tree.
- `prefers-reduced-motion` is honoured.
- Every touch target is ≥ 44px, except the suggestion chips (32px tall). They are secondary and spaced 6px apart; raise them to 44 on coarse pointers (done in the CSS).

## 8. Responsive
- **Below 640px:**
  - The rooms strip scrolls horizontally (no wrap); the Ask tab stays pinned on the left.
  - Room links drop to 16px.
  - Pills wrap.
  - The summary card is clamped to the viewport (`max-width: calc(100vw - 32px)`) and opens left-aligned to the drawer, not the pill.
- On phones, consider docking the whole menu to the bottom of the screen (canvas frame 6). That is a v2 decision; v1 is top-docked.

## 9. Acceptance criteria
1. Ask is first, is a tab joined to the input, and clicking it focuses the input. The sparkle pulses (and doesn't when reduced motion is set).
2. Room links render from `rooms` at 17px/600, with no icons or divider, and show the notice dot when `notice`.
3. The placeholder reads "Ask anything — …" and rotates only while empty and unfocused. The chips fill the input without submitting.
4. Send: idle → charged with text → stop while `busy`. Enter submits trimmed text and clears the input.
5. The toggle shows `+ Trail n`. Opening turns `+` into `×` with a spring. The toggle becomes a tab with no seam into the drawer, and the bar squares its bottom corners.
6. The drawer overlays content and doesn't shift layout. It closes on toggle, Esc (focus back on the toggle), an outside press, and rewind.
7. The current pill is solid ink. Hover or focus on any pill shows its card with the spring motion. Arrow keys move between pills.
8. Clicking a past pill calls `onRewind(id)` once and closes the drawer. Clicking the current pill does nothing. On touch, the first tap previews and the second rewinds.
9. Ebony and Oak both render using only the token variables, with no hard-coded colours in component styles.
10. No layout shift at 375px, 768px or 1280px. The rooms strip scrolls on narrow screens.

## 10. Out of scope for v1 (next)
- Showing forks or branches in the drawer (canvas frame 3).
- Bottom-docked mobile layout (frame 6).
- The `@` mention and `/` shape pickers. v1 only exposes `onMention` / `onPickShape` callbacks. Canvas frame 1 has the `/` menu design: shapes grouped by room, each tagged with its vessel.
- Gold appears twice (sparkle + notice dot), against the design-system rule of one gold per screen. Decide whether the notice dot moves to `broth` (amber).
