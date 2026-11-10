# Contributing

FishTea is Apache-2.0. A contribution is accepted under the same licence (section 5 of `LICENSE`); there
is no separate agreement to sign.

## Getting it running

You need [Bun](https://bun.sh) at the version in `.bun-version`, and Docker for Postgres.

```bash
bun install
docker run -d --name fishtea-test-db -e POSTGRES_USER=fishtea -e POSTGRES_PASSWORD=fishtea \
  -e POSTGRES_DB=fishtea -p 5434:5432 pgvector/pgvector:0.8.7-pg18-trixie
bun test packages scripts     # needs the database above, on 5434
bun run typecheck
bun run release --check
```

That is what CI runs (`.github/workflows/ci.yml`). The test database is on 5434 on purpose: a test never
points at a running application, because some tests reload the classifier's tool set and would swap a
live application's tools out from under it.

## Before you open a pull request

- **Read `CLAUDE.md`.** Despite the name it is the build brief for anyone, and its *rules of the house*
  are the review checklist: the spec is the only source, SQL is parameterised and never string-built,
  permission is checked after classification, tests run against a real Postgres.
- **Measure, then claim.** A change to the classifier, its floor or its prompts comes with a
  `fishtea eval` run against a labelled set. `docs/DESIGN.md` is where measured deviations are recorded.
- **Prose is British English** (colour, behaviour, catalogue). Code identifiers, CLI flags and component
  names keep the spelling they already have.
- **Versions are written by one script.** Never edit a version number by hand: `bun run release <v>` is
  the only writer, and `bun run release --check` fails when any copy disagrees.

## Reporting a security problem

Not in an issue. See `SECURITY.md`.
