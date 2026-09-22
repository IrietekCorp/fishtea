# FishTea — Build Blueprint

**Version 1.0 · 2026-09-21 · for a Claude CLI build session**

> **The organizing sentence.** The conversation is the unit of navigation. Routes, pages and funnels are replaced by a living, rewindable trail; a small on-device classifier (needle3) shapes the question instead of a menu; the UI, notifications and "homepage" are projections of the conversation's current node; and the memory of past conversations gives continuous familiarity. Everything else in this document exists to serve that sentence. If any component grows beyond what that sentence needs, cut it.

*Solid ground, liquid UI.* The ground is what stays fixed: the business spec, the data, the rules, who may do what. The water is everything the human sees, and it takes its shape from the ground.

---

## 0. How to read this document

- **Sections 1–3** are the *why* and the decisions already made. Do not relitigate them; they came out of a long design conversation with the owner.
- **Sections 4–13** are the *what*, pinned concretely: file tree, the spec JSON format, the Postgres schema, the planner algorithm, the classifier service contract, the vessel vocabulary, security, accessibility, performance, Compose, TUI.
- **Section 14** is the build order with acceptance tests per phase.
- **Section 15** lists known unknowns — things this document could not verify. Validate them *first*.
- `reference/` in this package is a working spike (Bun, sqlite, lexical classifier, seven vessels). It is not the product; it is proof of the ground/water loop and a source of code to lift. Section 16 maps it.

Words used precisely throughout:

| Term | Meaning |
|---|---|
| **Spec** | The versioned JSON document describing a business: entities, shapes, rules, personas, notifications. The single source everything derives from. |
| **Entity** | A typed record kind (product, order, customer). Becomes a Postgres table. |
| **Shape** | A question the system can answer: input schema, answer schema, resolver (a plan over calls), effect, allow, next. Becomes a tool for the classifier and a vessel for the UI. |
| **Call** | A named, typed data operation declared in the spec (query or mutation). Shapes resolve by composing calls. |
| **Utterance** | Anything the visitor does: typed text, a chip click, a form submit, arrival. All become turns. |
| **Turn** | One appended node in a conversation trail. Utterance in, pour out, plus provenance. |
| **Trail** | The conversation: an append-only tree of turns per visitor. Rewind = point at an earlier turn. Branch = new child of an old turn. |
| **Pour** | The system's response to an utterance: exactly one of `ask`, `form`, `answer`, `confirm-write`. |
| **Vessel** | One of a fixed set of UI containers an answer is rendered into. Chosen deterministically from the answer's shape. |
| **Envelope** | The arrival metadata a visit brings (referrer, campaign, coupon, identity or its absence). Seeds the trail. |
| **Persona** | A named engagement state derived from what the trail knows (`stranger`, `known`, `customer`, `mid-purchase`, …). Gates which shapes are visible. |

---

## 1. Thesis and lineage

FishTea (2006, PHP/XML/Smarty) described a problem in markup and grew the ORM, the module, the template and the connective tissue from that description. It had four ideas under the PHP: the URL was the question; a module described the problem and its template grew from it; components were embeddable answers; `Renv` remembered where you came from. It stopped at the data half because nothing in 2006 could conduct an interview or classify intent cheaply.

Those constraints are gone. This version delivers the original imagination:

1. **Describe once, derive everything.** A JSON spec describes the business — not just inventory but pricing, tax, transactions, billing, invoicing, compliance, capabilities. The data layer, the API, the classifier's tool list, the forms and the UI derive from it. Advanced operators edit it by hand; the TUI, a future conversational authoring layer, or a CLI are all just editors of the same JSON.
2. **No routes.** Intent classification replaces routing. There are no URLs to memorize and no funnel to re-walk. The shape names *are* the routes, and the classifier picks them.
3. **The application works with no UI.** Consumer payloads in, business payloads out. The interface is a function callback into a design system, provably the last and thinnest layer.
4. **State is a point in a conversation.** Not a bookmarkable object. The trail is rewindable and branchable, and it never dies.
5. **The homepage is a summary of where the conversation is.** First visit: a greeting shaped by arrival metadata. Return visit: the resumed conversation — the cart, the three outfits you were comparing, the payment offer relevant *because of where you are*. Same code path.
6. **Personalization is the conversation, not the profile.** Not colors and dark mode; not a flattened attribute list; the richness of what has been said. This also reframes analytics: the session is the conversation and the conversation is the customer record.
7. **Two-way.** The engine informs the consumer of what's available and the business of what was asked and couldn't be answered. A failed classification is demand signal, not an error.

The talk that prompted the resurrection ("Quantum UI") argues the same split from the design side and ends on *what has to stay fixed: governance, permissions, who can see what.* That is the ground. FishTea makes it a list you can read — the spec — rather than a policy you hope a model follows.

---

## 2. Decisions log (settled; do not reopen)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Runtime: Bun + TypeScript.** | Fast startup, built-in sqlite for tests, `bun:ffi` for a future direct needle binding. |
| D2 | **Spec format: JSON**, hand-editable, versioned, sectioned. | Universal; editable by humans, TUI, CLI or a future authoring conversation alike. |
| D3 | **One Postgres.** Relational tables for the business, JSONB for conversation turns. | The two must be *joinable* ("conversations that asked for a product we don't carry"). Splitting stores loses the vendor channel and the analytics reframe. |
| D4 | **Classifier: needle3 (Cactus) as a pooled service**, not per-node. | Small enough for per-keystroke latency; a tool-caller, and a shape registry is a tool list; calibrated confidence; empty list for off-topic. |
| D5 | **No degraded classifier in production.** Lexical classifier is dev/offline harness and benchmark baseline only. | A wrong shape erodes the familiarity that is the product. |
| D6 | **Fallback is conversational.** Timeout or low confidence → `ask` or `form` vessel (a legitimate turn), never a dumber brain. Strict mode: "one moment" turn + retry. | The store owner saying "what brings you in?" is on-thesis; a spinner is not. |
| D7 | **Composition: a spec-driven planner**, not GraphQL. Hono is an acceptable HTTP transport underneath; the intelligence is the planner. | In GraphQL the client knows the shape it wants. Here the client doesn't; the classifier discovers it. |
| D8 | **Docker Compose is the whole orchestration.** Build step only. **No deploy step, no cloud dependency, no credential management.** | Focus on the differentiated part. Deployment targets can become TUI options later. |
| D9 | **Postgres as its own Compose service with a volume**, not baked into the app image. | Lifts out to any managed Postgres later without a rewrite. |
| D10 | **Design system: shadcn/ui (React + Tailwind + Radix)**, pinned. Vessels map to components. | Accessible primitives once; seven vessels, not infinite generated screens. |
| D11 | **Notifications are turns.** Authored by the system or the operator, visible to both parties, delivered over SSE. | "A way to get someone's attention that something needs doing" — part of the conversation, not a side channel. |
| D12 | **TUI is an editor and control surface over the spec**: onboarding, live edit, restart, regenerate a *section*. Operator actions are themselves shapes with an operator-scoped registry. | Same engine pointed at itself; no second system. |
| D13 | **Two sample specs: ChicDuJour (fashion co-shopper) and AI Explorer Camp (kids' AI program).** | Far apart on purpose. If both derive from the same spec format and engine, the framework is real. |
| D14 | **Edge/core split at the payload boundary**: edge renders and captures; core classifies and composes. | needle needs the trail and the catalog, which live next to Postgres. |
| D15 | **Tenancy: one Compose stack = one business.** | No control plane, no multi-tenant. |
| D16 | **Performance is a first-class deliverable**: budgets enforced in CI, a harness that measures, and a conventional baseline to beat. | "Faster than existing implementations" must be measured, not asserted. |

---

## 3. Architecture

```
                         ┌──────────────────────────────────────────────────────────┐
   visit (envelope)      │  CORE  (Bun)                                             │
   ─────────────────────▶│  ┌──────────┐   tool list    ┌─────────────┐             │
   utterance             │  │ trail    │──(persona-     │ classifier  │  needle3     │
   ─────────────────────▶│  │ service  │   filtered)──▶ │ client      │──pool────▶   │
                         │  └────┬─────┘                └──────┬──────┘  (sidecar or │
                         │       │ context                     │ ranked  separate    │
                         │       ▼                             ▼ calls   service)    │
   pour (JSON)           │  ┌──────────┐   plan          ┌─────────────┐             │
   ◀─────────────────────│  │ pour     │◀────────────────│ planner     │             │
   SSE notifications     │  └────┬─────┘                 └──────┬──────┘             │
   ◀─────────────────────│       │ append turn                  │ calls               │
                         │       ▼                             ▼                     │
                         │  ┌────────────────────────────────────────────┐           │
                         │  │ Postgres: business tables (from spec)      │           │
                         │  │           conversation.turn (JSONB)        │           │
                         │  └────────────────────────────────────────────┘           │
                         └──────────────────────────────────────────────────────────┘
                                                  ▲
                              spec.json ──────────┘ (loader derives tables, calls, tools, vessels)
                                  ▲
                          TUI / editor / CLI (all edit the same file)

   EDGE / CLIENT: captures utterances (debounced keystrokes, chips, forms), renders pours
   into vessels via shadcn components. Holds no business logic and no state except the
   visitor token. Provably replaceable: `bun run headless` exercises the whole core with no UI.
```

**Request lifecycle (one utterance):**

1. Client posts `{ visitor, utterance }`. Server loads the trail head for the visitor (or opens a trail from the envelope on first contact).
2. **Persona** is derived from the trail (see §7). The **tool list** is the spec's shapes filtered by `allow(persona)`. The classifier never sees a shape the visitor may not use.
3. Structured utterances (chip, form) skip classification. Text utterances go to the **classifier** with: the text, the last *k* turns summarised as context, and the filtered tool list. Hard budget (§11). Result: ranked `{shape, args, confidence}` list, possibly several (compound).
4. **Pour** decides: no result / below floor → `ask`. Shape known, required args missing or invalid → `form` with knowns pre-filled. Shape has `effect: "write"` → `confirm-write` (a form vessel that must be explicitly submitted, regardless of confidence). Otherwise → **planner** resolves the shape's plan over spec calls (topological, concurrent where independent), validates against the answer schema, chooses the **vessel**, computes `next[]` affordances, attaches **provenance**.
5. The turn `{utterance, classification, pour, provenance, timings}` is appended to the trail as JSONB. Unanswerable utterances are additionally recorded to `conversation.unmet` (the vendor channel).
6. Response is the pour. Notifications for this visitor, if any, arrive over SSE as turns authored by `system` or `operator`.

**The homepage** is `GET /` → `pour(resume)`: render the current node of this visitor's trail. For a stranger that is the greeting shaped by the envelope; for a returning visitor it is the last answer plus its `next[]` plus any pending notifications. One code path.

---

## 4. Repository layout

```
fishtea/
├── BLUEPRINT.md                     ← this document
├── CLAUDE.md                        ← build brief for the CLI session
├── docker-compose.yml
├── Dockerfile.core
├── Dockerfile.classifier
├── package.json                     ← bun workspaces
├── packages/
│   ├── spec/                        ← spec schema, loader, validator, migrations
│   │   ├── schema/spec.schema.json  ← JSON Schema for the spec format (§5)
│   │   ├── src/load.ts              ← parse + validate + freeze
│   │   ├── src/derive.ts            ← spec → tables DDL, tool specs, vessels, forms
│   │   └── src/version.ts           ← semantic version + section hashes
│   ├── core/                        ← the server
│   │   ├── src/trail/               ← conversation service (open, append, rewind, branch, resume)
│   │   ├── src/persona.ts           ← persona derivation + allow() filtering
│   │   ├── src/classify/            ← Classifier interface, needle client, lexical (dev only)
│   │   ├── src/plan/                ← planner: plan graph, topo sort, concurrent exec, assembly
│   │   ├── src/calls/               ← call executors (sql, compute, external) bound from spec
│   │   ├── src/pour.ts              ← ask | form | confirm-write | answer
│   │   ├── src/vessel.ts            ← inferVessel + vessel contracts
│   │   ├── src/notify/              ← notifications as turns; SSE fan-out
│   │   ├── src/http.ts              ← Hono routes: /, /utter, /events, /trail/*, /spec (operator)
│   │   ├── src/headless.ts          ← run the full loop with no UI (CLI + tests)
│   │   └── src/db/                  ← pg client, migrations runner, conversation schema
│   ├── classifier/                  ← the needle3 pool service
│   │   ├── needle_service.py        ← HTTP+JSON lines; loads tools from spec; /classify, /embed, /healthz
│   │   └── contract.md              ← request/response contract (§9)
│   ├── ui/                          ← Vite + React + shadcn; renders vessels only
│   │   ├── src/vessels/             ← one component per vessel (§10)
│   │   ├── src/container.tsx        ← input, understood-line, vessel, verify strip, next chips
│   │   └── src/client.ts            ← utter(), SSE subscribe, visitor token
│   ├── tui/                         ← operator console (§13)
│   └── bench/                       ← performance harness (§11)
├── specs/
│   ├── chicdujour.spec.json
│   └── aiexplorercamp.spec.json
├── reference/                       ← the spike (Bun + sqlite + lexical + seven vessels)
└── docs/DESIGN.md                   ← lineage and the talk mapping (from the spike)
```

---

## 5. The spec (JSON)

One file, sectioned so the TUI can regenerate one section without touching the others. Every section carries its own `version`. Readable keys, `"doc"` fields for humans. JSON Schema at `packages/spec/schema/spec.schema.json` validates it; the loader refuses to start on an invalid spec.

```jsonc
{
  "fishtea": "1.0",
  "business": {
    "id": "chicdujour",
    "name": "Chic du Jour",
    "doc": "Curated women's accessories. The accessory makes the dress. Mood-driven co-shopping.",
    "locale": "en-US",
    "currency": "USD",
    "version": "2026.09.21-1"
  },

  "entities": {
    "version": "2026.09.21-1",
    "product": {
      "doc": "One accessory. Rich description is the knowledge pool the classifier extracts against.",
      "fields": {
        "id":          { "type": "id" },
        "name":        { "type": "string" },
        "description": { "type": "text", "doc": "Write it like you'd describe it to a friend: material, occasion, mood, what it pairs with." },
        "category":    { "type": "enum", "values": ["earrings","necklace","bracelet","scarf","bag","hair","sunglasses"] },
        "price":       { "type": "money" },
        "moods":       { "type": "string[]", "doc": "e.g. bold, quiet, playful, polished" },
        "occasions":   { "type": "string[]" },
        "styleTags":   { "type": "string[]", "doc": "e.g. italian-tailoring, japanese-minimal, resort" },
        "stock":       { "type": "int", "min": 0 },
        "imageUrl":    { "type": "url", "optional": true }
      },
      "index": ["category", "moods", "styleTags"],
      "embed": ["name", "description", "moods", "occasions", "styleTags"]
    },
    "outfit":   { "fields": { "id": {"type":"id"}, "visitorId": {"type":"id"}, "name": {"type":"string"}, "productIds": {"type":"id[]"}, "mood": {"type":"string","optional":true} } },
    "cart":     { "fields": { "id": {"type":"id"}, "visitorId": {"type":"id"}, "lines": {"type":"json","doc":"[{productId, qty}]"}, "updatedAt": {"type":"timestamp"} } },
    "order":    { "fields": { "id": {"type":"id"}, "visitorId": {"type":"id"}, "lines": {"type":"json"}, "subtotal": {"type":"money"}, "tax": {"type":"money"}, "total": {"type":"money"}, "shipTo": {"type":"json"}, "status": {"type":"enum","values":["placed","paid","packed","shipped","delivered","returned"]}, "placedAt": {"type":"timestamp"} } },
    "customer": { "fields": { "id": {"type":"id"}, "email": {"type":"email"}, "name": {"type":"string","optional":true}, "createdAt": {"type":"timestamp"} } }
  },

  "calls": {
    "version": "2026.09.21-1",
    "doc": "Named, typed data operations. Shapes compose these. The planner runs them.",
    "products.search": {
      "kind": "query",
      "in":  { "text": "string?", "category": "string?", "moods": "string[]?", "styleTags": "string[]?", "maxPrice": "money?", "limit": "int=12" },
      "out": "product[]",
      "impl": { "sql": "products_search.sql", "doc": "FTS + tag overlap; embedding rerank when the classifier pool is up" }
    },
    "products.byIds":   { "kind": "query", "in": { "ids": "id[]" }, "out": "product[]", "impl": { "sql": "products_by_ids.sql" } },
    "products.related": { "kind": "query", "in": { "productId": "id", "limit": "int=6" }, "out": "product[]", "impl": { "sql": "products_related.sql" } },
    "style.bridge": {
      "kind": "compute",
      "doc": "Given a source style and a target style, return the tag set that transitions between them.",
      "in":  { "from": "string", "to": "string" },
      "out": { "tags": "string[]", "rationale": "string" },
      "impl": { "module": "calls/style_bridge.ts" }
    },
    "cart.get":         { "kind": "query",    "in": { "visitorId": "id" }, "out": "cart?", "impl": { "sql": "cart_get.sql" } },
    "cart.add":         { "kind": "mutation", "in": { "visitorId": "id", "productId": "id", "qty": "int=1" }, "out": "cart", "impl": { "sql": "cart_add.sql" } },
    "tax.quote":        { "kind": "compute",  "in": { "lines": "json", "shipTo": "json" }, "out": { "tax": "money", "rate": "number", "jurisdiction": "string" }, "impl": { "module": "calls/tax_quote.ts" } },
    "order.place":      { "kind": "mutation", "in": { "visitorId": "id", "lines": "json", "shipTo": "json", "tax": "money" }, "out": "order", "impl": { "sql": "order_place.sql" }, "transaction": true },
    "order.status":     { "kind": "query",    "in": { "orderId": "id" }, "out": { "order": "order", "events": "json" }, "impl": { "sql": "order_status.sql" } }
  },

  "rules": {
    "version": "2026.09.21-1",
    "doc": "Business rules with teeth. Evaluated by the planner, never by the model.",
    "pricing": { "freeShippingOver": 75, "currencyRounding": "half-up" },
    "tax": { "provider": "table", "table": "tax_rates.json", "applyOn": "subtotal", "shipToRequired": true },
    "compliance": { "orderRequires": ["email", "shipTo.country"], "ageGate": false, "returnsWindowDays": 30 },
    "writes": { "confirmAlways": true, "minConfidence": 0.85 }
  },

  "shapes": {
    "version": "2026.09.21-1",
    "findAccessories": {
      "asks": "Find accessories by mood, occasion, style or price",
      "input": { "mood": "string?", "occasion": "string?", "style": "string?", "maxPrice": "money?" },
      "answer": "product[]",
      "effect": "read",
      "allow": ["stranger", "known", "customer"],
      "plan": [ { "call": "products.search", "with": { "moods": "[$mood]", "styleTags": "[$style]", "text": "$occasion", "maxPrice": "$maxPrice" } } ],
      "phrase": "Accessories {mood? that feel $mood} {occasion? for $occasion} {style? in a $style style}",
      "next": [ { "label": "Build an outfit around {item.name}", "shape": "buildOutfit", "args": { "seedProductId": "$item.id" }, "each": "answer" } ]
    },
    "bridgeStyles": {
      "asks": "Move from one style to another, e.g. from Italian tailoring toward Japanese minimalism",
      "doc": "The compound case. Two calls, second depends on first.",
      "input": { "from": "string", "to": "string", "maxPrice": "money?" },
      "answer": { "bridge": { "tags": "string[]", "rationale": "string" }, "picks": "product[]" },
      "effect": "read",
      "allow": ["stranger", "known", "customer"],
      "plan": [
        { "id": "b", "call": "style.bridge",     "with": { "from": "$from", "to": "$to" } },
        { "id": "p", "call": "products.search",  "with": { "styleTags": "$b.tags", "maxPrice": "$maxPrice", "limit": 8 }, "after": ["b"] }
      ],
      "assemble": { "bridge": "$b", "picks": "$p" },
      "vessel": "detail",
      "next": [ { "label": "Add {item.name}", "shape": "addToCart", "args": { "productId": "$item.id" }, "each": "answer.picks" } ]
    },
    "addToCart":  { "asks": "Add an item to the cart", "input": { "productId": "id", "qty": "int=1" }, "answer": "cart", "effect": "write", "allow": ["known","customer"], "plan": [ { "call": "cart.add", "with": { "visitorId": "$visitor.id", "productId": "$productId", "qty": "$qty" } } ], "next": [ { "label": "Check out", "shape": "checkout" } ] },
    "checkout":   { "asks": "Place the order", "input": { "shipTo": "json", "email": "email" }, "answer": { "ok": "boolean", "order": "order", "summary": "string" }, "effect": "write", "allow": ["customer"],
                    "plan": [ { "id": "c", "call": "cart.get", "with": { "visitorId": "$visitor.id" } },
                              { "id": "t", "call": "tax.quote", "with": { "lines": "$c.lines", "shipTo": "$shipTo" }, "after": ["c"] },
                              { "id": "o", "call": "order.place", "with": { "visitorId": "$visitor.id", "lines": "$c.lines", "shipTo": "$shipTo", "tax": "$t.tax" }, "after": ["c","t"] } ],
                    "assemble": { "ok": true, "order": "$o", "summary": "Order $o.id — $o.total incl. $t.tax tax ($t.jurisdiction)" } },
    "orderStatus":{ "asks": "Track an order", "input": { "orderId": "id" }, "answer": { "order": "order", "events": "json" }, "effect": "read", "allow": ["customer"], "plan": [ { "call": "order.status", "with": { "orderId": "$orderId" } } ], "vessel": "timeline" },
    "becomeKnown":{ "asks": "Save your email so we can keep this conversation", "input": { "email": "email" }, "answer": { "ok": "boolean" }, "effect": "write", "allow": ["stranger"], "plan": [ { "call": "customer.upsert", "with": { "email": "$email" } } ] }
  },

  "personas": {
    "version": "2026.09.21-1",
    "doc": "Engagement states derived from the trail. Ordered; first match wins.",
    "mid-purchase": { "when": "trail.has('cart') && !trail.has('order.placed', 'last 1h')" },
    "customer":     { "when": "identity.email != null" },
    "known":        { "when": "identity.cookie != null || identity.issuedUrl != null" },
    "stranger":     { "when": "true" }
  },

  "envelope": {
    "version": "2026.09.21-1",
    "doc": "Arrival metadata that seeds a conversation. All fields untrusted input.",
    "accept": ["referrer", "utm_source", "utm_campaign", "coupon", "cookie", "issuedUrl", "userAgent", "locale"],
    "greeting": {
      "stranger":     { "shape": "findAccessories", "hint": "Tell us how you feel today — or what you're dressing for.", "offer": ["becomeKnown"] },
      "known":        { "resume": true },
      "customer":     { "resume": true },
      "mid-purchase": { "resume": true, "offer": ["checkout"] }
    }
  },

  "notifications": {
    "version": "2026.09.21-1",
    "doc": "Turns authored by system/operator. Visible to both parties.",
    "order.shipped":  { "to": "visitor", "text": "Your order {order.id} shipped.", "next": [ { "shape": "orderStatus", "args": { "orderId": "$order.id" } } ] },
    "unmet.daily":    { "to": "operator", "text": "{count} things were asked for that we couldn't answer.", "next": [ { "shape": "op.unmetReport" } ] }
  },

  "operator": {
    "version": "2026.09.21-1",
    "doc": "The TUI's registry. Operator actions are shapes too.",
    "shapes": {
      "op.unmetReport": { "asks": "What did people ask for that we couldn't answer?", "input": { "since": "string=7d" }, "answer": "json", "effect": "read", "allow": ["operator"], "plan": [ { "call": "conversation.unmet", "with": { "since": "$since" } } ], "vessel": "list" },
      "op.editSection": { "asks": "Edit a section of the spec", "input": { "section": "enum:entities|calls|rules|shapes|personas|envelope|notifications", "patch": "json" }, "answer": { "ok": "boolean", "version": "string" }, "effect": "write", "allow": ["operator"] },
      "op.restart":     { "asks": "Restart the core with the current spec", "input": {}, "answer": { "ok": "boolean" }, "effect": "write", "allow": ["operator"] }
    }
  }
}
```

**Type vocabulary** (`packages/spec/schema`): `id`, `string`, `text`, `int`, `number`, `money`, `boolean`, `enum`, `email`, `url`, `timestamp`, `json`, `T[]`, `T?`, `T=default`. Answer types reference entity names (`product[]`) or inline objects.

**Plan language** (deliberately tiny): a list of steps `{ id?, call, with, after? }`; `with` values are literals or `$`-references into shape input (`$mood`), the visitor (`$visitor.id`), or a prior step's output (`$b.tags`); `[$x]` wraps a scalar into a list; `after` declares dependencies (the planner also infers them from `$step.` references). `assemble` builds the answer from step outputs; omitted → the single step's output is the answer. `each` in `next` fans an affordance out over an array in the answer.

**Derivations the loader performs** (`derive.ts`): entities → DDL + migrations (§6); `calls` with `impl.sql` → prepared statements; `calls` with `impl.module` → dynamic import; shapes → classifier tool specs (JSON Schema from `input` + `asks` as description) and form field lists; `answer` → default vessel (§10); `phrase` → the "understood" line; `rules.writes` → confirm behaviour; `personas` → `allow` filtering; `envelope.accept` → validated envelope parser; `entities.*.embed` → the columns concatenated for embedding.

---

## 6. Postgres schema

Two schemas in one database. `business.*` is generated from the spec; `conversation.*` is fixed.

```sql
-- generated from spec.entities (example: product)
CREATE SCHEMA IF NOT EXISTS business;
CREATE TABLE business.product (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  description  text NOT NULL,
  category     text NOT NULL CHECK (category IN ('earrings','necklace','bracelet','scarf','bag','hair','sunglasses')),
  price        numeric(12,2) NOT NULL,
  moods        text[] NOT NULL DEFAULT '{}',
  occasions    text[] NOT NULL DEFAULT '{}',
  style_tags   text[] NOT NULL DEFAULT '{}',
  stock        integer NOT NULL CHECK (stock >= 0),
  image_url    text,
  embedding    vector(768),                 -- pgvector; populated from entities.product.embed; nullable
  fts          tsvector GENERATED ALWAYS AS (to_tsvector('english', name || ' ' || description)) STORED
);
CREATE INDEX ON business.product USING gin (fts);
CREATE INDEX ON business.product USING gin (moods);
CREATE INDEX ON business.product USING gin (style_tags);
CREATE INDEX ON business.product USING ivfflat (embedding vector_cosine_ops);

-- fixed
CREATE SCHEMA IF NOT EXISTS conversation;

CREATE TABLE conversation.visitor (
  id           text PRIMARY KEY,            -- opaque token issued on first contact; cookie/issuedUrl map to it
  customer_id  text REFERENCES business.customer(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversation.trail (
  id           text PRIMARY KEY,
  visitor_id   text NOT NULL REFERENCES conversation.visitor(id),
  head_turn_id text,                        -- current node (rewind moves this)
  envelope     jsonb NOT NULL,              -- validated arrival metadata
  opened_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON conversation.trail (visitor_id, opened_at DESC);

CREATE TABLE conversation.turn (
  id           text PRIMARY KEY,
  trail_id     text NOT NULL REFERENCES conversation.trail(id),
  parent_id    text REFERENCES conversation.turn(id),   -- tree, not list: branches are children of old turns
  seq          integer NOT NULL,
  author       text NOT NULL CHECK (author IN ('visitor','system','operator')),
  at           timestamptz NOT NULL DEFAULT now(),
  -- typed columns for what you query on
  shape        text,
  kind         text CHECK (kind IN ('ask','form','confirm-write','answer','notification')),
  confidence   real,
  answered     boolean NOT NULL,            -- false = unmet (the vendor channel)
  latency_ms   integer,
  -- the fluid part
  utterance    jsonb NOT NULL,              -- {text?, shape?, known?}
  pour         jsonb NOT NULL,              -- the full response as sent
  provenance   jsonb NOT NULL,              -- {shape, read[], wrote[], calls[], at, records}
  embedding    vector(768)                  -- of utterance text; enables cross-conversation familiarity
);
CREATE INDEX ON conversation.turn (trail_id, seq);
CREATE INDEX ON conversation.turn (shape) WHERE answered;
CREATE INDEX ON conversation.turn (at) WHERE NOT answered;
CREATE INDEX ON conversation.turn USING ivfflat (embedding vector_cosine_ops);

-- the vendor channel: one query, because both halves live together
CREATE VIEW conversation.unmet AS
  SELECT t.at, t.utterance->>'text' AS asked, tr.envelope->>'utm_campaign' AS campaign, v.customer_id
  FROM conversation.turn t JOIN conversation.trail tr ON tr.id = t.trail_id JOIN conversation.visitor v ON v.id = tr.visitor_id
  WHERE NOT t.answered AND t.author = 'visitor';
```

Rules: business tables are **regenerated by migration** when `entities.version` changes (additive by default; destructive changes require `--allow-destructive` from the TUI). Conversation tables never change shape from the spec. `pgvector` is required in the image (`pgvector/pgvector:pg16`). Embeddings are optional at runtime: if the classifier pool's `/embed` is down, rows are inserted with `NULL` and backfilled by a job.

**Trail operations** (`core/src/trail`): `open(visitorId, envelope)`, `append(trailId, parentId, turn)`, `head(visitorId)`, `rewind(trailId, turnId)` (moves head; nothing deleted), `branch(trailId, turnId, utterance)` (append with an older parent), `resume(visitorId)` → the pour to render as the homepage, `context(trailId, k)` → last *k* turns on the path from head to root, summarised for the classifier, `recall(visitorId, embedding, threshold)` → past turns from *other* trails above cosine threshold (familiarity, §7).

---

## 7. Arrival, persona, familiarity

**Envelope.** `GET /` and the first `POST /utter` carry whatever the visit brought: referrer, UTM fields, coupon, cookie, an issued URL token, user agent, locale. The parser accepts only `envelope.accept` keys, length-limits and pattern-validates each (a coupon is `^[A-Z0-9-]{3,32}$`), and stores the result on the trail. **Every envelope field is attacker-controlled** and is never interpolated into SQL or into text the classifier sees without escaping.

**Identity resolution:** issued URL token → cookie → nothing. Resolves to a `visitor.id`; if `visitor.customer_id` is set the persona can reach `customer`. The empty case (no cookie, no token) is the `stranger` persona — a persona defined by what is missing, not a blank state.

**Persona** is evaluated on every utterance from the trail + identity using the spec's `personas` predicates (a tiny expression language: `identity.*`, `trail.has(shape|event, window?)`, boolean ops). The persona filters the shapes into the tool list *before* classification and decides the greeting.

**Homepage = `resume(visitorId)`:**
- No trail → open one from the envelope → pour the persona's `greeting`: a `form`/`ask` for the greeting shape with `hint`, plus `offer[]` as chips.
- Trail exists → the head turn's pour, re-validated (stock may have changed → re-run its plan), plus pending notifications as turns, plus `next[]`. If the head is an `answer` about three outfits, the three outfits are what you see. No rehydration, because nothing was dehydrated.

**Familiarity across conversations** (the "memory never dies" claim, made mechanical):
1. When a text utterance arrives, the classifier pool returns its embedding alongside the classification.
2. `recall()` searches this visitor's *other* trails for turns above `familiarity.threshold` (default 0.82 cosine).
3. Recalled turns enter **only as context to the classifier** ("earlier this visitor asked: …"), never as an unprompted greeting. They earn their way in by resonance with the current utterance, or they stay silent.
4. Recall is strictly per-visitor. There is no cross-visitor retrieval anywhere in the system.

---

## 8. The planner

Input: a shape, validated args, the visitor. Output: an answer matching the shape's answer schema, plus provenance.

```
plan(shape, args, visitor):
  steps  = shape.plan
  deps   = explicit `after` ∪ inferred from "$<stepId>." references in `with`
  order  = topological sort(steps, deps)          # cycle → spec validation error at load, never at runtime
  ready  = steps with no unmet deps
  loop until all done:
      run every step in `ready` concurrently (Promise.all), each with budget rules.calls.timeoutMs (default 250)
      a step failing → the whole pour becomes `form` with error, knowns preserved  (the ground refused the question)
      resolve `with` for newly-unblocked steps from completed outputs
  answer = assemble(shape.assemble, outputs) or the sole step's output
  validate answer against shape.answer   # zod schema derived at load
  provenance = { shape, calls: [{id, call, ms}], read: tables read, wrote: tables written, at, records }
```

Call executors: `sql` (prepared statement, parameters only — never string-built), `compute` (a TypeScript module exporting `(input, ctx) => output`), `external` (HTTP with an allowlist and timeout; not used by the two samples). `transaction: true` on a mutation wraps that step in a Postgres transaction. Rules are applied inside compute calls (`tax.quote`) and by the planner's write gate (§12); the classifier never evaluates a rule.

**Compound requests.** The classifier may return several `function_calls`. Pour handles them in order of confidence: if the top is a shape whose plan already composes the others (as `bridgeStyles` does), take it alone; otherwise run the top shape and offer the rest as `next[]`. A general multi-shape composer is deliberately *out of scope* for v1 — shapes compose calls, and that is where compound questions are expressed. Record this as an open question (§15).

---

## 9. The classifier service

A separate Compose service (`classifier`), Python, wrapping `cactus-needle`. Loaded once from the spec's tool specs; reloaded on `POST /reload`. Pooled: N worker processes behind one port; core talks to the pool, never to a specific worker.

```
POST /classify
  { "text": "...", "context": "last turns, one line each", "tools": ["findAccessories", ...] }   # tools = persona-filtered subset by name
  → { "function_calls": [ { "name": "...", "arguments": {...} } ], "reasoning": "...", "confidence": 0.0–1.0, "embedding": [768 floats], "ms": 11 }

POST /embed     { "texts": ["..."] } → { "embeddings": [[...]] }
POST /reload    { "tools": [ToolSpec...] }  → { "ok": true, "count": n }
GET  /healthz   → { "ok": true, "model": "needle3", "workers": 4 }
```

Core-side rules:
- Budget: `rules.classify.budgetMs` (default **60 ms** end-to-end from core's perspective, including transport). Exceeded → cancel and pour `ask` (or `form` if `current` shape is obvious). Never wait past budget.
- Confidence floor: `rules.classify.floor` (default 0.35). Below → `ask`.
- Empty `function_calls` → `ask`, and the turn is recorded `answered=false` (unmet).
- Strict mode (`FISHTEA_STRICT=1`): pool unhealthy → pour a `notification` turn "One moment — getting things ready" with a retry affordance; never answer from the lexical classifier.
- Dev mode (`FISHTEA_INTENT=lexical`): the lexical classifier from `reference/` runs in-process. Used by tests and the benchmark baseline only. The UI shows the classifier name in the meta line so nobody mistakes it for the product.

The sidecar in `reference/src/intent/needle_sidecar.py` is the starting point: it already turns JSON-Schema tool specs into typed `@needle.tool` functions. **Validate the real `cactus-needle` API before anything else** (§15).

---

## 10. Vessels and the UI callback

The answer schema picks the vessel. Deterministic; the model never chooses. Override with `vessel` on a shape.

| Answer shape | Vessel | shadcn/ui components |
|---|---|---|
| `T[]` | **list** | `Table` (≥ 6 rows) or `Card` grid (< 6, or has `imageUrl`) |
| object, scalar fields only | **card** | `Card`, `Badge` |
| object with array fields | **detail** | `Card` + nested `list` per array, `Separator` |
| `{ left, right, facets }` | **compare** | two `Card` columns, `Table` for facets |
| `{ events[] }` | **timeline** | custom `Timeline` on `Separator` + `Badge` |
| `{ ok, ... }` ≤ 4 keys | **confirm** | `Alert` (success) |
| pour kind `form` / `confirm-write` | **form** | `Form` (react-hook-form + zod), `Input`, `Select`, `Checkbox`, `Button`; write confirms use `AlertDialog` |
| pour kind `ask` | **ask** | `Command`-style option list of shapes as chips (`Badge` buttons) |
| `notification` turns | **notice** | `Toast`/`Sonner` + an inline row above the vessel |

The container (`ui/src/container.tsx`) has one input, the understood-line (phrase + confidence dot), the vessel, the **verify strip** (provenance: shape, read, wrote, records, time — writes in accent colour), and `next[]` chips. Field-level treatments are by *name* (`price` → money, `imageUrl` → image, `heat`/`rating` → glyphs), never by shape. The UI has no knowledge of any entity.

Client behaviour: debounce 250 ms on input; sequence numbers so a stale pour never overwrites a newer one; chips and forms post structured utterances; SSE subscription for notifications; the visitor token in a cookie; `aria-live="polite"` region announces each pour's phrase (§12).

**Headless proof:** `bun run headless --spec specs/chicdujour.spec.json` runs a scripted conversation through core with no UI and prints each pour as JSON. It is the first thing that must pass in every phase.

---

## 11. Performance

The claim is "faster than a conventional multi-page implementation of the same task." It is a measured claim.

**Budgets (enforced in CI; the build fails if exceeded on the harness machine):**

| Metric | Budget |
|---|---|
| classify (core → pool → core, warm) | p50 ≤ 30 ms, p95 ≤ 60 ms |
| plan + calls for a single-step read shape (Postgres warm) | p95 ≤ 40 ms |
| `POST /utter` end-to-end, single-step read | p95 ≤ 120 ms |
| `POST /utter` end-to-end, `bridgeStyles` (two-step) | p95 ≤ 180 ms |
| `GET /` resume for a returning visitor | p95 ≤ 100 ms |
| keystroke → vessel painted (client, local) | p95 ≤ 250 ms |
| core cold start to first pour | ≤ 2 s |
| pool cold start (model load) | ≤ 5 s |

**Harness** (`packages/bench`): `bun bench` runs a fixed script of 40 utterances (stranger → known → bridge → cart → checkout → status) against a Compose stack, 200 iterations, reports p50/p95/p99 per metric, writes `bench/results/<date>.json`, and diffs against `bench/baseline.json`. **Baseline to beat:** `bench/conventional/` — a minimal multi-page Hono app doing the same task with routes and full page loads; the harness scripts it with Playwright and reports task-completion time and bytes transferred alongside FishTea's numbers.

**Design levers already in the architecture:** no navigation round-trips; needle sized for per-keystroke; planner concurrency; prepared statements; persona-filtered tool lists (fewer tools → faster classification); embeddings and recall off the hot path (recall runs concurrently with classification and is dropped if it misses budget); SSE instead of polling; the client holds no state to rehydrate.

---

## 12. Security and accessibility

**Security — the specific risk here is that utterances become actions.**
1. **Authorization before classification.** The tool list handed to the classifier is filtered by persona `allow`. A capability the visitor may not use is never in their toolset; there is nothing to inject into.
2. **Writes always confirm.** `effect: "write"` shapes pour `confirm-write` regardless of confidence (`rules.writes.confirmAlways`), and the submitted form is validated against the input schema server-side again.
3. **Envelope is untrusted.** Allowlisted keys, length and pattern validation, stored as data, escaped before entering classifier context.
4. **SQL only via prepared statements** from the spec's `impl.sql` files; `$`-references are parameters. Spec loader rejects any `sql` impl containing string interpolation markers.
5. **Trails are per-visitor.** Every trail read is scoped by `visitor_id` from the session token; recall never crosses visitors. Operator shapes live in a separate registry gated by an operator token; the consumer classifier never sees them.
6. **Classifier context is bounded**: last *k* turns (default 6), each truncated; recalled turns are labelled as prior context. The model's output is validated against the input schema before use; `reasoning` is logged, never shown to visitors.
7. Boring but mandatory: rate limit `/utter` per visitor; CSRF on the cookie'd form posts; HTTPS terminated by whatever fronts Compose (out of scope); secrets via env only.

**Accessibility — a property of the architecture, not a pass at the end.**
- Seven vessels built once on Radix primitives means keyboard navigation, focus management and ARIA roles are solved per vessel, not per screen. This is the direct answer to the "quieter cost" the talk warns about.
- Each pour announces its phrase through an `aria-live="polite"` region; `form` pours move focus to the first empty required field; `confirm-write` uses a proper `AlertDialog` with focus trap.
- The per-keystroke re-pour is *not* announced on every keystroke — only when the vessel kind or shape changes, or on submit — to avoid screen-reader flooding.
- Colour never carries meaning alone (confidence dot has text; write provenance is bold *and* coloured). Tokens support light/dark and `prefers-reduced-motion` disables the pour transition.
- The headless mode is itself an accessibility affordance: the entire product is usable as JSON over HTTP, so any assistive front end can be built on it.

---

## 13. Docker Compose and the TUI

```yaml
# docker-compose.yml
services:
  db:
    image: pgvector/pgvector:pg16
    environment: { POSTGRES_USER: fishtea, POSTGRES_PASSWORD: fishtea, POSTGRES_DB: fishtea }
    volumes: [ "pgdata:/var/lib/postgresql/data" ]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U fishtea"], interval: 3s, retries: 20 }
  classifier:
    build: { context: ., dockerfile: Dockerfile.classifier }
    environment: { NEEDLE_WORKERS: "4", NEEDLE_MODEL: "Cactus-Compute/needle3" }
    volumes: [ "models:/models" ]           # weights cached across restarts
    healthcheck: { test: ["CMD", "curl", "-f", "http://localhost:8081/healthz"], interval: 5s, retries: 30 }
  core:
    build: { context: ., dockerfile: Dockerfile.core }
    environment:
      DATABASE_URL: postgres://fishtea:fishtea@db:5432/fishtea
      CLASSIFIER_URL: http://classifier:8081
      FISHTEA_SPEC: /specs/chicdujour.spec.json
      FISHTEA_STRICT: "0"
    volumes: [ "./specs:/specs" ]           # the TUI edits these; core watches and hot-reloads non-entity sections
    ports: [ "3000:3000" ]
    depends_on: { db: { condition: service_healthy }, classifier: { condition: service_healthy } }
  ui:
    build: { context: ., dockerfile: Dockerfile.core, target: ui }
    ports: [ "5173:5173" ]
    environment: { VITE_CORE_URL: http://localhost:3000 }
volumes: { pgdata: {}, models: {} }
```

`bun run up` = `docker compose up --build`. `bun run tui` attaches the console. There is no deploy target. The `models` volume is the one network-dependent step (first pull of the weights from Hugging Face); document it, and support `NEEDLE_MODEL_PATH` for an offline copy.

**TUI** (`packages/tui`, Bun + a terminal UI library — use `@clack/prompts` for flows and `ink` if a persistent screen is wanted; keep it small). Three jobs, all expressed as operator shapes over the same core:
1. **Onboard** — walk an operator through a new spec: business basics, pick a starting template (`specs/templates/commerce.json`, `specs/templates/program.json` derived from the two samples), entities, a first shape. Writes `specs/<id>.spec.json`.
2. **Edit** — pick a section, open it in `$EDITOR` or answer scoped prompts, validate, bump that section's version, hot-reload (entities changes prompt for a migration and a restart).
3. **Run** — status of the three services, restart core, regenerate a section, tail the unmet channel (`op.unmetReport`), send an operator notification.

---

## 14. Build phases and acceptance

Build in this order. Each phase has a test that must pass before the next begins. Prefer lifting code from `reference/` where it fits.

**Phase 0 — Validate unknowns (½ day).** Install `cactus-needle`, load needle3, run a tool call and an embedding. Confirm the response fields (`function_calls`, `confidence`, whether embeddings are exposed). Record findings in `packages/classifier/contract.md`. Confirm `pgvector` image and `bun:ffi` are not needed yet. *Accept:* a script prints a real classification for "move my Italian suit look toward Japanese minimal, under $80".

**Phase 1 — Spec + loader + derive (1 day).** JSON Schema, loader, `derive.ts` producing DDL, tool specs, forms, vessels. Both sample specs validate. *Accept:* `bun run derive specs/chicdujour.spec.json` prints DDL for five tables and eight tool specs; `aiexplorercamp.spec.json` derives with zero code changes.

**Phase 2 — Postgres + migrations + calls (1 day).** Compose `db`, migration runner, business schema generation, conversation schema, prepared-statement executors, seed data for both samples. *Accept:* `SELECT count(*) FROM business.product` > 0; `conversation.unmet` view exists.

**Phase 3 — Headless core (2 days).** Trail service, persona, planner, pour, provenance, lexical classifier in dev mode. *Accept:* `bun run headless` runs the 40-utterance script for ChicDuJour and prints pours; `bridgeStyles` shows two calls in provenance with the second depending on the first; a bare "check out" as `stranger` yields `form` for `becomeKnown`, not `checkout`; the write shape pours `confirm-write`; rewind to turn 12 and a new utterance creates a branch.

**Phase 4 — Classifier service (1 day).** Python pool, `/classify`, `/embed`, `/reload`, budgets, strict mode, embeddings on turns, `recall()`. *Accept:* headless script passes with `FISHTEA_INTENT=needle`; killing the pool mid-script yields `ask` pours within budget, never lexical answers; a second trail for the same visitor gets a recalled turn in classifier context when the utterance resonates.

**Phase 5 — HTTP + notifications (1 day).** Hono routes, SSE, homepage-as-resume, envelope parsing, rate limits. *Accept:* `curl -H 'Referer: ...' -b coupon=SPRING10 /` returns the stranger greeting; after a cart add, `GET /` returns the cart answer; an operator notification appears on the visitor's SSE stream as a turn.

**Phase 6 — UI (2 days).** Vite + React + shadcn, seven vessels, container, verify strip, live region. *Accept:* Playwright walkthrough (lift `reference/` walkthrough): stranger → find → outfit → known → cart → checkout → timeline; axe-core reports zero serious violations on every vessel; light and dark screenshots.

**Phase 7 — TUI (1 day).** Onboard, edit, run. *Accept:* create a third spec from the `program` template in under five prompts; edit `rules.pricing.freeShippingOver` and see it hot-reload without restart; entity edit prompts for migration.

**Phase 8 — Bench (1 day).** Harness, budgets in CI, conventional baseline. *Accept:* `bun bench` produces the table in §11 with every budget green on the reference machine, and reports FishTea vs conventional task-completion time.

**Phase 9 — ChicDuJour refactor (open-ended).** Inspect the existing chicdujour repo; migrate its catalog and intent into `specs/chicdujour.spec.json`; keep what fits the mood-driven co-shopper (mood equalizer as `findAccessories.mood`, trend signals as a `products.trending` call, engagement reactions as a write shape). The AI Explorer Camp spec (sessions, enrolment, scholarships, device loans, parent notifications) must keep deriving unchanged as the check that nothing became fashion-specific.

---

## 15. Known unknowns — validate first

1. **needle3's actual API surface.** This document was written without running the weights (blocked in the design sandbox). The `function_calls / reasoning / confidence` shape comes from the model card; whether `/embed` is exposed through `cactus-needle` and at what dimension (768 assumed) must be confirmed in Phase 0. If embeddings are unavailable, use a small sentence-transformer in the same pool and keep the contract.
2. **needle3 with 8–10 tools and persona filtering.** Accuracy on the compound `bridgeStyles` case vs. two separate calls. If it prefers separate calls, keep `bridgeStyles` and add a `next[]` for the second half — do *not* build a general composer in v1.
3. **General multi-shape composition** is out of scope. Shapes compose calls; that is where compound questions live. Revisit after Phase 9 if real utterances demand it.
4. **Per-keystroke classification load** at scale: the pool is CPU-bound; measure requests/sec per worker in Phase 8 and document the worker count formula.
5. **Familiarity threshold** (0.82) is a guess. Tune against the 40-utterance script with a second trail.
6. **Hot-reload of `entities`** is intentionally not automatic. Decide in Phase 7 whether the TUI applies additive migrations live.

---

## 16. What `reference/` already proves (and what to lift)

| Reference file | Proves | Lift to |
|---|---|---|
| `src/ground/shape.ts` | `defineShape`, `inferVessel` rules | `core/src/vessel.ts` (same rules), spec `answer` → vessel |
| `src/ground/registry.ts` | shapes → JSON-Schema tool specs via `z.toJSONSchema` | `spec/src/derive.ts` |
| `src/ground/db.ts` | Zod object → table, `touched` provenance tracking | `core/src/db` (Postgres) — keep `touched` |
| `src/intent/classifier.ts` | the `Classifier` interface | unchanged |
| `src/intent/needle_sidecar.py` | JSON-Schema → typed `@needle.tool` functions | `classifier/needle_service.py` |
| `src/intent/lexical.ts` | dev baseline, vocabulary matching, context carry | `core/src/classify/lexical.ts` (dev only) |
| `src/water/pour.ts` | ask / form / answer, form fields from schema, provenance | `core/src/pour.ts` (+ confirm-write, trail append) |
| `public/container.js`, `tokens.css` | seven vessels, verify strip, understood line, chips | re-expressed in React + shadcn |
| `domain/*` | a spec written as TypeScript — what §5 replaces with JSON | delete after Phase 1 |

Run it: `cd reference && bun install && bun run dev` → http://localhost:3000 → type "jerk pork vs pepper pot", then "order" while looking at a menu.

---

*End of blueprint.*

