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
complaint actually is — "it is a location pretending to be a **memory**" — and the blueprint already said
where the locations would come from: "**the shape names *are* the routes**". `/browse`, `/purchase`,
`/orders` is that sentence taken literally. The address carries the area and nothing else, memory stays
on the trail, and two people opening the same link get the same place and different conversations. The
page is an entrance, not a corridor.

**The full argument, including how to step through a timeline without putting it in the URL, is in
[Addresses and the timeline](addresses.html).** It does not depend on shapes nesting and could ship
first. The short version of what it costs: `packages/ui` is a Vite SPA and the core serves JSON only, so
a crawler receives an empty div — SEO here is a rendering problem, not a metadata one, and server
rendering is a capability the framework does not have at all.

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
