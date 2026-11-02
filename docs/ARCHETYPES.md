# Archetypes

An archetype is a complete, runnable application (spec, calls, seed data, a walkthrough) plus an
**onboarding interview** (`onboard.json`) that turns it into a specific business. `fishtea new` copies it
and applies your answers.

They are starting points, not cages. Everything the archetype wrote is yours to edit, and
[the update machinery](versioning.html) knows the difference between a file you changed and one you did
not, so editing freely does not cost you future fixes.

| archetype | what it is | the interview asks about |
|---|---|---|
| `ecommerce` | A catalogue, cart, checkout, orders and reactions. Products come from local rows or from vendor feeds (mock, CSV, eBay, generic HTTP). | categories, what people shop by, fulfilment (stock / affiliate-only / both), shipping, tax, returns, which vendor feeds |
| `portfolio` | A person you can interview: skills, projects, experience, an interview bank with follow-ups, an honest assessment of fit, contact. | name, headline, summary, availability, skill areas, what visitors may ask for |
| `verification` | Employment verification: requester → consent → verifier attestation → disclosure limited to the purpose. | purposes served, consent TTL, retention, engagement kinds |
| `program` | A sessions-based program: find a session, register (multi-child, sibling discount, capacity, age rules), scholarships, device loans, schedule, FAQ. | price, discount, ages, capacity, hours, location, tracks, equipment |
| `blank` | One entity, one read shape, one write shape. | name, description, greeting |

```bash
fishtea templates          # names, descriptions, how many questions each asks
```

## How an answer lands

Most answers patch a path in the spec, an enum's vocabulary, or a field on a seed row. Some do more,
because a business decision has structural consequences:

- Telling `ecommerce` you are **affiliate-only** removes `addToCart`, `checkout`, `viewCart` and
  `orderStatus`, drops the `mid-purchase` persona and its greeting, prunes every `next` chip that pointed
  at a removed shape, and flips the product default to `affiliate`. The result is a coherent smaller
  application, not one with dead ends in it.
- Choosing vendor feeds keeps only the adapters you named in `seed/vendor.json`.
- Declining the sample catalogue empties the seed files but keeps the vocabulary ones.

## Making your own

An archetype is a directory under `templates/` with a `spec.json`, an `onboard.json`, and whatever
`calls/`, `seed/`, `rules/` and `scripts/` it needs. It can also be an [`archetype` plugin](plugins.html),
which is the same directory resolved from your application or from the framework.

Two things every archetype must satisfy, and the test suite checks both for all five: it derives,
migrates, seeds and runs its walkthrough on the same engine; and it scaffolds into a tracked application
that reconciles clean.
