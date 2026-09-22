---
title: Two hashes, and why "regenerate it" is the wrong answer
date: 2026-09-22
summary: Scaffolding tools give you a great first day and abandon you on the second. Fixing that turned out to need one more hash per file than we first recorded.
author: Shawn J. Stewart
tags: versioning, design
---

Every scaffolding tool has the same second-day problem. It generates a beautiful starting point, you edit
it for three months, and then upstream fixes a bug in a file it gave you. Your options are to apply the
fix by hand forever, or to regenerate and lose your edits. Most tools pick a third option — pretending the
problem does not exist — and that is why "never eject" is such well-known advice.

We wanted an application to be able to take an upstream fix without touching a line its author wrote. The
mechanism turned out to be simple. Getting it *correct* took one more piece of information than we
recorded on the first attempt.

## The first attempt, and why it was wrong

The obvious design: when scaffolding an application, record a hash of every file. Later, compare.

- The hash matches what we recorded → you have not edited it → safe to update.
- It does not match → you edited it → leave it alone.

This is wrong, and the test that caught it was the very first end-to-end run. A freshly generated
application — untouched, seconds old — reported that `seed/vendor.json` needed updating.

The reason is that the scaffolder does not *copy* files. It **transforms** them. It filters seed rows
based on interview answers, rewrites fields, and strips whole shapes out of a spec when you say you are
affiliate-only. So the file in your directory legitimately differs from the file in the archetype from the
moment it is created. Recording one hash cannot tell "the archetype changed" apart from "the scaffolder
changed this on the way in" — and it guesses wrong on every transformed file, forever.

## Two hashes

The fix is to record both sides of the merge base:

```json
"calls/cart_add.sql": {
  "template": "9f2a…",   // what the archetype said
  "app":      "9f2a…"    // what we actually left in your directory
}
```

Two hashes, two independent questions: *has the archetype moved?* and *have you edited it?* That is an
ordinary three-way merge, and it produces five outcomes instead of two:

| archetype moved | you moved it | what happens |
|---|---|---|
| no | no | nothing |
| **yes** | no | updated in place |
| no | **yes** | left alone — yours, through every future release |
| **yes** | **yes** | conflict: your file stands, theirs lands beside it as `.new` |
| — | you deleted it | stays deleted; files are never resurrected |

The fourth row is the one that matters. A tool that silently resolves a genuine conflict is worse than one
that refuses to try, because you find out months later. FishTea writes the incoming version next to yours
and tells you.

## The termination bug

There is a trap in that design worth naming, because we walked into it.

Once a file conflicts, what clears the conflict? If you accept the incoming version by copying the `.new`
over your file, the merge base has not moved — so the *next* update reports the same conflict again, and
the one after that, forever.

The fix is a rule that sounds obvious once stated: **if your file is byte-identical to the archetype's,
there is nothing to reconcile, however it got that way.** Accept the `.new`, revert your edit, or happen to
make the same change upstream did — any of them ends it. Merely ignoring the `.new` does not, because
adopting it silently would lose your edit.

## Adoption, and refusing to guess

Applications created before any of this existed have no manifest. The temptation is to write one by
recording their current hashes — but that is actively dangerous. A file you edited two months ago would be
recorded as pristine, and the next upstream change would overwrite your work.

So adoption claims **only files that currently match the archetype exactly**. Everything else is left
unrecorded, which the reconciler reads as "yours" permanently. Adoption can under-claim; it can never
overwrite.

That trade is the right way round. The cost of under-claiming is an upstream fix you apply by hand. The
cost of over-claiming is losing someone's work silently.

## What it buys

An application pins a framework range, so most releases need no action at all — that is what a pin is
*for*, not ceremony but permission to do nothing. When something does need to move, `fishtea update`
shows the plan before it writes anything, and every framework version you have installed stays on disk so
`fishtea use <version>` puts it back.

Going back has to be as cheap as going forward. It is the only reason going forward is comfortable.

Details in [versioning and updates](../versioning.html).
