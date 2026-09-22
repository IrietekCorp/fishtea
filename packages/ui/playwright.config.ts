import { defineConfig, devices } from "@playwright/test";

/**
 * Headless by default, and deliberately not opinionated about who starts the stack.
 *
 * The walkthrough needs a core, a database and the Vite dev server — more than a `webServer` block can
 * honestly own — so `bun run e2e` (scripts/e2e.ts at the repo root) brings those up, checks them, and
 * skips with a reason when a prerequisite is missing. That matters because this has to be runnable in CI
 * on a machine with no browser and no display: a skip with an explanation is useful, a crash is not.
 *
 *   bun run e2e            headless, starting and stopping the stack
 *   bun run e2e --headed   watch it happen
 *   bun run e2e --ui       Playwright's inspector
 *
 * Extensions are the other reason this exists. Driving a developer's own browser means driving their
 * password manager too, which swallows keystrokes and blocks screenshots. Playwright launches a clean
 * profile with nothing installed in it.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.ts/,       // not *.spec.ts: `bun test` claims that pattern
  fullyParallel: false,               // one stack, one conversation trail: these must not interleave
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.FISHTEA_UI_URL ?? "http://localhost:5173",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
