# Running it

Nothing assumes localhost. The core binds `0.0.0.0` by default, so a fresh application answers on every
address of the machine it runs on, and the start-up banner prints the addresses other machines should
dial.

## Addresses

| setting | flag | what it is |
|---|---|---|
| `FISHTEA_HOST` | `--host` | what the core binds. `0.0.0.0` (default) accepts any address; `127.0.0.1` keeps it local |
| `PORT` | `--port` | the core's port |
| `FISHTEA_PUBLIC_HOST` | `--public-host` | the address others dial. Detected from the LAN when unset; used for printed URLs |
| `FISHTEA_CORE_URL` | | where the ui server proxies `/core` (compose sets `http://core:3000`). The browser then dials the page's own origin, so the visitor's cookie is first-party wherever the page was opened |
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

**Never put a CPU limit on the classifier.** The engine starts twelve threads and keeps them, reads no
environment variables, and ignores the affinity mask it is given, so a limit does not make it use fewer
threads — it makes twelve spinning threads fight over fewer cores. Measured, one classify that takes
238 ms on sixteen cores takes **9.9 s** pinned to eight and **92.7 s** pinned to one. A `--cpus` setting
or a Kubernetes quota on this container is the difference between working and not.

For the same reason workers compute one at a time: two classifies side by side are 6.5× worse *total*
throughput than two in a row. Capacity is about **four to five classifies a second per host**, and the
only way to scale out is more hosts.

What does move the needle is how much the model has to say. Latency is decode length — `latency ≈ 110 ms
+ tokens ÷ 310` — so the pool caps it at 64 tokens (`NEEDLE_MAX_NEW_TOKENS`, or `rules.classify.maxTokens`
per application), which cuts p90 by 61% and the worst case by 79% without costing accuracy. Repeats are
cached (`NEEDLE_CACHE`, 512 entries, cleared on reload), because classification is a pure function of the
tool subset, the text and the cap: a repeat answers in 11 ms and spends no turn in the queue.
`GET /healthz` reports the cap and the cache's hits and misses.

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

## Admin

`/admin` on the ui server is where the people who run an application sign in. It shows every visitor,
their visits and each turn in full (what was said, what it matched, what the plan read and wrote, the
layout the answer carried), the questions nobody could answer, the spec — edited whole, validated on
save, refused if someone saved since, the replaced version kept in `.fishtea/spec-history/` — and the
lighter settings: the scalar values in `rules` and each plugin's configuration. What guards visitors
(`rules.writes`) and what is structure (the layout, the menu) stays in the spec editor.

The first start creates one operator, **`admin`**, with the password **`fishtea-admin`** (or
`FISHTEA_ADMIN_PASSWORD`, if set when the operator is created). Signing in on it opens one thing only: a
form to replace it. Until then the core says so at every start. A new password is at least 12
characters, not the one given and not containing the username; changing it signs out every other
session of that operator.

| | |
|---|---|
| passwords | argon2id; the answer to a wrong username and a wrong password is the same |
| sessions | 32 random bytes in an httpOnly, SameSite=Strict cookie (`fishtea_operator`), stored as a hash, 8 hours |
| lockout | five wrong passwords lock the account for fifteen minutes; ten attempts a minute per address |
| changes | a cookie'd change also needs the `x-fishtea-admin` header, which a page on another site cannot send |

`/op` has two doors: a person's session, or `FISHTEA_OPERATOR_TOKEN` for scripts (the TUI,
`fishtea notify`). New applications get a random token in `.env`; the core warns while it is
`change-me`. There is no TLS here either — behind anything public, put the ui server behind HTTPS, and
the session cookie is marked Secure when the request says it came over it.

## Visitors that are not people

A headless run, a layout check, a browser test: each is a visitor to the core, and a new one each time.
Tooling says what it is with `x-fishtea-tool` (headless and `fishtea present` do), which is kept on the
visit's envelope whatever `envelope.accept` says. `fishtea visitors prune` lists the visitors only
tooling ever produced and, with `--yes`, deletes them and everything they said. A visitor with one visit
from a person is kept.

## Things that will bite you

- Tests reset the `business`, `conversation` and `fishtea` schemas, and default to port **5434**. Never
  point `FISHTEA_TEST_DATABASE_URL` at a stack you care about.
- The needle test must run alone, with the pool up and warm (`GET /healthz` → `warming: false`).
- Classifier accuracy varies between process instances on identical inputs — 15 to 18 of the same 24
  cases. One run is an anecdote; measure repeatedly before concluding anything about accuracy.
- jsonb parameters are passed as JS values; pre-stringifying double-encodes them.
- All DDL identifiers are quoted, so a field named `order` works — and your SQL must quote it too
  (`f."order"`).
- The HTTP rate limiter is in-memory per process. Fine for one core; note it if you scale out.
- `fishtea serve` watches `spec.json`. Edits to `calls/*.sql|ts` need a restart.
