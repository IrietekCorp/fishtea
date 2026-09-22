# The browser walkthrough

```bash
bun run e2e                  # headless: brings the stack up, runs, tears it down
bun run e2e --headed         # watch it happen
bun run e2e --ui             # Playwright's inspector
bun run e2e --keep           # leave the stack running afterwards
bun run e2e --no-stack       # drive something already running
```

`scripts/e2e.ts` scaffolds a throwaway ecommerce application into a temp directory, migrates and seeds it
against `FISHTEA_E2E_DATABASE_URL`, starts the core on :3111 and the browser bundle on :5199, runs
`walkthrough.e2e.ts`, and cleans up.

It uses the **lexical** classifier on purpose. That is a development harness rather than production, which
is exactly what a UI walkthrough wants: deterministic routing, so a failure means the interface changed
and never that a model had a bad day.

## It skips rather than fails

The walkthrough needs a database and a browser binary, and it has to be safe to run where there is
neither — CI on a headless box, a container with no display, a checkout where nobody ran `playwright
install`. In all of those it **skips with a reason and exits 0**:

```
⚠ skipped: no Playwright chromium in /home/you/.cache/ms-playwright
  cd packages/ui && bunx playwright install chromium
```

A skip is not a pass and says so loudly, but it does not fail a pipeline that was never able to run it.
Set `PLAYWRIGHT_BROWSERS_PATH` if your image pins browsers outside `$HOME`.

## First-time setup

```bash
cd packages/ui && bunx playwright install chromium

docker exec fishtea-test-db psql -U fishtea -d fishtea -c 'CREATE DATABASE fishteae2e'
docker exec fishtea-test-db psql -U fishtea -d fishteae2e -c 'CREATE EXTENSION IF NOT EXISTS vector'
```

`--with-deps` needs sudo and is not required on a machine that already runs a browser.

## Why Playwright rather than a real browser session

Driving a developer's own browser means driving their extensions too. A password manager attaches to text
inputs, swallows keystrokes and blocks screenshots — which is how the first manual pass ended. Playwright
launches a clean profile with nothing in it, and it runs without a display.

## What it covers

Nine tests, each anchored to a defect found the first time a human opened this interface. Three are marked
`REGRESSION` in the source: the card that never showed a price, the checkout that submitted an empty
address, and the form that ate its own fields.

Not yet covered: **accessibility**. `@axe-core/playwright` is installed and unused. Adding an `axe` pass
per vessel is the obvious next step, along with keyboard-only navigation and focus-order assertions.

## Environment

| variable | default |
|---|---|
| `FISHTEA_E2E_DATABASE_URL` | `postgres://fishtea:fishtea@localhost:5434/fishteae2e` |
| `FISHTEA_E2E_CORE_PORT` | `3111` |
| `FISHTEA_E2E_UI_PORT` | `5199` |
| `FISHTEA_UI_URL` | set by the runner; used directly with `--no-stack` |
