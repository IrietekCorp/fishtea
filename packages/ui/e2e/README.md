# UI walkthrough (Phase 6 acceptance)

No browser was available in the build environment, so the Playwright + axe-core run is a checklist here and a
spec in `walkthrough.spec.ts` to run when one is (`bunx playwright install chromium && bunx playwright test`).

Start the stack (`bun run up` in an app, or `bun run dev --app templates/ecommerce` + `cd packages/ui && bun run dev`) and walk:

1. **Stranger → find.** Open http://localhost:5173. The greeting `ask` shows the hint and three chips. Type "something bold for a wedding under 60" — after 250 ms the `list` vessel paints (cards, since products carry `imageUrl`). The understood line reads "Accessories that feel bold under $60 · NN% sure". The verify strip shows `products.search`, `read business.product`, N records.
2. **Outfit.** Click "Build an outfit around …" — a `detail` vessel: the seed card and a nested list "Completes".
3. **Known.** Click "Save your email…" — a `form`; submit → the `AlertDialog` (focus trapped; Esc cancels) → Confirm → `confirm` vessel; the persona badge flips to `customer`; the verify strip shows **wrote business.customer** in accent.
4. **Cart.** "add p_pearl_drop to my cart" → `confirm-write` → Confirm → `card` vessel (cart with lines); persona `mid-purchase`; next chips include "Check out".
5. **Checkout.** "check out" → `form` (email + shipTo fields expanded); submit → dialog → Confirm → `confirm` vessel with the order summary and a "Track order" chip.
6. **Timeline.** Click "Track order …" → `timeline` vessel.
7. **Trail.** Open "trail · N", rewind to the cart turn (↶), type "something playful for a festival" — the new turn branches; GET / (reload the page) resumes on the branch.
8. **Notification.** In another terminal: `bun fishtea notify <visitorId> "Your order shipped early"` (FISHTEA_OPERATOR_TOKEN set) — a toast and an inline notice appear without reload.
9. **Screen reader.** With VoiceOver/NVDA: each submitted pour announces its phrase once (aria-live polite); per-keystroke re-pours do not announce unless the vessel kind or shape changes; the form moves focus to the first empty required field.
10. **axe.** Run axe DevTools on each vessel: zero serious violations expected (all interactive elements are buttons/inputs with labels; colour never carries meaning alone: the confidence dot has "NN% sure" text; writes are bold *and* coloured).
11. **Themes.** Toggle `prefers-color-scheme`; tokens redefine; `prefers-reduced-motion` disables the pour transition.
