# Connectors: what FishTea carries, and what it does not

FishTea does not integrate with eBay. It does not integrate with Amazon, Shopify, Faire or any other
catalogue. It carries the **seam** those connectors plug into, one reference implementation that can be
tested without credentials, and the mechanism for someone else's connector to arrive as a plugin.

That is a deliberate position, not an unfinished one, and this page is here because the repository
currently contradicts it in one place.

## The rule

> A connector to a **specific vendor** belongs in the product that needs it. A connector to a **general
> service** every business needs belongs here.

The dividing line is not how hard the integration is. It is **who can honestly test it.**

A fashion site pulling stock from eBay has credentials, a marketplace, a category taxonomy, live traffic
and a reason to notice the morning the response shape changes. It can verify its connector against the
real endpoint every day, because it already does. FishTea has none of that. A vendor connector written
here would be written against documentation, tested against nothing, and would rot quietly — and it would
rot while wearing the framework's name, which is the part that matters.

So: build the eBay connector in the shop. Run it in production. If it turns out to be worth sharing,
promote it back as a plugin, with your name on it and a version of its own.

### What this repository gets wrong today

`templates/ecommerce/calls/adapters/ebay.ts` is exactly the thing this page argues against: 32 lines of
OAuth and query-string assembly against the eBay Browse API, shipped in an archetype, carrying its own
disclaimer.

```
 * Verify field names against the live Browse API before relying on it.
```

That comment is honest, and it is also an admission that this file should not be here. It has never been
run against the live API — `docs/NEXT.md` has said so since the initial build. Anyone scaffolding an
ecommerce application gets it, in `calls/`, looking like part of the framework.

The disposition is in the work list below.

## The seam, which does belong here

`templates/ecommerce/calls/inventory_pull.ts` defines what a connector *is*, and that is the durable
part:

```ts
export interface Adapter {
  fetch(
    q: { query?: string | null; limit: number; config: Record<string, unknown> },
    ctx: { env: NodeJS.ProcessEnv; resolve: (p: string) => string; spec: any },
  ): Promise<AdapterItem[]>;
}
```

An adapter normalises somebody's feed into `AdapterItem`, which is the shape `products.upsert` accepts.
Credentials come from the environment, never from the spec. An adapter that lacks its credentials returns
nothing with a note rather than throwing, so one broken vendor does not take the sync down.

Three reference adapters ship and are worth keeping, because each one can be tested here:

| adapter | what it is |
|---|---|
| `mock` | deterministic items; what the tests and the walkthrough use |
| `csv` | a file or URL of rows — the honest answer for most small catalogues |
| `http` | a JSON endpoint with a field mapping in `config` |

`csv` and `http` between them cover a surprising share of real vendor feeds without naming a single
vendor, which is the point.

## General connectors, which also belong here

These are the ones every business needs regardless of what it sells, and which FishTea can test —
against a sandbox, a local relay, or a clear error when a key is absent.

| connector | kind | state |
|---|---|---|
| frontier model inference | `integration` | **`plugins/anthropic`** — resolution, merge and a clear error without credentials are tested; a live completion is not |
| email relay | `channel` | the socket exists (`Engine.notify` → `Channel.deliver`); no relay plugin written |
| analytics | — | **no seam at all.** See below |
| payments | `integration` | not started; a `charge` call and a webhook the operator console can read |
| object storage | `integration` | not started; product images, uploaded documents |

A general connector is judged by one question: *would every archetype want this, or only a shop?* Email
and analytics pass. A shipping-rate API does not — that is a shop's problem, and a shop should own it.

### Analytics is the missing seam

There is nowhere to put it. A page view is not a notification and not a call, and the interesting events
here are not page views at all: a shape classified, a pour delivered, a write confirmed, an utterance
nobody could answer. The `unmet` view already collects the last of those, which is the most valuable one
and the one conventional analytics cannot see.

An `analytics` plugin kind would want a `record(event)` the engine calls after each turn, with the shape,
the confidence, the persona and the timings — the same facts the verify strip already shows the visitor.
That is a small seam, and it is not written.

## Bringing a connector back

The mechanism exists and is tested (`packages/cli/test/plugin.test.ts`, "the plugin lifecycle"):

```bash
# in the shop
fishtea plugin create ebay integration          # scaffolds plugins/ebay/ with a working compute call
# …build it, run it in production, learn what the API actually returns…

fishtea plugin promote ebay --home /path/to/fishtea
```

`promote` is a **move**, not a copy: leaving both would mean the local one always shadows the promoted
one, and the next person to change the core copy would wonder why nothing happened. `--copy` overrides
that when you want to keep developing locally.

The application that had it keeps working untouched — resolution is local → `node_modules` → builtin, so
the same `spec.plugins` line finds it in its new home.

### What stops a vendor adapter being a plugin today

This is the one real blocker, and it is small. `inventory.pull` dispatches by name:

```ts
const mod = await import(ctx.resolve(`calls/adapters/${v.adapter}.ts`));
```

`ctx.resolve` resolves inside the **application** directory. A plugin's adapter is not there, so a vendor
connector cannot currently ship as a plugin at all — it has to be a file someone copies into
`calls/adapters/`, which is precisely the arrangement that makes upgrades somebody's manual problem.

The fix is for the dispatcher to consult the application's plugins before falling back to `calls/`, the
same precedence everything else uses. Until that lands, "promote it back as a plugin" is advice the
framework cannot yet honour for this one kind of connector.

## Summary

- **Vendor connectors are built downstream**, against live endpoints, by people with credentials and a
  reason to care. They come back as plugins if they are worth sharing.
- **FishTea carries the seam** and adapters that name no vendor: `mock`, `csv`, `http`.
- **General connectors** — frontier models, email, analytics, payments, storage — belong here, because
  every archetype wants them and because they can be tested here.
- **`templates/ecommerce/calls/adapters/ebay.ts` is on the wrong side of that line** and should move.
