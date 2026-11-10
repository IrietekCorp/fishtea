# Security

## Reporting a vulnerability

Report it privately, never in a public issue. Either open a private advisory on GitHub (the repository's
**Security** tab, then **Report a vulnerability**) or email **shawn@irietek.com**.

Say what you found, the version (`fishtea version`), and the smallest thing that reproduces it. You will
hear back within three working days. A fix ships as a patch release, and the advisory names you unless you
would rather it did not.

## Supported versions

The newest minor release gets fixes. An application moves to it with `fishtea update`, which is a
three-way merge and is meant to be routine (docs/VERSIONING.md).

## What FishTea promises

These are the properties a report is most useful against. Each one is enforced in code and tested, so a
way around any of them is a vulnerability rather than a feature request.

- **Permission is checked after classification.** The classifier proposes a shape; the gate decides
  whether the asking persona may have it (`packages/core/src/engine.ts`). Filtering the classifier's
  tools is for accuracy and latency, never for access.
- **Row ownership is the call's own SQL** (`AND visitor_id = $n`). SQL is always parameterised
  (`$1..$n` in declared input order); nothing string-builds a query.
- **A visitor id is a bearer credential**, minted from the CSPRNG.
- **Writes are confirmed before they happen.** Every `write` shape pours `confirm-write` first.
- **Operators sign in, and nothing about running the application is public.** argon2id passwords,
  hashed session tokens in an httpOnly SameSite=Strict cookie, a first password that must be changed
  before anything else opens, lockout, and a required `x-fishtea-admin` header on any change made with
  the cookie. Scripts use `FISHTEA_OPERATOR_TOKEN`.
- **An echo follows only a URL the conversation published**, so `/echo` is not an open redirect.

## Out of scope

- The Vite dev server (`bun run dev`, the `ui` service in the development compose). It is a
  development tool and is not what production serves.
- The lexical classifier, which is a development harness and benchmark baseline.
- Denial of service that needs more traffic than a single application's rate limits allow. A request
  that costs the server far more than it costs the sender is in scope.
