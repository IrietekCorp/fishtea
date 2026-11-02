# ChicDuJour: a shop that owns no stock

[chicdujour.com](https://chicdujour.com) is a fashion and accessories shop you talk to. You say how you
feel, where you are going and what you can spend, and it comes back with pieces it can actually get you.
It holds no inventory, employs no merchandiser, and has no category pages, because it has no pages.

Five entities, nine shapes, twenty calls, three personas, one `spec.json`. What follows is the part worth
copying: the mechanisms the spec made available, and what each one replaced.

## A vocabulary declared once, read by four different things

The premise is that people shop by feeling before they shop by category. That makes "bold" and "soft"
part of the domain, so they are declared in the spec, under `rules.moods`:

```json
"bold": {
  "title": "Bold",
  "say": ["fierce", "loud", "main character", "statement", "fearless"],
  "tags": ["statement", "red", "print", "dopamine", "date night"],
  "energy": 9,
  "line": "Walk in like the room was waiting for you.",
  "queries": ["statement red dress", "bold print heels", "statement earrings"]
}
```

One block, four consumers, none of which know about each other:

- **`say`** are the words a visitor uses, so they become classifier hints. "I feel fierce" routes to
  `shopMood` with the mood already filled.
- **`tags`** are what the catalogue is actually searched by, which is a different vocabulary from the
  one people say and always has been. The translation between them is the declaration, not code.
- **`line`** is the copy at the top of the answer. Merchandising sits in the spec beside the thing it
  merchandises, which means it is reviewable by whoever owns the brand voice rather than deployable
  only by whoever owns the template.
- **`queries`** are what the vendor sync searches the marketplaces for overnight, so declaring a mood
  also declares what stock needs to exist for it.

Adding a mood is an edit to one object. Nothing else is touched, and the compute call that reads it
(`mood.expand`) never learns a mood's name. The spec's own note says it plainly: *nothing else decides
what a mood means.*

## The catalogue is a cache, and the vendors are rows

A `vendor` is an entity with an `adapter`, a `config`, a `commissionPct` and a `lastSyncAt`. The adapters
live in `calls/adapters/`: eBay, Amazon, CSV, generic HTTP, and a mock for tests. Adding a supplier is a
row, not a release.

`op.syncInventory` is an **operator shape**, which means it appears in `/admin` with its inputs and a Run
button and can carry a clock, for free, because it is declared the same way a visitor's shape is:

```json
"plan": [
  { "id": "v", "call": "vendors.list", "with": { "status": "active" } },
  { "id": "p", "call": "inventory.pull", "with": { "vendors": "$v", "query": "$query", "limit": "$limit" } }
]
```

`products_expire.sql` ages rows back out. So the catalogue is a cache with a refresh job and an eviction
policy, which is what an affiliate catalogue has always actually been. The difference is that here it is
two SQL files and a declared job rather than a cron script nobody has read since it was written.

## A stranger asking to save something gets a form, not an error

`react` (love, save, pass) is `"effect": "write"` and `"allow": ["known", "customer"]`. `becomeKnown` is
allowed to `stranger` and `known`.

A stranger who says "save this" is classified correctly, because the classifier proposes against the
tools the persona can see, and then the gate disposes. What they get is not a 403 and not a login wall
sitting in front of the shop: it is the `becomeKnown` form, in the conversation, at the moment the thing
they wanted required it. They fill it in and the save happens.

This is the whole argument for checking permission after classification rather than before. The system
knows what was wanted, so it can ask for exactly the thing that unblocks it.

`trending` then reads those reactions back, which means popularity on this site is what its own visitors
did, not a number a vendor supplied.

## The answer is allowed to end somewhere else

Every product carries an `affiliateUrl`. The honest shape of this business is that the best answer sends
you to eBay or Amazon to buy, and a conversation that pretends otherwise is lying about what it is.

Following that link is recorded as an **echo** against the turn whose answer offered it. It follows only
a URL the conversation actually published, so it is not an open redirect and needs no signing secret.
The business gets the one fact it genuinely needs, which is which answers sent people somewhere, without
the tracking apparatus usually bolted on to get it.

## Nothing in the framework knows what fashion is

The look is a `ui` plugin (`chicdujour`) and the navigation is the builtin `sections` shell reading
`rules.site`. The framework ships no mood slider, no lookbook component and no price badge that knows
about clothes. It ships seven vessels, and the design system supplies tokens.

That constraint is the reason this case study is worth anything: if a fashion shop had needed one
fashion-shaped component in the core, the next business would need its own, and the framework would
slowly become a worse version of five separate products.

## What it measures

`eval/classify.jsonl` holds 54 labelled utterances with a third of them refusals, which is the only
number about this site's classifier that its own spec could not derive. It is run with `fishtea eval`
and it is the thing to look at before anyone concludes the routing is fine.

## What to take from it

- **Declare the vocabulary your customers actually use.** If "bold" is a thing people say, it belongs in
  the spec, with the words, the tags, the copy and the sourcing query in one place.
- **A catalogue you do not own is a cache.** Model it as one: adapters as rows, refresh as a declared
  job, expiry as SQL.
- **Gate after you understand, not before.** A stranger who gets a form instead of a wall is the
  measurable difference between a conversation and a site with a conversation glued to it.
- **Let the answer leave.** Record the echo instead of pretending the visit ended where you wanted.
