---
title: Seven bugs from the first time anyone opened the UI
date: 2026-09-22
summary: The test suite was green, the API was verified, and the interface had never been looked at in a browser. Here is what was waiting.
author: Shawn J. Stewart
tags: ui, testing
---

FishTea's engine had a healthy test suite well before anyone opened its web interface in a browser. Every
HTTP path was exercised, every archetype ran its walkthrough, the classifier was benchmarked. The UI was
built, it compiled, and the tests that existed passed.

Then someone opened it. Seven real defects, three of them serious, in under an hour.

This is not a story about bad code. It is a story about what a test suite is *shaped* to find.

## The card that never showed a price

The product grid rendered each item with its first six fields. A shopper saw `vendorId`, `sourceId`,
`brand`, `category`, `tags` and a raw JSON blob of internal attributes.

It never showed the price.

Not because of a bug in the price logic — there was no price logic. The card took
`Object.entries(row).slice(0, 6)`: the first six keys *in the order the entity happened to declare them*.
`price` is the tenth field on a product. It never made the cut, on any product, ever.

The fix was to rank fields by how interesting they are rather than by declaration order, using names and
value shapes only — the UI is not allowed to know what a product is. Prices sort to the top; foreign keys,
audit timestamps and objects sort to the bottom and fall off the end. A record that has *nothing* but
identifiers still shows them, because an order confirmation needs that.

## The checkout that submitted an empty address

This one was worse, and it is the kind of bug a type system cannot see.

react-hook-form treats a dot in a field name as a **path**. Registering `shipTo.line1` produces nested
state — `{ shipTo: { line1 } }` — not a flat key. The code that turned form values back into arguments
read `values["shipTo.line1"]`, got `undefined`, and skipped it as empty.

Every address line was dropped. Checkout submitted an address containing nothing but its country default,
which had survived only because it came from a default rather than from typing.

Every layer was individually correct. The form rendered, the fields registered, the request sent, the
server responded. The bug lived in the assumption *between* two libraries, which is exactly where
integration bugs live and exactly where unit tests are not looking.

## The form that ate its own fields

Submit checkout without a city, and the server — correctly — drops empty values from what it echoes back.
The form rendered its sub-fields from whatever keys came back. So the city input **disappeared**, and
there was no way to ever supply one. The form had made itself impossible to complete.

An address now always offers its full set of lines regardless of what came back.

## Required fields that were only decoration

Fields showed an asterisk and the word "Required". Neither was real: `register(..., { required })` is
validation inside the form library and sets no DOM attribute, so there was no `aria-required` for a
screen reader to find. And the library's own validation errors were never rendered — so submitting an
incomplete form did *nothing at all*, with no message, and no explanation of why the button seemed dead.

## The notification stream that never came back

`EventSource` retries a dropped connection by itself, which is why nobody notices this. It gives up
permanently once the stream reaches `CLOSED` — which is what happens when the server restarts underneath
an open page.

There was no `onerror` handler. Restart the core with a tab open, and that tab was silently deaf to every
notification forever. No error, no indicator, nothing to notice until someone wondered why they had
stopped seeing updates.

## Four type errors nobody could see

`packages/ui` was excluded from the typechecker. Inside it, four instances of `unknown && <JSX>` — which
is both a type error and a rendering trap, because a field that happens to be `0` renders a literal "0"
rather than being skipped.

The typecheck script now covers both projects. That is the actual fix; the four corrections were a
consequence.

## What we take from it

Three of the seven were caught by **unit tests written afterwards**, not by clicking. That is the useful
observation. Once you know react-hook-form nests dotted names, you can test it in twelve lines with no
browser at all — and that test will still be there in a year, which a manual pass will not.

Clicking found the bugs. Tests are what keep them found. The UI now has both, and the browser pass is
headless so it can run where there is no screen.

The gap was never "we did not have tests". It was that the tests we had were all shaped like the engine,
and the engine was not where these lived.
