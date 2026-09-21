# Fishtea

*Solid ground, liquid UI.* Describe a business once — entities, calls, rules, shapes, personas — and derive the Postgres schema, the classifier's tool list, the planner, the UI vessels and the operator console from that one JSON file. Conversation replaces routing: a small on-device tool-calling model (needle3) turns what a visitor says into a **shape**, the planner composes typed **calls**, and the answer pours into one of seven **vessels**. The trail is rewindable, branchable, and never dies.

Applications start from an **archetype** in `templates/` and become a specific business through an **onboarding interview** (`onboard.json` in each template): the TUI asks the questions, or `fishtea new --answers file.json` answers them non-interactively. Every archetype is itself a complete, runnable example with seed data.

| archetype | what it is | the interview asks about |
|---|---|---|
| `ecommerce` | catalog (local rows or vendor feeds: mock, CSV, eBay, generic HTTP), cart, checkout, orders, reactions | categories, what people shop by, fulfilment (stock / affiliate-only / both), shipping, tax, returns, which vendor feeds |
| `portfolio` | a person you can interview: skills, projects, experience, an interview bank with follow-ups, honest fit assessment, contact | name, headline, summary, availability, skill areas, what visitors may ask for |
| `verification` | employee engagement verification: requester → consent → verifier attestation → minimal disclosure by purpose | purposes served, consent TTL, retention, engagement kinds |
| `program` | sessions-based program: find a session, register (multi-child, sibling discount, capacity, age rules), scholarships, device loans, schedule, FAQ | price, discount, ages, capacity, hours, location, tracks, equipment |
| `blank` | one entity, one read shape, one write shape | name, description, greeting |

## Quick start

```bash
bun install
bun fishtea templates                              # the archetypes and their interviews
bun fishtea new my-shop --template ecommerce --interactive   # or --answers answers.json, or bun run tui → Onboard
cd my-shop && cp .env.example .env
bun run up          # Postgres (pgvector) + needle3 pool + core + UI, via docker compose
bun run tui         # the operator console for *this* application
```

Or run an archetype directly against a local Postgres:

```bash
export DATABASE_URL=postgres://fishtea:fishtea@localhost:5432/fishtea
bun run migrate --app templates/ecommerce && bun run seed --app templates/ecommerce
bun run headless --app templates/ecommerce        # the whole product as JSON, no UI
bun run dev --app templates/ecommerce             # http://localhost:3000  (GET / = the resumed conversation)
cd packages/ui && bun install && bun run dev      # http://localhost:5173
```

`--app <dir>` names an application directory (`spec.json` + `calls/` + `seed/`); it defaults to `FISHTEA_APP` or the current directory, so inside a generated app you never pass it.

## How it fits together

```
spec.json ──derive──▶ DDL · tool list · forms · vessels · zod
   │
   ▼
visitor utterance ─▶ persona (from the trail) ─▶ tool list filtered by allow[] ─▶ needle3 pool ─▶ shape + args
                                                                                        │
                            pour: ask | form | confirm-write | answer ◀── planner (calls in topological waves)
                                                                                        │
                            trail (append-only tree, JSONB) ◀── provenance, embedding ──┘
```

- `packages/spec` — the format and every derivation.
- `packages/core` — trail, persona, planner, pour, notifications (SSE), Hono transport, headless runner.
- `packages/classifier` — the needle3 worker pool (Python). `contract.md` has the measured findings.
- `packages/cli` — `fishtea` (templates · new · validate · derive · migrate · seed · serve · headless · tui · up · bench). `new.ts` applies an archetype's interview answers to its spec.
- `packages/tui` — onboard, edit a section (scoped prompts, `$EDITOR`, add a shape, regenerate from template), run (status, restart, migrate, unmet channel, notify).
- `packages/ui` — React + Tailwind; seven vessels; understood line; verify strip; next chips; live region.
- `packages/bench` — budgets enforced, conventional multi-page baseline measured alongside.

See `docs/BLUEPRINT.md` for the design and `docs/DESIGN.md` for what the build measured and changed.
