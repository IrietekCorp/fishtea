# FishTea — the work list

Read `CLAUDE.md` first (commands, layout, rules of the house), then `docs/DESIGN.md` (measured deviations
from `docs/BLUEPRINT.md`). This file is what is left.

Updated 2026-10-21, at **1.7.1** (the classifier pool answers one at a time, on a worker bound to the persona); 1.7.0 (tiles, a working rewind, social links, /admin → Data, view `forms`, a hero's contact line); before that, 1.6.0, after the work ChicDuJour needed — the layout
language (`rules.present`), the `sections` shell, operator sign-in at `/admin`, the breadcrumb, streamed
parts and per-call budgets.

## State

- **1.7.1.** 316 tests, 308 passing, 8 skipped, 0 failing; the pool's own 8 tests pass. With
  `budgetMs` 1000 and up to 4 visitors at once, 0 of 20 classifies missed (p50 0.19 / 0.53 / 0.72 s at 1 / 3 / 4).
- **1.7.0.** 316 tests, 308 passing, 8 skipped, 0 failing across 22 files (`bun test packages scripts site`);
  `tsc` clean; the menu's 14 browser tests pass. Schema changes are additive again (`rules.site.social`, an
  entity's `admin`, a molecule's `quotes`, a hero's `contact`), so an application pinned `^1.6.0` runs under it.
- **1.6.0.** 312 tests passing, 8 skipped, 0 failing across 22 files (`bun test packages scripts site`),
  on PostgreSQL 18.6 / pgvector 0.8.6; `tsc` clean on both projects; 32 headless browser tests pass. The
  8 skips are the needle suite, which wants a pool on 8082 (`FISHTEA_TEST_CLASSIFIER_URL`) that nothing
  starts for you. The spec *format* stays at 1.1: everything 1.6 added to the schema is additive, so a
  spec written for 1.5 loads unchanged and an application pinned `^1.5.0` runs under it (verified).
- **fishtea.io is live** on Firebase Hosting with a Google Trust Services certificate. See
  `docs/DEPLOY.md`. Redeploy is `bun run deploy`. The site is built from the design system's tokens
  (`docs/design/tokens.json` → `static/tokens.generated.css`); `site.css` hand-writes no colour and a
  test fails on any hex literal in it.
- **The site publishes no way to install.** While the beta is closed there is no `/install` and no
  `/releases` — absent, not unlinked — and every route in is the application form on `/beta`. One
  variable reopens it: `PUBLISH_INSTALL=1 bun run deploy`.

### Picking up after a restart

Nothing in the repository needs restoring — the working tree is committed and the site is deployed. Three
things live outside it:

```bash
# the test database does NOT come back on its own (restart policy is "no")
docker start fishtea-test-db

# optional: the docs site, locally, on :4000
bun run site --serve
```

`gcloud` credentials and the Playwright browser survive a reboot; nothing needs re-authenticating. The
scratch applications used during testing lived in a temp directory and are disposable — `bun run e2e`
builds its own from scratch each run.

**One thing left hanging:** a report that fishtea.io shows "not secure" in a browser. Every server-side
check disagrees — `curl` verifies, OpenSSL shows a complete chain (`Verify return code: 0`) including the
GlobalSign cross-sign, Chrome here reports `isSecureContext: true`, there is no mixed content, and HSTS is
set. The likely cause is a cached interstitial from the window earlier in the day when the certificate had
genuinely not issued yet. Confirm in a private window before chasing anything server-side.
- **Verified end to end during the platform work:** scaffolding, plugins and `validate` all work from the
  compiled binary with no checkout on disk; 1.1.0 and 1.2.0 install side by side and switch both
  directions; an application pinned `^1.2.0` running under 1.1.0 is told which side is stale; the
  three-way file reconcile handles all six cases (update, yours, conflict, new, deleted, resolved).
- **Bench** (warm pool, 20 iterations): every budget green, 100/100 text utterances answered.
  `packages/bench/baseline.json`.
- **Still not verified:** the eBay adapter against the live API — and it will not be, see §3; a real
  screen reader (axe and keyboard-only are covered, see §0); the `anthropic` plugin against the live API
  (it is unit-tested for resolution, merge and a clear error without credentials, not for a real
  completion).

## Work list, in priority order

### 0. ~~Accessibility~~ — done
`packages/ui/e2e/a11y.e2e.ts`, nine tests, run by `bun run e2e` alongside the walkthrough. axe
(wcag2a/aa, wcag21a/aa) scans each vessel in the state that produces it — greeting, list, detail, form,
confirm dialog, timeline — and four keyboard tests cover a whole turn with no pointer, the confirm
dialog's focus trap and Escape, tab stops that are all visible, and one polite live region that is not
empty after a pour. **18/18 green, and no product defect found**: focus management, the trap, the
announcements and the field names were all already right.

Two things worth keeping:

- **The one failure was mine, not the UI's.** Scanning straight after a pour reported 53 contrast
  violations at `#918d89`/3.15:1 — a colour in no stylesheet, because `.pour-enter` fades opacity 0 → 1
  over 220ms and axe composites whatever it finds mid-animation. `muted-foreground` is `#68625e`, a
  comfortable 5.9:1. `scan()` now waits for `document.getAnimations()` to settle, which is also the
  state a reader actually reads.
- **The suite was mutation-tested**, because nine tests green on the first run deserve suspicion:
  washing out `--muted-foreground` produces `color-contrast`, stripping `aria-label` off the buttons
  produces `button-name`, and unmodified is clean.

Not covered: a real screen reader, and `prefers-reduced-motion` as a rendering mode rather than a
respected setting.

### 1. ~~Click through the web UI~~ — done
Walked steps 1–8 of `packages/ui/e2e/README.md` against a live stack. Seven real defects found and fixed,
three of them proven by new unit tests rather than by eye:

- **A product card never showed its price.** `RecordCard` took the first six fields in *object key order*,
  so a shopper saw `vendorId`, `sourceId` and a raw jsonb blob, and `price` — the tenth key — never made
  the cut. Fields are ranked now (`fieldScore`/`rankFields` in `fields.tsx`), by name and value shape, so
  the framework's own bookkeeping sorts to the bottom for any entity without anyone enumerating columns.
- **`unflatten()` dropped every nested value.** react-hook-form treats a dot in a field name as a *path*,
  so `register("shipTo.line1")` yields `{shipTo:{line1}}`; `unflatten` read `values["shipTo.line1"]`, got
  undefined, and skipped it. Checkout submitted an address containing only its country default. Pinned by
  a test that asserts both the flat and nested shapes.
- **The checkout form ate its own fields.** Sub-fields were rendered from whatever keys the server echoed
  back, and the server drops empty values — so submitting without a city returned a form with no city
  input, and it could never be supplied. An address now always offers its full set of lines.
- **A required field said so only in decoration.** `register(..., {required})` is RHF validation and sets
  no DOM attribute, so there was no `aria-required`; and RHF's own errors were never rendered, so
  submitting an incomplete form did nothing at all and never said why. Both fixed.
- **Nested labels were raw keys** ("Ship To · line1" → "Ship To · Line 1").
- **SSE never came back.** EventSource retries a dropped connection itself but gives up once the stream is
  CLOSED — which is what a core restart causes — leaving the tab permanently deaf. Now reconnects with
  capped backoff; verified by killing the core under a live page and notifying after it returned.
- **Four pre-existing type errors in `timeline.tsx`**, invisible because `packages/ui` was excluded from
  typechecking. `unknown && <JSX>` is also a render footgun: a field that happened to be `0` would render
  a literal "0". `bun run typecheck` now covers both projects.

Verified working, unchanged: the list/card/detail/confirm/timeline vessels, the confirm-write dialog and
its focus trap, persona transitions (stranger → customer → mid-purchase, evaluated at request start so the
badge moves on the *next* turn), trail rewind and branching, resume-on-reload, and operator notifications
over SSE.

The walkthrough is now **headless and automated**: `bun run e2e` scaffolds a throwaway application, brings
up a stack, and runs nine Playwright tests against a clean browser profile in about ten seconds. It skips
with a reason (exit 0) where there is no browser or database, so it is safe in CI. It immediately earned
its keep by catching a tenth bug the manual pass could not prove — react-hook-form submits a *hybrid* of
flat default keys and nested live values, and reading the flat key first let a stale empty default shadow
everything the visitor had typed.

**Not covered** at the time: accessibility — since done, see §0 above.

### 1b. Prefill what the visitor already told us (half a day)
The acceptance checklist says "knowns pre-filled", and they are not: a customer who has just given their
email still types it again at checkout. `known` on a form pour is the *classified args* (`formPour` in
`packages/core/src/pour.ts`), not anything the identity knows. Making identity facts flow into a form's
`known` is an engine decision about which facts are safe to surface and when — left alone deliberately
rather than guessed at.

### 2. Publish (half a day, whenever you want it public)
Everything up to publishing is built and verified; publishing itself was deliberately left to you.

- `bun run release <v>` → `bun test packages site scripts` → commit → `git tag v<v>`.
- `bun publish` per package. `workspace:*` is rewritten to a concrete version in the packed manifest
  (verified), so npm clients resolve correctly. Packages ship TypeScript source, which is correct for a
  Bun-only framework but means node consumers are not supported — decide whether to say so in the
  manifests.
- `bun run build-release --target ... --tarball` per platform, then host `dist/` and a `latest` file at
  `FISHTEA_RELEASES`. `fishtea upgrade` and `install.sh` both already speak that layout and both fail
  with a clear message and the `--from` fallback until it exists.
- The site is `bun run site` → `site/dist`, static, and serves `install` from its root so
  `curl fishtea.io/install | bash` is one file to host.

### 3. Connectors — reframed
**This used to say "vendor feeds for real": make the eBay adapter work against the live API. That is no
longer the plan.** See `docs/CONNECTORS.md` for the position; the short version is that FishTea carries
the *seam* and connectors that name no vendor, while a connector to a specific marketplace is built in
the product that needs it — where there are credentials, live traffic, and somebody who notices the
morning the response shape changes — and comes back as a plugin if it is worth sharing.

FishTea cannot honestly test an eBay client. Writing one here produces an unverified API client wearing
the framework's name, which is worse than not having one.

**a. Let a vendor adapter be a plugin** (half a day) — the one real blocker, and small.
`templates/ecommerce/calls/inventory_pull.ts` dispatches with
`ctx.resolve("calls/adapters/" + v.adapter + ".ts")`, which only looks inside the application. A
plugin's adapter is unreachable, so "promote it back as a plugin" is advice the framework cannot yet
honour for this one kind of connector. Make the dispatcher consult the application's plugins first, then
fall back to `calls/` — the same precedence everything else uses.

**b. Decide what happens to `ebay.ts`** (an hour). It is 32 lines of unverified OAuth and query-string
assembly in an archetype, carrying its own "verify field names before relying on it". Either delete it
and let `csv`/`http` be the shipped answer, or move it under a clearly-marked `examples/` that the
scaffolder does not copy. Deleting is the cleaner story and loses nothing that was ever verified.

**c. General connectors, which do belong here.** Judged by one question: would every archetype want
this, or only a shop?
- **email relay** — a `channel` plugin. The socket now exists (§6); no relay is written.
- **analytics** — there is no seam at all, and it is the interesting one. Page views are not the events
  that matter here; a shape classified, a pour delivered, a write confirmed and an utterance nobody
  could answer are, and the last is already collected in the `unmet` view. Wants an `analytics` plugin
  kind with a `record(event)` the engine calls after each turn, carrying the same facts the verify strip
  already shows the visitor.
- **payments**, **object storage** — not started.

**d. Still worth doing regardless of who writes the connectors:**
- Scheduled sync: `rules.inventory.syncEveryHours` is declared and unread. Simplest: a `setInterval` in
  `packages/cli/src/serve.ts` running `engine.operate("op.syncInventory", {})` when the spec has that
  shape, enqueuing the `inventory.synced` notification.
- UI: products with `affiliateUrl` and `stock = 0` need a "buy at vendor" treatment.
  `packages/ui/src/fields.tsx` treats fields by name; add one for `affiliateUrl`.

### 3b. Shapes within shapes — a proposal to measure
`docs/NESTED-SHAPES.md`. Top-level shapes as *areas* of a business — `vendor`, inventory browse, product
details, secure a purchase, reports — each a boundary owning its classification vocabulary, its guard,
its calls and its UI composition, with subjects (get information) and verbs (commit, react, schedule)
inside it. Server-driven UI, except the components are composed per turn rather than named by a tree.

Much of it already exists unnamed: `allow` is the guard, `next` is the stitching drawn one hop at a
time, and `personaSubsets` is already scoped classification keyed by persona rather than by area.

**Addresses: `docs/ADDRESSES.md`, and it can ship without the nesting.** Top-level shapes are also
addresses — `/browse`, `/purchase`, `/orders` — for SEO, bookmarking and
linking. That is not a retreat from "no pages": the essay's objection is to the URL as *memory*, and the
blueprint already said "the shape names *are* the routes". An area URL carries the area and nothing
else — no filters, no step, no trail id — so two people opening the same link get the same place and
different conversations, which is the thesis rather than a compromise of it. The page is an entrance,
not a corridor.

The cost is real and it is rendering, not metadata: `packages/ui` is a Vite SPA, the core serves JSON
only, and a crawler gets an empty div today. The seam is clean — `GET /` already produces the pour a
page needs, so the work is an area in the path and content negotiation — but server rendering is a
capability the framework does not have at all. Worth doing **before** nested shapes, because it can be
prototyped against the flat shape list and because a site nobody can find is a problem now.

Also note that areas alone are thin SEO: four or five pages. What ranks for a shop is
`/product/<slug>`, thousands of them. Addressable entities are derivable from the spec — as are
`sitemap.xml`, schema.org structured data and Open Graph — but that is a larger change than area URLs
and should be judged separately.

**The timeline question has an answer that costs nothing to start.** A point in a conversation is a
*question*, not a stored state, so a marker names the shape and its typed arguments and the point
reconstitutes itself by re-asking. The URL says *where* (an area, maybe a question); the browser history
entry says *when* (`history.pushState` state, which is per-entry, never copied with the link, and
therefore the right place for a turn id). Push on area boundaries, replace within one — so back means
"the previous place" and returning to an area returns you to the depth you left it at. `POST
/trail/rewind` already exists and branches correctly; what is missing is binding it to `popstate`.

Which points are addressable is **derived**: `effect: "read"` and `allow` includes `stranger`. Run
against the ecommerce spec unmodified that yields exactly `findProducts`, `relatedProducts`,
`compareProducts` and `trending` — the cart and orders excluded because they are persona-guarded, the
writes excluded because they are writes. Nobody annotated anything.

**Steps 1 and 2 of that doc are days and need no decisions**, and step 1 (client-side `pushState` +
`popstate` → rewind) makes back and forward correct today regardless of whether any of the rest happens.

**The nesting itself is not a decision yet, and the first two steps are measurements, not code.** Area-sized tool
subsets should classify faster and better; they also multiply the pool's subsets, and `contract.md`
measured a subset switch at 0.7–1.2 s and a worker at ~160 MB, with ecommerce on 3 subsets today. Four
areas × three personas is twelve. `packages/bench` can answer whether the gain pays for that before
anything is built. The composite pour is the expensive change and the one that brushes against "seven
vessels, never a page".

### 3c. Authentication — one thing fixed, several open
`docs/ACCESS.md`. The **authorisation** model is sound and in the right place: the gate is after
classification, on the converged path, so a shape posted directly as a chip is checked exactly like a
shape the classifier chose. Needle needs no controls and must never be trusted with any — the chip path
does not go through it, its input is attacker-controlled text, and since §6 it can be third-party code.
Five tests now assert that invariant from different directions (`core.test.ts`, "the gate").

**Authentication is the weak part.** `visitorOf` accepts the visitor id from a header or a cookie and
whoever presents one becomes that visitor, so the id is a bearer credential. It was minted from
`Date.now()` plus six characters of `Math.random()` — a public half and a predictable half. **Fixed**:
96 bits from the platform CSPRNG, existing ids unaffected.

Still open, in rough priority order:
- The credential is **unsigned**, so a forged id is rejected only by missing the table, and a stolen one
  cannot be revoked. An HMAC with a server secret fixes both.
- **Identifier and credential are the same string**, and it appears in `/op/visitors` and in logs.
- The SPA keeps it in `localStorage`, so `httpOnly` on the cookie buys nothing against XSS. Deliberate
  for a cross-origin SPA, but it should be a decision: same-site cookie plus a CSRF token is the
  alternative.
- ~~Operator auth is one shared token~~ — **done**: sign-in at `/admin`, argon2id, hashed session
  cookies, a forced first-password change, lockout. `FISHTEA_OPERATOR_TOKEN` is now the script door
  only. The rate limiter is still per process (see below).

### 3d. Generative UI, and the encoding to borrow
`docs/GENERATIVE-UI.md` — a read of Vercel's [json-render](https://json-render.dev/), the closest public
thing to the part of FishTea that turns an answer into an interface.

The divergence is total and in our favour: their model composes the layout and a catalogue constrains
it; our model never picks a vessel at all, because the answer's shape does. And their spec is frozen
after generation — as documented, an action's only effect is `setState`, so nothing an interaction does
can change *what the interface is*. A frozen tree has no way to say no. Our `ask`, the gate,
`confirm-write` and the unmet channel are the disagreement machinery they have no concept of, and those
four are worth naming as one idea.

Three things they are ahead on, all worth taking:

- **`{root, elements}` — a flat, id-addressed map instead of a nested tree.** An element can be sent,
  replaced or patched without its ancestors. This is a **prerequisite** for composite pours rather than
  a refinement, and it should be decided before §3b rather than after.
- **Progressive streaming render.** We pour whole, at the end. The encoding above is what makes partial
  meaningful.
- **An action log** in the operator console — the trail already holds the data; it is a screen.

Three to refuse: the model composing layout, a frozen spec with accumulating client state (a second,
worse trail), and `$cond`/`$template`/`$computed` — a programming language in JSON, and a rule the model
wrote, which the house rules forbid outright. Also their code export: freezing a derived UI is a fork
with extra steps, and the whole argument of `fishtea update` is that derived things move.

**All four are built.**

**The concrete borrowings, in dependency order** (designs in the doc):

1. ~~**`CompositePour { root, parts }`**~~ — **done.** — a flat id→part map where a `Part.of` is an *existing* pour, so
   all seven vessels keep their contracts and overrides compose for free. Additive: one new member of
   the `Pour` union, every `switch` gains a case and keeps its others. The big one — the union is
   load-bearing across `packages/ui`, the TUI, headless, bench and e2e — and it should be decided
   **before** §3b, because a composite is what an area pours.
2. ~~**Streamed parts**~~ — **done.** `{type:"part"}` and `{type:"settled"}` over the existing SSE, and
   only for a visitor who is actually connected — everything else plans the composite whole, because you
   cannot stream to something that is not listening. The stored turn is updated when the last part lands
   (`trails.settle`), so a resume shows what was on screen rather than the lead alone.
3. ~~**A chip that fires itself**~~ — **done.** `Chip.on = { field }`. Their watcher mutates client state; ours takes
   a turn, so it is gated, planned, provenanced and on the trail. A day, independent.
4. ~~**An action log**~~ — **done.** `/op/actions` and an `actions` tab in the console — every turn including the refusals. `Provenance` is
   already the right record; this is a query and a screen. A day, independent.

Two bugs came out of making the browser test pass, both of which only a real browser could have shown.
A part planned against a local database lands *milliseconds* after the response that owns it and can
beat React's state update, so an early part is buffered and drained when its turn arrives. And folding a
part in was not idempotent — React invokes a state updater twice under StrictMode, so a two-part
composite rendered three verify strips.

### 4. Small correctness items (hours each)
- `FISHTEA_PUBLIC_HOST` is detected from the first non-internal IPv4; several NICs or NAT needs it set by
  hand. There is no TLS story: the core speaks HTTP and expects something in front of it.
- The console's Spec screen can add a shape but not an entity or a call; both are the same wizard shape
  (`packages/tui/src/screens/spec.tsx`, the `addShape` mode).
- `packages/cli/src/serve.ts` watches `spec.json` only; edits to `calls/*.sql|ts` need a restart. Watch
  `calls/` too and re-run `engine.reload`. Now also worth watching an application's `plugins/`.
- Verification archetype has no verifier persona (the DB enforces who may attest, so it is safe). To give
  verifiers a greeting: an `identity.tags`/`roles` lookup in `Engine.identity()` fed from a column on the
  customer entity, then `verifier: { when: "identity.roles has 'verifier'" }` — the persona expression
  language (`packages/core/src/persona.ts`) needs a `has` operator for arrays.
- `packages/core/src/http.ts` rate limiter is in-memory per process; fine for one core, note it if you
  scale out.
- **The familiarity threshold (0.82) is measurably meaningless, and should be re-derived.** Chasing the
  failing recall test turned up two separate things.

  The test failure was latency, not recall. Every turn of the walkthrough's second trail was timing out
  at the shipped 400 ms budget — a persona-subset switch alone costs 0.7–1.2 s — and a timed-out
  classify returns no embedding, so nothing was stored and recall had nothing to find. Confirmed in the
  database: six embedded turns, all in the first trail, none in the second. The fixture now runs at a
  raised budget, because the test is about whether recall is *correct*, not whether the machine is fast;
  latency belongs to `packages/bench`. **The needle suite is 6/6 green.**

  **The mechanism is the real problem, not the number.** Measured across 18 same-topic and 135
  different-topic pairs from real utterances, needle3's short-utterance embeddings barely discriminate
  at all — the two distributions sit on top of each other:

  | | median | p90 | max |
  |---|---|---|---|
  | same topic | 0.939 | 0.956 | 0.988 |
  | **different topic** | **0.937** | 0.952 | 0.985 |

  The best separating threshold is 0.928, which keeps 89% of same-topic pairs and admits **70%** of
  unrelated ones. There is no good number. Mean-centring the vectors (the standard fix for embedding
  anisotropy — everything shares one large common direction) helps materially, from 89%/75% to 72%/41%,
  and is still not good enough to act on.

  So the default moved from 0.82 — which admitted **100%** of unrelated utterances, meaning recall fired
  on every weak turn and fed the classifier irrelevant prior turns as context — to **0.96**, where it
  fires rarely rather than constantly. That is damage control, not a fix. Familiarity needs a different
  signal: shape overlap, argument overlap, or an embedding produced for the purpose. Recorded here with
  the measurements so the next person does not re-tune a dial that has nothing behind it.

  A sample of pairs, for the flavour of it:

  | pair | cosine |
  |---|---|
  | "something bold for a wedding under 60" ~ "something bold for a wedding, again" | 0.988 |
  | "something bold for a wedding under 60" ~ "quiet and polished for the office" | 0.942 |
  | "something bold for a wedding under 60" ~ **"what's the weather"** | 0.938 |
  | "show my cart" ~ "check out" | 0.907 |

  An utterance about the weather resonates with one about a wedding at 0.938. That is the whole finding.

### 5. Bench honesty (half a day)
`packages/bench/src/conventional.ts` measures server time for the multi-page baseline, not browser task
completion. Script it with Playwright so the blueprint's "faster than conventional" claim is measured the
way it is stated.

### 6. ~~Plugin system, second pass~~ — mostly done
Three of the four sockets now exist. A plugin kind that resolves, merges, lists — and is then read by
nothing — was the failure this pass removed, because it surfaces as "why is this not working" weeks
later rather than as an error.

- **`classifier` plugins are read.** `classifierFor` prefers one when the application has one; two
  enabled at once is a `SetupError`, because silently picking a brain is not a thing to do. A plugin's
  classifier is wrapped in `withBudget`, which the shipped ones do not need — it is somebody else's code
  on the request path, and "every classify call has a hard budget" is a rule of the house, not a request
  to the author. Overrun and throw both become the `ask` the engine already knows how to pour.
- **`channel` plugins are read.** `Engine.notify` hands a notification to every channel when the visitor
  is **not** connected; a connected one has already been told over SSE and sending again would be the
  same notification twice. Channels get the rendered text, the chips, and `to: { email, customerId }`
  from the same lookup the persona rules use. A channel that throws is absorbed — the notification is
  queued either way, so it is still there on their next visit, exactly as before there were channels.
- **Vessel overrides are wired.** `fishtea ui-assets` now writes `plugins.generated.ts` beside the
  stylesheet: a registry of vessel name → component, which `container.tsx` consults with a fallback to
  the built-in. Verified through a real `vite build` that an absolute path into a plugin outside the UI
  root resolves and lands in the bundle — the one assumption in this that was worth proving.
- **Still no `auth` consumer**, and deliberately. The other three are wiring: a seam existed and needed
  a socket. "How a visitor becomes known" is not — it is the engine's identity model, the persona
  expressions that read it, and `becomeKnown` in every archetype. Wiring it as a module without deciding
  what an authenticated visitor *is* would produce exactly the half-thing this pass just removed. It is
  the same shape of open question as §1b.
- **An interactive `plugin add`.** The config questions use the same vocabulary as `onboard.json`, so the
  TUI's interview component should be able to ask them directly instead of `--set`.
- Plugin dependencies on other plugins, if that ever proves necessary. It has not yet.

Two things fell out of this that are worth knowing:

- **A fresh clone could not build the UI.** `index.css` imports `plugins.generated.css` and now
  `container.tsx` imports `plugins.generated.ts`; both are git-ignored and written by `fishtea
  ui-assets`, so `bun run typecheck` and `vite build` failed on a missing import until someone happened
  to run a command that created them. `scripts/ui-assets-base.ts` writes the empty versions when they
  are absent and runs in front of typecheck, `vite dev` and `vite build`.
- **A seam scaffold is a working seam.** `fishtea plugin create x classifier` writes a module that runs
  and answers `ask`; the channel one refuses an unaddressable visitor and logs otherwise. Both are
  asserted by loading the scaffold and calling it, so the templates cannot rot into something that does
  not compile.

### 7. Later
- ~~Operator auth beyond `FISHTEA_OPERATOR_TOKEN`~~ — done, see §3c.
- Offline notification delivery (email) — see the `channel` note above.
- needle LoRA fine-tune per archetype on its own utterances (`cactus-needle` supports it;
  `contract.md` lists the bare-verb quirks it would fix).

## Things that will bite you

- Tests reset the `business`, `conversation` and `fishtea` schemas. They default to port **5434**; never
  point `FISHTEA_TEST_DATABASE_URL` at a stack you care about.
- The needle test must run alone, with the pool up and warmed (`GET /healthz` → `warming: false`), and
  it wants a pool **on 8082** — `FISHTEA_TEST_CLASSIFIER_URL`, defaulting to a port nothing real uses,
  exactly as the database has `FISHTEA_TEST_DATABASE_URL` and 5434. It used to default to 8081, and
  because it calls `pool.reload()` a plain `bun test` while any stack was up would silently swap that
  application's tool set for the ecommerce archetype's until the container was restarted. It skips when
  nothing answers, so the default is now "does nothing" rather than "breaks whatever is running".
- The classifier pool: switching a worker between persona tool subsets costs ~1 s (up to 3.7 s under
  load); `NEEDLE_WORKERS` ≥ distinct persona subsets (3 for the shipped archetypes). Reload/warm are
  sequential on purpose (parallel inits thrashed to 48 s).
- jsonb parameters are passed as JS values; pre-stringifying double-encodes.
- All DDL identifiers are quoted; a field named `order` works, and SQL in `calls/` must quote it too
  (`f."order"`).
- The lexical classifier is a dev harness. If a walkthrough step misroutes under lexical but not under
  needle, adjust the script or the shape's `triggers`, not the engine.
- A `pgdata` volume created by pg16 will not start under pg18 (`fishtea down -v` for throwaway stacks).
- `bun build --compile` folds a *conditional* dynamic import into the bundle and evaluates it eagerly.
  That is why `packages/tui/src/devtools-stub.ts` exists and is aliased in `tsconfig.json`; if the binary
  ever dies at startup on a missing package, this is the shape of the problem.
- **A release is also a docker build context, and staging forgot it.** `fishtea up` runs compose with
  the release directory as the context, and `Dockerfile.core` copies `package.json`, `bun.lock`,
  `tsconfig.json` and `packages/` before `bun install --frozen-lockfile`. The staged release had none of
  the first three and only two of the seven workspace packages, so an installed `fishtea up` died on
  `"/tsconfig.json": not found` — and would have failed on the missing members next, because an install
  resolves the whole workspace and one absent package.json fails it. All of `packages/` is ~730 KB
  beside an 83 MB binary; there was never anything to optimise. `scripts/release.test.ts` parses the
  Dockerfiles' COPY lines and fails on anything RUNTIME_FILES does not cover.
- **The compiled binary has no source tree, and the console used to forget that.** `@fishtea/cli`
  imports `@fishtea/tui`, so the console cannot import the CLI back without a cycle; it dodged that with
  ``await import(`${fishteaHome}/packages/cli/src/new.ts`)``, which works in a checkout and can never
  work in a release. `fishtea new … --interactive` and the console's Onboard screen both died on a
  missing module. The fix is the `Scaffolder` seam (`packages/tui/src/lib/scaffolder.ts`): the CLI passes
  `listTemplates` and `scaffold` in. `selfCommand()` is the same problem for subprocesses — a compiled
  binary re-runs `process.execPath`, a checkout runs `bun …/index.ts`. `packages/tui/test/seams.test.ts`
  fails on any new templated dynamic import, because this class is invisible until someone installs.
- The compiled binary has no source tree, so `frameworkHome()` falls back to `<exe>/../..` and then
  `~/.fishtea/current`, accepting only a directory that has `templates/`. A release therefore must ship
  `templates/`, `plugins/` and `packages/ui` beside the binary — `scripts/build-release.ts` does.
