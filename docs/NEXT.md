# Fishtea — where the initial buildout stopped

Written 2026-09-21 at the hand-off from the design/build session. Read `CLAUDE.md` first (commands, layout, rules of the house), then `docs/DESIGN.md` (measured deviations from `docs/BLUEPRINT.md`). This file is the work list.

## State at hand-off

- Commits: `2ff0d03` framework, `b40d957` PostgreSQL 18, `1d66877` README, `52f72da` this file, then the Ink operator console.
- Verified: 50 tests (`spec`, `core`, `http`, `program`, all five templates) on PostgreSQL 18.6 / pgvector 0.8.6; the needle Phase 4 test (6) against a local pool; `tsc` clean; `bun run build` for the UI; scaffolding from answer files for ecommerce (affiliate-only) and portfolio, then running them headless.
- Bench (warm pool, 20 iterations): every budget green, 100/100 text utterances answered. `packages/bench/baseline.json`.
- Not verified: the React UI clicked in a browser (its HTTP traffic is verified, including CORS from a LAN origin); the eBay adapter against the live API.
- The operator console was rebuilt on Ink after @clack/prompts proved unusable under Bun (see docs/DESIGN.md). Eight pty-driven tests cover rendering, navigation, typing, the key lock, the interview and spec writes.

## Work list, in priority order

### 1. Click through the web UI (half a day)
`packages/ui/e2e/README.md` is the checklist; `walkthrough.playwright.ts` is a Playwright spec (`bunx playwright install chromium`, needs `@playwright/test` and `@axe-core/playwright` added to `packages/ui`). Start `bun run dev --app templates/ecommerce` and `cd packages/ui && bun run dev`. Expect problems in: the form vessel's nested `shipTo` fields and enum selects (`src/vessels/form.tsx`), the timeline vessel with the verification template's mixed events, and the SSE reconnect (`src/lib/client.ts` never retries).

### 2. ~~Bring the Compose stack up from clean~~ — done
`bun run up` in a freshly generated application brings up db, classifier, core and ui; all four healthy, the
core answers over the LAN address, needle3 classifies at ~200 ms, and the UI serves. Four bugs found and fixed
along the way (YAML flow mapping, missing build target, PG18 mount point, racing model downloads) — see
docs/DESIGN.md. Remaining: nobody has clicked the UI in a browser (item 1).

### 3. Vendor feeds for real (one day)
- `templates/ecommerce/calls/adapters/ebay.ts`: run with `EBAY_APP_ID`/`EBAY_CERT_ID` (sandbox first: `EBAY_SANDBOX=1`); fix field names.
- Scheduled sync: `rules.inventory.syncEveryHours` is declared and unread. Simplest: a `setInterval` in `packages/cli/src/serve.ts` that runs `engine.operate("op.syncInventory", {})` when the spec has that shape, and enqueues the `inventory.synced` operator notification.
- UI: products with `affiliateUrl` and `stock = 0` need a "buy at vendor" treatment. `packages/ui/src/fields.tsx` treats fields by name; add one for `affiliateUrl` and let the list/card vessels show it as the primary action.

### 4. Small correctness items (hours each)
- `FISHTEA_PUBLIC_HOST` is detected from the first non-internal IPv4 address; a machine with several NICs or behind NAT needs it set by hand. There is no TLS story: the core speaks HTTP and expects something in front of it (blueprint §12.7).
- The console's Spec screen can add a shape but not an entity or a call; both are the same wizard shape (`packages/tui/src/screens/spec.tsx`, the `addShape` mode).
- `packages/tui/src/screens/run.tsx` shells out to `bun <cli> headless|bench` by path; if the CLI grows a `--json` streaming mode, show it in a pane instead of suspending.
- `packages/cli/src/serve.ts` watches `spec.json` only; edits to `calls/*.sql|ts` need a restart. Watch the `calls/` dir too and re-run `engine.reload`.
- Verification archetype has no verifier persona (the DB enforces who may attest, so it is safe). To give verifiers their own greeting: add an `identity.tags`/`roles` lookup in `Engine.identity()` (`packages/core/src/engine.ts`) fed from a column on the customer entity, then `verifier: { when: "identity.roles has 'verifier'" }` — the persona expression language (`packages/core/src/persona.ts`) needs a `has` operator for arrays.
- `packages/core/src/http.ts` rate limiter is in-memory per process; fine for one core, note it if you scale out.
- Familiarity threshold `rules.familiarity.threshold` (0.82) is untuned; the needle test only asserts a recall happens.

### 5. Bench honesty (half a day)
`packages/bench/src/conventional.ts` measures server time for the multi-page baseline, not browser task completion. Script it with Playwright (page loads, parse, render) so the blueprint's "faster than conventional" claim is measured the way it is stated.

### 6. Later
- Operator auth beyond `FISHTEA_OPERATOR_TOKEN`.
- Offline notification delivery (email) as a `notifications.*.channel` extension plus one call.
- needle LoRA fine-tune per archetype on its own utterances (`cactus-needle` supports it; `contract.md` lists the bare-verb quirks it would fix).
- The blueprint's `reference/` spike never existed in this checkout; nothing depends on it.

## Things that will bite you

- Tests reset the `business`, `conversation` and `fishtea` schemas. They default to port **5434**; never point `FISHTEA_TEST_DATABASE_URL` at a stack you care about.
- The needle test must run alone, with the pool up, and after the pool has warmed (`GET /healthz` → `warming: false`). It pins one worker per persona subset before running.
- The classifier pool: switching a worker between persona tool subsets costs ~1 s (up to 3.7 s under load); `NEEDLE_WORKERS` ≥ distinct persona subsets (3 for the shipped archetypes). Reload/warm are sequential on purpose (parallel inits thrashed to 48 s).
- jsonb parameters are passed as JS values; pre-stringifying double-encodes (postgres.js encodes them).
- All DDL identifiers are quoted; a field named `order` works, and SQL in `calls/` must quote it too (`f."order"`).
- The lexical classifier is a dev harness. If a walkthrough step misroutes under lexical but not under needle, adjust the script or the shape's `triggers`, not the engine.
- A `pgdata` volume created by pg16 will not start under pg18 (`docker compose down -v` for throwaway stacks).
