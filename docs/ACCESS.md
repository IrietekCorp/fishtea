# Access control: where the gate goes

**Short answer: on the call, after classification. Never on needle.**

The classifier is a router. It decides *what you probably meant*. It must never decide *what you are
allowed to do*, and FishTea already puts the gate in the right place: `packages/core/src/engine.ts`,
where both paths converge.

## Why needle cannot be the guard

Three reasons, and any one of them is sufficient.

**The chip path does not go through it.** The client can post `{shape, args}` directly, which is what a
next chip is, and what a forged chip would be. Nothing is classified. If the only thing keeping a
stranger out of `checkout` were its absence from a tool list, a single `curl` would walk straight past
it.

**The text is the attacker's.** Everything needle sees is what somebody typed. Prompt injection against
a small tool-calling model is not exotic; it is the expected case. A router that can be talked into
choosing a different tool is a router, not a guard, and treating it as one means an authorisation bug
that arrives as a jailbreak.

**The classifier can now be a plugin.** Since the second plugin pass, an application can supply its own
`Classifier`. That is somebody else's code returning shape names on the request path. It is safe
*precisely because* nothing downstream trusts what it returns.

## What tool filtering is actually for

The engine still filters the tool list by persona before classifying, via `allowedShapes(spec, persona)`,
and that remains worth doing, for reasons that are not security:

- **Accuracy.** A smaller tool list is an easier choice, and the prompt is mostly tool JSON.
- **Latency.** Same reason. Needle's cost scales with what it has to read.
- **Not dangling what you cannot have.** A stranger should not be offered a checkout chip.
- **Defence in depth**, which counts only because it is the second layer and not the first.

## The layers, as they stand today

Every one of these is in the code now.

| # | layer | where | what it stops |
|---|---|---|---|
| 1 | persona derived from identity | `persona.ts`, from the visitor's `customer_id` and the trail | none |
| 2 | tool list filtered | `engine.ts` before `classify` | the model suggesting what you cannot have |
| 3 | **shape gate** | `engine.ts`, `!allowed.includes(shapeName)` | **a classified *or posted* shape this persona may not ask** |
| 4 | operator shapes refused | same place, `shapeName.startsWith("op.")` | the operator surface being reached from the visitor surface |
| 5 | argument validation | zod, derived from the shape's declared input | malformed or extra arguments |
| 6 | parameterised SQL | `$1..$n`, never string-built | SQL injection |
| 7 | **row scoping** | the call's own SQL: `WHERE … AND visitor_id = $2` | reading somebody else's row with a guessed id |
| 8 | confirm-write | the engine, always, before any write | a write nobody agreed to |

Layer 3 is the important one and it is one line. Both the classified path and the posted-shape path
reach it, which is the whole design: **there is one gate, and it is downstream of everything that can
be influenced.**

Layer 7 is the one a business has to get right itself, per call. The archetype does:

```sql
-- $1 orderId, $2 visitorId — scoped to the visitor; someone else's order id yields no row
```

Shape-level permission answers *may you ask this kind of question*. Only the SQL can answer *is this row
yours*, and no amount of classification or gating substitutes for it.

## The real problem is not authorisation. It is authentication.

The permission model above is sound. What it rests on is not, and this is the finding worth acting on.

`visitorOf` in `http.ts` accepts the visitor id from the `x-fishtea-visitor` header **or** the cookie,
and `ensureVisitor` hands back that visitor's `customer_id`, hence their persona, their cart, their
orders. **The visitor id is a bearer credential.** Whoever presents one is that visitor.

Until this was written down, that credential was minted as `Date.now()` plus six characters of
`Math.random()`. The time half is public. The random half is neither long enough nor unpredictable:
`Math.random()` is a PRNG whose internal state can be recovered from a small number of its own outputs,
and an attacker can produce outputs on demand simply by asking for new visitors.

**Fixed**: ids now take 96 bits from the platform CSPRNG. Existing ids keep working; only new ones
change. `packages/core/test/core.test.ts` asserts the length, because the regression that matters is an
id short enough to guess.

### What is still open

- **The credential is unsigned.** A forged id is rejected only because it is not in the table. Signing
  the cookie with a server secret would reject it without a database lookup, and would make a stolen id
  revocable.
- **The SPA keeps it in `localStorage`** and sends it as a header, so the `httpOnly` cookie is not
  really the credential and XSS can read it. That is a deliberate trade for a cross-origin SPA, but it
  should be a decision rather than an accident: same-site cookie plus a CSRF token is the alternative.
- **Identifier and credential are the same string.** They should probably not be. A visitor id shows up
  in operator views (`/op/visitors`), in logs, and, unavoidably, **in a URL**: EventSource cannot set
  request headers, so `/events?visitor=…` is the browser's only way to identify itself on the stream.
  That puts a bearer credential in access logs and browser history. Splitting the identifier from the
  credential would fix it properly; a short-lived stream token would fix it cheaply.
- ~~**Operator auth is one shared token.**~~ **Done.** People sign in at `/admin`: argon2id passwords,
  a session token stored as a hash in an httpOnly SameSite=Strict cookie, a first password that must be
  replaced before anything else opens, lockout after five wrong attempts, and `x-fishtea-admin` on any
  cookie'd change. `FISHTEA_OPERATOR_TOKEN` remains the *script* door for the TUI and `fishtea notify`,
  and a new application gets a random one rather than a shared constant. See
  [Running it](operating.html#admin).
- **Signing up proves nothing about the address.** With no email verification, a password sign-up for an
  email that already has a customer row (from a checkout, a `becomeKnown`, an operator's reset) becomes
  that customer. The fix is verification, which needs an email service; until then Google, which does
  verify, is the safer door. Google no longer keeps a password it did not vouch for: joining such an
  account removes it and ends its sessions. [Running it](operating.html#visitor-accounts) has the detail.
- **The rate limiter is in-memory per process**, so it does not survive a restart or bind across
  replicas. It counts the client's real address now ([Running it](operating.html#limits)), not the
  leftmost `X-Forwarded-For` the client writes, and visitor ids alongside it.

## If you add roles

The persona expression language reads `identity` and trail facts. Roles would be a column on the
customer entity surfaced through `Engine.identity()`, then `verifier: { when: "identity.roles has
'verifier'" }`, which needs a `has` operator the language does not have yet (already noted under the
verification archetype).

The thing to resist is putting roles anywhere the classifier can see them. A role is an input to
`allowedShapes`, which runs before and after classification. It is not something a shape asks for and
never something a model is told about.

## The rule

> The classifier proposes. The gate disposes. The database has the last word.

Filtering what needle sees is worth doing and proves nothing. The shape gate is the boundary. Row
ownership is the SQL's job and only the SQL's. And a write is confirmed regardless of how confidently
anything upstream decided it was wanted.
