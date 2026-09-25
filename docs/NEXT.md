# FishTea — the work list

Read `CLAUDE.md` first (commands, layout, rules of the house), then `docs/DESIGN.md` (measured deviations
from `docs/BLUEPRINT.md`). This file is what is left.

Updated 2026-09-22, after the platform work (versioning, plugins, the binary, the site) and the launch of
fishtea.io.

## State

- **1.1.0.** 202 tests, 0 failing, on PostgreSQL 18.6 / pgvector 0.8.6; `tsc` clean on both projects; the
  UI builds; the site builds; the compiled binary runs standalone; 9 headless browser tests pass.
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

- `bun run release <v>` → `bun test packages` → commit → `git tag v<v>`.
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
- Familiarity threshold `rules.familiarity.threshold` (0.82) is untuned; the needle test only asserts a
  recall happens.

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
- Operator auth beyond `FISHTEA_OPERATOR_TOKEN`.
- Offline notification delivery (email) — see the `channel` note above.
- needle LoRA fine-tune per archetype on its own utterances (`cactus-needle` supports it;
  `contract.md` lists the bare-verb quirks it would fix).

## Things that will bite you

- Tests reset the `business`, `conversation` and `fishtea` schemas. They default to port **5434**; never
  point `FISHTEA_TEST_DATABASE_URL` at a stack you care about.
- The needle test must run alone, with the pool up and warmed (`GET /healthz` → `warming: false`).
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
- The compiled binary has no source tree, so `frameworkHome()` falls back to `<exe>/../..` and then
  `~/.fishtea/current`, accepting only a directory that has `templates/`. A release therefore must ship
  `templates/`, `plugins/` and `packages/ui` beside the binary — `scripts/build-release.ts` does.
