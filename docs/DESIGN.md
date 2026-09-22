# Fishtea — what the build measured and changed

This file records where the implementation deviates from `BLUEPRINT.md`, and why. Every deviation is backed by a measurement taken during the build on 2026-09-21 (Linux x86-64, CPU only, `cactus-needle 3.0.4`).

## Phase 0 findings (classifier)

| Blueprint | Measured | What changed |
|---|---|---|
| Embedding dim 768 | `Needle.embed()` returns **3072** floats | `halfvec(3072)` + HNSW everywhere (pgvector's `vector` index caps at 2000 dims). `FISHTEA_EMBED_DIM` overrides. |
| classify p50 ≤ 30 ms / p95 ≤ 60 ms | 130–270 ms per `complete()` (prefill ~800 tok/s, decode ~330 tok/s), +10 ms embed; first call on a new tool subset +300 ms (`needle_init`) | `rules.classify.budgetMs` defaults to **1000** in the samples; `packages/bench/budgets.json` re-baselines §11. Past budget the pour is `ask`, as designed. |
| Stateless calls | needle **carries conversation state** across `complete()` calls | The pool `reset()`s before every request. |
| Context = last *k* turns summarised | Summaries ("visitor: … → findAccessories (8 results)") confused the model (it copied the prior shape) and lengthened prefill | Context is (a) recalled turns from other trails, when they resonate, and (b) for anaphoric utterances only ("the second one", "again"), the last answer's items by id and name. Listing items works: "add the second one" → `addToCart(productId=p_chrome_studs)`. |
| `/embed` may be missing | Present on generation 3 | Same pool serves classify + embed; no sentence-transformer. |
| One pool, any worker | Switching a worker between tool subsets costs a `needle_init` of **0.7–1.2 s** with doc-rich tool JSON (`bind` in the pool timings) vs 125–310 ms for the classification itself; one abandoned slow request queued behind the next caused a timeout cascade | Each worker holds one persona subset: the dispatcher assigns unassigned workers first, then least-recently-used, and prefers the worker already on the subset; requests whose client deadline passed are skipped. `NEEDLE_WORKERS` must be ≥ the number of distinct persona subsets (3 for both samples; Compose default 3). |

Full contract: `packages/classifier/contract.md`.

## Design decisions made during the build

- **Application directory** is the unit, not a single `spec.json`: `spec.json` + `calls/` (SQL and compute modules the spec names) + `seed/` + `rules/` + `scripts/`.
- **Archetypes, not samples.** The blueprint's D13 samples (Chic du Jour, AI Explorer Camp) were used as *problem spaces* to design the onboarding, not shipped as templates. `templates/` holds generic archetypes — ecommerce (with vendor feed adapters: mock, CSV, eBay, HTTP), portfolio (dynamic interview), verification (consent → attestation → minimal disclosure), program, blank — each with an `onboard.json` interview whose answers patch spec paths, enum vocabularies, seed rows or template-specific consequences (affiliate-only removes the cart shapes and the mid-purchase persona). Both D13 checks still hold: every archetype derives, migrates, seeds and runs its walkthrough on the same engine (`templates.test.ts`).
- **Generated applications** carry their own `docker-compose.yml` (framework image built from `FISHTEA_HOME`, app dir mounted at `/app`) and a `fishtea.ts` shim that runs the framework CLI, so `bun run tui | dev | up` work with nothing to install. Bun's `link:` needs a registered name and `file:` copies the tree without its dependencies, so neither was usable for a local framework checkout.
- **`known` is what the visit brought.** `identity.cookie` is read from the trail's envelope (captured when the trail opened), not from the per-request token, otherwise every second request would be "known". A new trail opens after `rules.trail.sessionGapHours` (default 4) and is seeded with the previous head, so the return-visit homepage is the resumed conversation.
- **The gate.** When a stranger says "check out", `checkout` is not in their toolset, so the classifier returns nothing. The engine then scores the hidden shapes lexically (a routing heuristic, not classification; the model never saw the shape) and pours a `form` for the greeting's first offered write shape the persona *can* use (`becomeKnown`), with a hint. Only greeting offers can be gates.
- **Compound results**: the top call runs; the rest become `next[]` chips (blueprint §8). No general composer.
- **Recall re-classify**: classification returns the embedding; recall runs after it; when the first pass was weak (no calls, below floor, or required args missing) and something resonates, the engine classifies once more with the recalled turns as context. Worst case is two budgets.
- **Reserved identifiers**: DDL, migrations and seeding quote every identifier (`business."order"`, `"order"`), so entity/field names like `order` work.
- **jsonb parameters** are passed as JS values; postgres.js encodes them (pre-stringifying double-encodes).
- **Operator shapes** with engine-side plans: `op.unmetReport`, `op.notify`. `op.editSection` and `op.restart` are handled by the serve process (file patch + reload; process exit for Compose to restart).

## Bench (packages/bench, 2026-09-21, this machine)

`bun run bench -- --conventional` against `fishtea serve` with a warmed 3-worker needle pool, 20 iterations × 10 steps (`packages/bench/baseline.json`):

| metric | p50 | p95 | budget |
|---|---|---|---|
| classify (core → pool → core) | 246 ms | 384 ms | 350 / 700 |
| plan + calls, single-step read | 3 ms | 5 ms | 40 |
| POST /utter, single-step text | 157 ms | 305 ms | 800 |
| POST /utter, bridgeStyles (two-step) | 395 ms | 401 ms | 900 |
| POST /utter, structured (chip/form/confirm) | 12 ms | 16 ms | 60 |
| GET / resume | 6 ms | 12 ms | 100 |

100/100 text utterances answered (the bench counts pour kinds so a fast `ask` cannot pass as a fast answer). The whole scripted task (10 requests, 32 KB of JSON) takes 1.3 s p50; the classifier is ~90 % of it. The conventional baseline as scripted (24 requests, 467 KB) measures server time only — no browser parse or render — so it is not yet the task-completion comparison the blueprint asks for; a Playwright run of `bench/conventional` is the remaining step. Warm-up matters: a cold worker switching subsets costs 0.7–3.7 s depending on machine load, and the first bench run after a reload showed every text utterance timing out until the pool had settled; `/reload` now warms in the background, one worker at a time.

## The operator console is Ink, not a prompt library

The blueprint suggested "@clack/prompts for flows and ink if a persistent screen is wanted". The first build
used clack and was unusable: **under Bun, `node:readline` echoes every keystroke**, so typing `hello` rendered
`hheelllloo` and the prompt resolved `undefined`. Measured with a pty harness (`packages/tui/test/pty-drive.py`):
`process.stdin.setRawMode(true)` works correctly under Bun on its own, and Ink — which reads stdin directly and
never touches readline — takes the same keystrokes cleanly. So the console is [Ink](https://github.com/vadimdemedes/ink)
(React for terminals, the same mental model as `packages/ui`), rendered as a persistent screen in the terminal's
alternate buffer.

What that bought, beyond correct typing:

- A standing frame: service dots for core, classifier and database refreshing every five seconds, and a spec
  version in the header, so the operator always knows what they are pointed at.
- Five screens on number keys — Dashboard, Spec, Conversations, Run, Onboard — instead of a prompt tree that has
  to be re-walked from the top after every action.
- Conversations reads the trail store directly, so visitors, their turns and the unmet channel are visible with
  the core offline.
- `$EDITOR` and `docker compose logs` suspend the console (leave the alternate buffer, drop raw mode) and restore
  it afterwards.

Two bugs the pty harness caught that a human would have hit immediately, both now covered by tests: a form
control kept its state across questions because React reused the component (fixed with a per-question `key`), and
a stray LF from the terminal landed inside a single-line field (fixed by filtering control characters).

**A global shortcut may not be a character a field could want.** Text controls take a key lock while mounted, so
typing `q4q4` into a field does not quit or switch screens; and `tab` is deliberately not a global, because the
Conversations screen uses it for its own tabs.

## Nothing assumes localhost

The first build hard-coded `localhost` for Postgres and the classifier and let `Bun.serve` pick its own
binding, so a fresh application only worked if every service happened to be on the same machine, and a missing
database surfaced as `connect ECONNREFUSED 127.0.0.1:5432` from inside postgres.js.

Now every address resolves flag → environment → default in `packages/cli/src/env.ts`, the core binds `0.0.0.0`
so it answers on every address of its host, and start-up prints the URLs other machines should dial along with
where the database and classifier actually are. `FISHTEA_PUBLIC_HOST` (detected from the LAN when unset) is
what the browser UI is told to call, so Compose no longer hands the UI a `localhost` that means the container.
A missing database now raises a `SetupError` that names the target and lists the ways to fix it; a missing
classifier is only a warning, because the core still runs and pours `ask`. `fishtea doctor` reports all four.

## An application is its own project

`fishtea new` used to resolve its target against the current directory, so running it inside the framework
checkout nested the application in fishtea's own git history. The target is now `--dir`, else
`--workspace`/`FISHTEA_WORKSPACE`, else the current directory — and a directory inside the framework is refused
outright with the three ways out. The default id is `myapp`. The console asks where the directory should go.

## What a clean `docker compose up` needed

Bringing a freshly generated application up from nothing found four bugs that no unit test would have caught,
all now fixed and, where testable, covered:

- **The compose file did not parse.** `${FISHTEA_HOME:-/path}` inside a YAML flow mapping closes the mapping
  early, and `env_file: [ path: .env, required: false ]` is not valid YAML. Both compose files are block style
  now, which is also what someone editing a generated file wants to read. A test parses both.
- **The core container ran Vite.** `Dockerfile.core` has two stages and the `core` service set no `target:`,
  so Docker built the *last* stage. Stages are named `base`, `core`, `ui`, and both services name their target.
- **PostgreSQL 18 refuses a mount at `/var/lib/postgresql/data`** — it keeps data in a major-version
  subdirectory so `pg_upgrade --link` can work, and wants the volume one level up at `/var/lib/postgresql`.
- **Three classifier workers raced to download the same weights** and the service never became healthy. The
  ~70 MB engine and weights are baked into the image at build time, so a container starts offline and every
  worker loads from local disk. The `models` volume remains, for a fine-tuned `.cact` via `NEEDLE_MODEL_PATH`.

Running the stack also showed the ecommerce archetype's search was too literal. needle drops a whole phrase
into `text` and invents a `category` the catalog does not have ("linen" is a tag here, not a category), and the
query returned nothing. It now matches text word by word, and treats `category`, `brand` and `tag` as hard
filters **only when the catalog actually contains that value** — otherwise the guess becomes one more search
word. Price stays a hard filter, because a budget is a promise. Against the live stack, six representative
utterances all answer, including the two the classifier got partly wrong.

## Postgres version

The blueprint pins `pgvector/pgvector:pg16`. The stack runs **`pgvector/pgvector:pg18`** (PostgreSQL 18.6 at the time of writing); the suite passes on it unchanged. PostgreSQL 19 was still in beta (`postgres:19beta3`) and pgvector had no pg19 image, so 18 is the newest GA option. An existing `pgdata` volume created by pg16 cannot be started by pg18: dump and restore, or `docker compose down -v` for a throwaway stack.

## Known unknowns still open

1. Per-keystroke classification load at scale: measured single-stream only. The pool is CPU-bound; `NEEDLE_WORKERS` ≈ cores/2 is a guess.
2. Familiarity threshold 0.82: untuned. The needle test asserts a recall happens, not that it is well-calibrated.
3. Small-model quirks: bare verbs ("check out") return low confidence or a hallucinated argument; "my email is …" as a customer maps to whichever visible shape has an email field. Persona filtering and the confidence floor absorb most of it; `triggers` and input `doc` strings help. Fine-tuning needle on the spec's own utterances is the next lever (needle supports LoRA).
4. Playwright + axe walkthrough of the UI is written as a manual checklist in `packages/ui/e2e/README.md`; no browser was available in the build environment.
