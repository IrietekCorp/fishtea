# Shapes within shapes

*A proposal, not built. Written down so it can be argued with before anything is committed to.*

Today a spec has a flat list of shapes. `findProducts`, `addToCart`, `checkout`, `orderStatus` — eleven
of them in the ecommerce archetype, each a question a visitor may ask, each with its own guard, plan,
vessel and next chips. The classifier is handed all the ones the current persona allows and picks one.

The proposal is that shapes **nest**. A top-level shape is an *area* of the business — something you can
walk up to and ask about — and inside it are the smaller things you can actually say there.

```
vendor                          a top-level shape: an area with a boundary
├── subjects   get insights or information
└── verbs      commit actions, react to requests, schedule things
```

For a shop:

| top-level shape | contains |
|---|---|
| **inventory browse** | implicit search and explicit search; the shopping action lives here |
| **product details** | the detail itself, comparisons, upsells, related sets |
| **secure a purchase** | cart, insurance, shipping dates, payment, fulfilment, order tracking |
| **reports** | order history, spend, what a customer has asked for before |

The interesting claim is not the grouping. It is what the boundary *owns*: the classification vocabulary
inside it, the data it may touch, the UI components it may compose, the guard that says who may be here
at all — stitched together by service calls, and rendered as a **loose amalgamation of UI elements**
rather than one component. Server-driven UI, except the components are composed and shaped per turn
instead of being a tree the server names.

## What already exists, unnamed

A fair amount of this is in the engine already, which is the reason to take the idea seriously rather
than treat it as a rewrite.

- **The guard is `allow`.** Every shape names the personas that may ask it, and the engine filters before
  the classifier ever sees a tool. A boundary's guard is the same mechanism raised one level: `allow` on
  the parent, inherited by the children, which is strictly less to write than today.
- **The stitching is `next`.** `findProducts` already offers `relatedProducts` and `trending`;
  `addToCart` offers `viewCart` and `checkout`. The graph the areas describe is already drawn — one hop
  at a time, by hand, in eleven places. Grouping would let most of those chips be derived from the area
  rather than enumerated.
- **Scoped classification already happens, keyed by persona.** `Engine.personaSubsets` computes the
  distinct allowed-tool sets and the needle pool pre-warms one agent per subset. Narrowing the tool list
  by *where the conversation is* rather than only *who is asking* is the same machinery with a second
  key.
- **Composition already happens once.** A form pour carries fields *and* chips; a notification carries
  text and next. What does not exist is a pour that carries several vessels.

## What is genuinely new, and hard

Three things, in increasing order of difficulty.

### 1. A boundary as a classification scope

This is the cheapest and probably the most valuable. Inside "secure a purchase" the classifier chooses
between four or five things, not eleven. Smaller tool lists should mean both faster and more accurate
classification, and needle's cost is dominated by tool JSON in the prompt.

**It is also where the measured cost is.** From `packages/classifier/contract.md`: switching a worker to
another tool subset costs **0.7–1.2 s**, against 125–310 ms to complete a call, and each worker holds
~160 MB. The pool wants `NEEDLE_WORKERS ≥ the number of distinct subsets`; ecommerce has **3** today,
one per persona. Areas multiply that — four areas against three personas is up to twelve subsets, which
is ~1.9 GB resident and twelve sequential warms at start.

So the first question is not "is this a nicer model" but **does the accuracy and latency gain inside a
small subset pay for the subset explosion**. `packages/bench` exists to answer exactly that, and it
should, before any of this is built.

### 2. Two-level classification against one budget

If the conversation is inside an area, one classify call over that area's tools is all that is needed —
the common case, and the fast one. The cost appears when a visitor changes the subject: "actually, where
is my last order?" said in the middle of checkout.

Options, none free:

- **Classify twice** — which area, then which shape. Two calls inside one hard budget of 400 ms. Against
  measured needle latency of 125–310 ms per call that is tight to impossible.
- **Classify once over the current area plus every area's top-level shape.** The tool list is the area's
  shapes plus three or four area names — still far smaller than today's flat list, one call, and a miss
  falls back to `ask`, which is what a miss does now.
- **Do not scope at all until the second turn.** The first utterance of a visit sees everything; once an
  area is established, subsequent turns are scoped, with an escape hatch tool for leaving.

The second looks right and is cheap to prototype. The house rule is unchanged either way: past the
budget the pour is `ask`, never a dumber brain.

### 3. Composite pours

This is the real change, and it touches the part of the system with the most tests. Today
`Pour` is one of seven kinds and an answer names exactly one `vessel`; `container.tsx` switches on it.
"A loose amalgamation of the UI elements" means a pour carrying *several*, composed for this turn:

```
product details  →  detail(product) + compare(product, alternative) + list(upsells) + chips
secure a purchase →  form(shipping) + card(order summary) + note(insurance offer) + confirm-write
```

What has to be decided:

- **Who composes.** The area's plan naming its parts is explicit and inspectable, and the framework's
  existing bias is strongly towards declared-not-inferred. Composing from what the calls happened to
  return is more fluid and much harder to reason about when it goes wrong.
- **What a part is.** Most cheaply: a pour is a *list of the existing pours*, so every vessel keeps its
  current contract and the container renders a sequence. Vessel overrides (already wired) then compose
  too, for free.
- **The verify strip.** Today it reports one shape, its calls, its reads and writes. A composite has
  several, and the strip is the thing that makes the system inspectable — so it has to say which part
  came from where, not collapse into one line. This is a feature, not an obstacle: a composite answer
  that cannot be taken apart is exactly the opacity the framework exists to avoid.
- **The write rule still holds absolutely.** A composite containing a write still pours `confirm-write`
  first, and the confirm is about the write, not the composite.

## What it would look like

Sketch only — the nesting is the point, not the syntax.

```jsonc
"shapes": {
  "purchase": {
    "asks": "Buying: the cart, payment, delivery and what happens after",
    "allow": ["customer", "mid-purchase"],        // inherited by everything inside
    "triggers": ["checkout", "buy", "my cart", "delivery", "where is my order"],
    "shapes": {
      "viewCart":   { "asks": "…", "effect": "read",  "vessel": "list" },
      "addToCart":  { "asks": "…", "effect": "write" },
      "checkout":   { "asks": "…", "effect": "write" },
      "orderStatus":{ "asks": "…", "effect": "read",  "vessel": "timeline" }
    },
    "compose": ["viewCart", "shippingEstimate", "insuranceOffer"]
  }
}
```

Two things follow that are worth noticing. A connector plugs into an **area**, not a loose adapter
interface — which is the thread this started on: `vendor` as a top-level shape gives a plugin one place
to contribute subjects, verbs, calls and UI together, instead of dropping a file into `calls/adapters/`
and hoping the dispatcher finds it. And `next` mostly disappears: within an area the siblings are the
chips.

## A top-level shape is an address

*Added after the first draft: for SEO, bookmarking and linking, top-level shapes should be pages.*

This looks like it contradicts the whole thesis, and it does not. The essay is precise about what the
complaint actually is:

> A URL is a string. We ask that string to carry where you are, what you filtered, what you sorted, which
> step of a flow you reached, sometimes who you are. **It is a location pretending to be a memory**, and
> it is terrible at it.

The objection is to the URL as *memory*. A location is what a URL is genuinely good at. And the blueprint
already said where the locations would come from:

> **No routes.** Intent classification replaces routing. There are no URLs to memorize and no funnel to
> re-walk. **The shape names *are* the routes**, and the classifier picks them.

Top-level shapes as pages is that sentence taken literally. `/browse`, `/purchase`, `/orders`,
`/vendor` — a small, stable set of places you can walk up to, one per area, named by the spec.

### What the address carries: nothing

The URL names the area and stops. No filters, no sort, no step, no cursor, no trail id. Memory stays on
the trail, where it is append-only, rewindable and branchable, and where it belongs to a visitor rather
than to a string.

That gives a property worth stating plainly, because it is the thesis rather than a compromise of it:
**two people opening the same link get the same place and different conversations.** Under URL-as-state
that is impossible — the link *is* the state, so it has to reproduce somebody else's screen. Here the
link is an address and the personalisation is intact.

It also means the rules stay true. "No URLs to memorize" survives: you land on them, you do not assemble
them. "Never a page" survives in the form that matters — **the page is an entrance, not a corridor.**
There is still nothing to navigate *between* you and an answer.

### What this does not get you, which is most of the SEO

Being honest, because this is the part that would otherwise disappoint.

Four or five area pages is a thin crawlable surface. For a shop, the pages that actually rank are the
*things*: `/product/ravello-linen-shirt`, thousands of them, each answering a long-tail query nobody
would think to type into a conversation. Areas give you bookmarking and linking. They give you very
little search traffic.

So addresses probably want two levels, not one:

| address | what it is | what it is for |
|---|---|---|
| `/purchase` | a top-level shape | bookmarking, "take me back to where I was" |
| `/product/<slug>` | an entity the spec already declares | search, sharing a *thing*, link previews |

The second is derivable — the spec knows its entities, their fields and which are addressable — but it
is a larger change than the first and should be judged separately.

### The blocker: nothing is server-rendered

`packages/ui` is a Vite SPA and the core serves JSON only — `GET /` returns `pour(resume)` and nothing
else. A crawler currently receives an empty `<div id="root">`. Google will sometimes execute the
JavaScript, late and unreliably; most other crawlers do not, and the LLM crawlers that increasingly
decide what gets recommended largely do not either.

**SEO here is not a metadata problem. It is a rendering problem**, and it is the real cost of this
section.

The seam is at least clean. `GET /` already produces exactly the thing a page needs; the work is to
accept an area in the path and content-negotiate the result:

```
GET /purchase   Accept: application/json   → the pour, as today
GET /purchase   Accept: text/html          → the same pour, rendered, with the SPA hydrating onto it
```

One pour, two encodings. The vessels already know how to render it in the browser; making them render on
the server is the piece of work, and it is not small.

### What falls out of the spec for free

Once areas and entities have addresses, a good deal of what SEO wants is derivable rather than written,
which is the framework's whole argument applied to its own weakest surface:

- **`sitemap.xml`** — the areas, plus a row per addressable entity. Generated, never maintained.
- **Structured data** — `schema.org/Product`, `Offer`, `Event`, `Person` from the entity's declared
  fields. The spec already knows a `money` field is a price.
- **Open Graph and link previews** — title, description and image from the same field ranking
  `fields.tsx` already computes for the card vessel.
- **Canonical URLs and `robots.txt`** — one per area, one per addressable entity, nothing else indexable.

### The line that must not be crossed

A shareable link must never carry conversation state, and specifically must never carry a trail id. That
would reintroduce URL-as-memory with a privacy bug attached: anyone with the link inherits somebody
else's conversation.

Sharing a *conversation* is a separate feature and should look like one — an explicit "share this", a
minted token with a scope and an expiry, not something that leaks into the address bar by default.

## Where this conflicts with what is written down

Being honest about the tensions, because the blueprint is explicit and this is not a small change.

- **"Seven vessels, never a page."** A composite of four vessels is close to being a page, and the rule
  exists to stop exactly that drift. The defence is that the composition is per-turn and derived from
  what was asked, not a layout somebody drew — but it is a real risk and it should be stated as one.
- **The spec format changes.** Nested shapes are a `spec.fishtea` format change, so migrations
  (`packages/spec/src/migrate.ts`) and the three-way reconcile both have work, and every archetype needs
  regrouping. The versioning machinery for that already exists and has been exercised.
- **`VesselName` and the pour union are load-bearing.** `packages/ui`, the TUI, the headless runner, the
  bench and the e2e suite all switch on pour kind.
- **Server rendering is a new capability, not a change to an existing one.** Nothing in the framework
  renders HTML today. This is the largest single piece of work the proposal implies, and it arrives for
  a reason — findability — that the original design did not weigh.

## What to do first

In order, and each one answers a question rather than building the thing:

1. **Measure the classification win.** Hand-partition the ecommerce tools into four areas, run
   `packages/bench` against area-sized subsets, and compare accuracy and latency with the flat list at
   `packages/bench/baseline.json`. If the gain is small, the whole proposal is a readability change and
   should be judged as one.
2. **Measure the subset cost.** Pool warm time and resident memory at 3 subsets vs 12. `contract.md`
   predicts ~1 s each and ~160 MB each; confirm it.
3. **Prototype the composite pour** as a list of existing pours, behind one archetype, and see what the
   verify strip has to become.
4. **Prototype one area as an address** — `GET /purchase` content-negotiating JSON and HTML — before
   nested shapes exist at all. It can be tested against the flat shape list, it answers whether the
   rendering cost is what it looks like, and it is the part with a deadline attached: a site nobody can
   find is a problem today, not after a format change.
5. **Only then** change the spec format.
