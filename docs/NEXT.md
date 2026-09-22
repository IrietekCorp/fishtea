# FishTea — the work list

Read `CLAUDE.md` first (commands, layout, rules of the house), then `docs/DESIGN.md` (measured deviations
from `docs/BLUEPRINT.md`). This file is what is left.

Updated 2026-09-22, after the platform work (versioning, plugins, the binary, the site).

## State

- **1.1.0.** 178 tests, 0 failing, on PostgreSQL 18.6 / pgvector 0.8.6; `tsc` clean; the UI builds; the
  site builds; the compiled binary runs standalone.
- **Verified end to end during the platform work:** scaffolding, plugins and `validate` all work from the
  compiled binary with no checkout on disk; 1.1.0 and 1.2.0 install side by side and switch both
  directions; an application pinned `^1.2.0` running under 1.1.0 is told which side is stale; the
  three-way file reconcile handles all six cases (update, yours, conflict, new, deleted, resolved).
- **Bench** (warm pool, 20 iterations): every budget green, 100/100 text utterances answered.
  `packages/bench/baseline.json`.
- **Still not verified:** the eBay adapter against the live API; accessibility (axe, screen reader); the
  `anthropic` plugin against the live API (it is unit-tested for resolution, merge and a clear error
  without credentials, not for a real completion).

## Work list, in priority order

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

**Not covered**: accessibility. `@axe-core/playwright` is installed and unused — an axe pass per vessel,
plus keyboard-only navigation and focus order, is the obvious next step.

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
  `curl fishtea.dev/install | bash` is one file to host.

### 3. Vendor feeds for real (one day)
- `templates/ecommerce/calls/adapters/ebay.ts`: run with `EBAY_APP_ID`/`EBAY_CERT_ID` (sandbox first:
  `EBAY_SANDBOX=1`); fix field names.
- Scheduled sync: `rules.inventory.syncEveryHours` is declared and unread. Simplest: a `setInterval` in
  `packages/cli/src/serve.ts` running `engine.operate("op.syncInventory", {})` when the spec has that
  shape, enqueuing the `inventory.synced` notification.
- UI: products with `affiliateUrl` and `stock = 0` need a "buy at vendor" treatment.
  `packages/ui/src/fields.tsx` treats fields by name; add one for `affiliateUrl`.

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

### 6. Plugin system, second pass
The mechanism is done and tested; these are the parts that were scoped out deliberately.

- **Vessel overrides.** A `ui` plugin can declare `vessels`, and `plugin info` reports them, but only
  `tokens` is wired into the browser bundle. Overriding a vessel needs a generated registry module that
  `container.tsx` consults with a fallback.
- **`auth`, `classifier` and `channel` plugins** have a manifest kind, resolution and merge, but no
  framework-side consumer yet: nothing reads a `classifier` plugin to build a `Classifier`, and
  `notifications.*.channel` still has no delivery extension point. Each is a small, separate piece of
  wiring — the seam exists, the socket does not.
- **An interactive `plugin add`.** The config questions use the same vocabulary as `onboard.json`, so the
  TUI's interview component should be able to ask them directly instead of `--set`.
- Plugin dependencies on other plugins, if that ever proves necessary. It has not yet.

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
