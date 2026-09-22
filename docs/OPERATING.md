# Running it

Nothing assumes localhost. The core binds `0.0.0.0` by default, so a fresh application answers on every
address of the machine it runs on, and the start-up banner prints the addresses other machines should
dial.

## Addresses

| setting | flag | what it is |
|---|---|---|
| `FISHTEA_HOST` | `--host` | what the core binds. `0.0.0.0` (default) accepts any address; `127.0.0.1` keeps it local |
| `PORT` | `--port` | the core's port |
| `FISHTEA_PUBLIC_HOST` | `--public-host` | the address others dial. Detected from the LAN when unset; used for printed URLs and the UI's `VITE_CORE_URL` |
| `FISHTEA_CORS_ORIGINS` | `--cors` | browser origins allowed to call the core. Unset means any port on an address the core answers on, which covers the UI. Comma separated, or `*` |
| `DATABASE_URL` | `--db` | Postgres, wherever it lives |
| `CLASSIFIER_URL` | `--classifier` | the needle pool, wherever it lives |

Detection is a heuristic: a machine with several NICs, or one behind NAT, needs `FISHTEA_PUBLIC_HOST` set
by hand. There is no TLS story — the core speaks HTTP and expects something in front of it.

## CORS

The origin is reflected, not starred: a credentialed request may not be answered with a wildcard, and
reflecting *anything* would let any site make credentialed calls. So only origins on a hostname this core
answers on are echoed back, which covers the UI on another port of the same machine with no
configuration. `FISHTEA_CORS_ORIGINS` names others explicitly.

## The stack

```bash
fishtea up              # build and start db + classifier + core + ui
fishtea up --detach
fishtea ps
fishtea logs core
fishtea stop            # pause; start resumes it untouched
fishtea down            # stop and remove; the data volume is kept
fishtea down -v         # also delete the data
```

## The classifier pool

Production is the needle3 pool. The lexical classifier is a development harness and the benchmark
baseline, never production.

Each worker holds **one persona tool subset**, because switching a worker between subsets costs a
`needle_init` of 0.7–1.2 s against 125–310 ms for the classification itself. So `NEEDLE_WORKERS` must be
at least the number of distinct persona subsets — three for every shipped archetype, which is the Compose
default.

Every classify call has a hard budget (`rules.classify.budgetMs`). Past it the pour is `ask` — never a
dumber brain.

Warm-up matters: a cold worker switching subsets costs 0.7–3.7 s depending on load. `/reload` warms in the
background, one worker at a time, deliberately sequential — parallel inits thrashed to 48 s.

## Database

Postgres 18 with pgvector. Embeddings are `halfvec(3072)` with HNSW indexes, because needle's `embed()`
returns 3072 floats and pgvector's `vector` index caps at 2000 dimensions. `FISHTEA_EMBED_DIM` overrides.

```bash
fishtea migrate                       # additive
fishtea migrate --allow-destructive   # also drop what left the spec
fishtea seed
```

Migration is additive by default and refuses destructive changes unless asked. A `pgdata` volume created
by an older major version will not start under 18 — dump and restore, or `fishtea down -v` for a
throwaway stack.

## Health and benchmarks

```bash
fishtea doctor
fishtea bench                  # against a running core
fishtea bench -- --conventional
```

`packages/bench/budgets.json` holds the budgets; `baseline.json` holds the last recorded run. The
conventional multi-page baseline currently measures **server time only** — no browser parse or render —
so it is not yet the task-completion comparison the blueprint asks for.

## Things that will bite you

- Tests reset the `business`, `conversation` and `fishtea` schemas, and default to port **5434**. Never
  point `FISHTEA_TEST_DATABASE_URL` at a stack you care about.
- The needle test must run alone, with the pool up and warm (`GET /healthz` → `warming: false`).
- jsonb parameters are passed as JS values; pre-stringifying double-encodes them.
- All DDL identifiers are quoted, so a field named `order` works — and your SQL must quote it too
  (`f."order"`).
- The HTTP rate limiter is in-memory per process. Fine for one core; note it if you scale out.
- `fishtea serve` watches `spec.json`. Edits to `calls/*.sql|ts` need a restart.
