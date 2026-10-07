# Addresses and the timeline

*A proposal, not built. It does not depend on [shapes nesting](nested-shapes.html) and could ship first.*

A trail is append-only, rewindable and branchable. A URL is a string. The question is how to step through
the first using the second — forward and backward, deep in some areas and shallow in others — without
turning the URL back into the memory the whole framework argues it should not be.

## Four needs, usually conflated

Most of the difficulty comes from treating these as one problem. They are not, and they want different
answers.

| | what it is | who it belongs to |
|---|---|---|
| **back / forward** | I am at turn 12 and press back | me, this tab, right now |
| **bookmark** | take me back to where I was | me, later, any tab |
| **share** | look at *this* | somebody else, who has no trail |
| **deep link** | a search result lands on something | a stranger, who has no trail |

Only the first is about the timeline at all. The other three are about *things* and *places* — and a
stranger following a link has no timeline to be a point in.

## The idea: a point in a conversation is a question

This is the whole thing.

A conventional application stores where you are: page 3, sorted by price, filter open, step 2 of 4. That
is a snapshot of a screen, it does not fit in a URL, and the machinery to make it nearly fit is what the
essay complains about.

Here, the state that produced any answer is **a shape and its typed arguments**. `findProducts` with
`{tag: "wedding", maxPrice: 80}`. That is not a snapshot — it is the question, complete, because a
shape's input is declared and finite. And a question has a property a snapshot does not:

> **Re-asking it regenerates the answer.**

So a marker does not need to *store* a point in a timeline. It needs to name the question, and the point
reconstitutes itself — against today's prices, today's stock, and this visitor's personas. Nothing is
remembered; something is re-asked.

That is why this is safe to put in a URL when "page 3, sorted by price" was not. It carries intent, not
memory. Two people opening it ask the same question and get their own answers.

## Two coordinate systems

Keep them apart and the problem mostly dissolves.

**Where you are — the URL.** An area, and optionally a question within it. Public, stable, crawlable,
shareable. Carries no trail id, no turn id, no cursor.

**When you are — the history entry.** `history.pushState(state, "", url)` stores an object *in the
browser's session history*, not in the URL. It survives back, forward and reload of that entry; it is
not copied when someone copies the link; it does not exist for a stranger opening a bookmark. Which is
exactly the privacy envelope a turn id needs.

```js
// each turn: the URL says where, the entry remembers when
history.pushState({ turnId: res.turn.id }, "", addressFor(res));

window.onpopstate = (e) => {
  if (e.state?.turnId) rewindTo(e.state.turnId);   // POST /trail/rewind — already built and tested
};
```

`POST /trail/rewind` exists, is tested, and already branches when you speak after rewinding. Stepping
backward through a conversation is built. What is missing is binding it to the button people actually
press.

## Coarse and fine: the "deeper in some areas" part

If every utterance pushes a history entry, back becomes useless — twenty presses to leave a browse. If
none do, back leaves the site from the first screen. Both are familiar failures.

The split:

- **Push** a history entry when the *area* changes, or when a question within it is addressable.
- **Replace** within an area on every other turn, updating the entry's `turnId` in place.

Then the back button means **"the previous place I was"**, which is what people expect it to mean, and
the entry's `turnId` means "and you were eighteen turns deep when you left it". Coming back to an area
returns you to where you were in it, not to its beginning — depth per area, for free, with no bookkeeping.

Fine-grained stepping stays where it already is: the trail rail in the UI, which can rewind to any turn.
**The browser's back button is for places; the trail widget is for turns.** Two controls, two
granularities, neither pretending to be the other.

> **Revised in the sections shell (1.4.6).** In practice the split above inverted. The *conversation* is
> what a visitor navigates, and the sections are rooms to have it in. So, in the shell:
>
> - **A point is a change to the conversation:** a question typed, a card or thread followed, a filter,
>   a form. Each one is a pill in the trail (the Fishtea menu's drawer, since 1.5.0) and one history entry,
>   in the same order, so Back and Forward step through the conversation and a pill is a `history.go`.
> - **Entering a section with nothing asked** (the menu, Home, Up) is choosing a room, not a point. It
>   makes no crumb. Its history entry lasts only until something is said, when the next point replaces it.
> - **Reviewing a point never truncates.** A push after a review lays the later points back down first,
>   so what was said is never lost from history. The trail still branches on the server.
> - **The URL follows the conversation** for sharing and search. Nothing navigates by it once the page is
>   open.
>
> The entries' order lives in `sessionStorage` (`fishtea:history`), beside the browser's own entries,
> which outlive a reload just as it does. See `plugins/sections/useConversation.ts`.

## Which points are addressable is derived, not annotated

A shape is addressable when it is **`effect: "read"` and `allow` includes `stranger`**. Anything a
stranger may ask, that changes nothing, is by definition safe to name in a URL and safe to crawl.
Everything else is reachable only by conversation.

Run against `templates/ecommerce/spec.json` today, with nothing added to it:

```
ADDRESSABLE  findProducts      read    text, category, tag, brand, maxPrice
ADDRESSABLE  relatedProducts   read    productId
ADDRESSABLE  compareProducts   read    leftId, rightId
ADDRESSABLE  trending          read    days
             react             write
             addToCart         write
             removeFromCart    write
             viewCart          read    — customer only
             checkout          write
             orderStatus       read    — customer only
             becomeKnown       write
```

That is the right answer and nobody wrote it. The four discovery shapes are exactly what should be
indexable; the cart is correctly private because it is persona-guarded rather than because someone
remembered to exclude it; `checkout` is correctly absent because it is a write.

**This is also where "deep in some areas, shallow in others" comes from.** Browse is deep — four
addressable shapes with arguments, so thousands of real addresses. Purchase is shallow — `/purchase` and
nothing beneath it, because its contents are guarded. The depth of an area is a property of its shapes,
derived from the spec, not a decision anybody makes twice.

## Writes are not addressable; their results are

You cannot name "the moment I placed order 1234" as a question — re-asking it would place another order.
Writes have no address, and that is not a limitation to work around: an addressable write is a CSRF
vulnerability with a nice URL.

What *is* addressable is what the write produced, as the read shape that reports it:
`orderStatus{orderId}` → `/purchase/order-1234`, guarded to the customer who owns it. The rule holds
without an exception: reads get addresses, writes get conversations.

## The grammar

Derived from the shape's declared input types, so there is nothing to invent per business:

```
/browse                                  the area, no question yet
/browse/wedding                          findProducts{tag}           — one required-ish arg, in the path
/browse/wedding?under=80                 findProducts{tag,maxPrice}  — the rest as named parameters
/product/ravello-linen-shirt             relatedProducts{productId}  — an entity, by slug
/purchase                                the area; nothing beneath it is public
/purchase/order-1234                     orderStatus{orderId}        — guarded to its owner
```

Entity arguments resolve by slug rather than id, because `/product/ravello-linen-shirt` is worth
something to a search engine and `/product/8f3a91c2` is not. The spec already knows which fields are
`id` and which entity a `productId` points at, so the slug column is one declaration.

## "Have you not just reinvented the query string?"

Partly, and it is worth being straight about it, because `?under=80` looks exactly like the thing the
essay objects to.

The difference is what the string is a picture *of*. A conventional query string accretes: it accumulates
one UI decision at a time, has no schema, grows until half the state no longer fits, and gets propped up
with session storage and router state to cover the half that fell out. It is a picture of a screen.

This one is a picture of a question, and it is complete by construction — a shape's input is declared,
typed and finite, so there is no overflow to reconcile anywhere. Nothing accumulates: a new question
replaces the old one rather than adding a parameter to it. And it never carries who you are or what you
did, because personas come from the visitor and memory lives on the trail.

Same syntax. It is the schema and the absence of accumulation that make it a location rather than a
memory. If parameters ever start piling up across turns, this has failed and should be said so.

## A bookmark that answers differently is correct

Bookmark `/browse/wedding?under=80` today, open it in a month, and the answer will have changed —
different stock, different prices, possibly a different set entirely. That is not staleness to fix. The
bookmark saved a question, and a business that answers it the same way in a month is not answering, it
is replaying.

The one thing it must do is still *be* that question. An address that silently stops resolving because a
shape was renamed is a broken link, so shape names in addresses are part of the spec's public surface and
belong in the compatibility rules alongside the format version.

## What to build, and in what order

1. **Client-side addressing only** — `pushState` on area and question boundaries, `popstate` → the
   existing rewind. No server changes, no format change, and it makes back/forward correct today. This
   is worth doing on its own merits even if nothing else here ever happens.
2. **Derive the addressable set** from the spec (`read` + `stranger`) and expose it, so the UI knows
   which turns deserve a push and which only a replace.
3. **`GET /<address>` content-negotiating** — the same pour as JSON or as HTML. This is the server
   rendering work, and it is the expensive part.
4. **`sitemap.xml` and structured data**, generated from the addressable set crossed with real rows.
5. **Slugs**, if entity addresses turn out to matter as much as they probably do.

Steps 1 and 2 are days and need no decisions. Step 3 is the one that needs a prototype before it is
estimated.
