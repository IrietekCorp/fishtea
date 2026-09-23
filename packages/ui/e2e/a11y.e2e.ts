/**
 * The accessibility pass, headless.
 *
 * Two kinds of check, because they catch different things and neither subsumes the other.
 *
 *   axe        the machine-checkable rules — contrast, names, roles, landmarks, duplicate ids. Fast and
 *              literal. It cannot tell you whether an interface is usable, only whether it is malformed.
 *   keyboard   whether you can actually get through a turn with no pointer at all: reach the input,
 *              send, reach the chips a pour offers, open a write and escape it. axe has nothing to say
 *              about any of that, and it is the part a keyboard or screen-reader user lives in.
 *
 * Every vessel is scanned in the state that produces it, not on an empty page — a form's problems are in
 * its fields and a confirm's are in its dialog, and neither exists until a conversation reaches them.
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const say = async (page: Page, text: string) => {
  await page.getByLabel("Say what you're after").fill(text);
  await page.getByLabel("Send").click();
};

/**
 * Scan what is on screen and attach the violations to the report.
 *
 * Scoped to the application root: the Vite dev server injects its own overlay, and failing our build on
 * somebody else's markup would be noise. Serious rules only — `best-practice` is opinion, and a suite
 * that cries about opinion gets switched off.
 */
async function scan(page: Page, label: string) {
  // Wait for the pour to land before measuring it.
  //
  // `.pour-enter` animates opacity 0 → 1 over 220ms, and axe composites whatever opacity is in effect
  // when it looks. Scanning mid-pour reported 53 contrast failures at #918d89/3.15:1 — a colour that is
  // in no stylesheet, because it is muted-foreground (#68625e, a comfortable 5.9:1) part-way through
  // fading in. The resting state is what anyone actually reads, so that is the state to judge.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"), null, { timeout: 5_000 });

  const { violations } = await new AxeBuilder({ page })
    .include("#root")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const summary = violations.map((v) =>
    `${v.impact}: ${v.id} — ${v.help} (${v.nodes.length}×)\n      ${v.nodes[0].target.join(" ")}\n      ${v.nodes[0].failureSummary?.split("\n").join("\n      ")}`);
  expect({ label, violations: summary }).toEqual({ label, violations: [] });
}

test.beforeEach(async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/");
  await expect(page.getByRole("search")).toBeVisible();
});

// ---- axe, one vessel at a time -----------------------------------------------------------------------

test("the greeting is clean", async ({ page }) => {
  await expect(page.getByRole("button", { name: /Find products/i })).toBeVisible();
  await scan(page, "greeting");
});

test("a list of results is clean", async ({ page }) => {
  await say(page, "something bold for a wedding under 60");
  await expect(page.getByLabel("answer").first()).toBeVisible();
  await scan(page, "list");
});

test("a detail with its related set is clean", async ({ page }) => {
  await say(page, "something bold for a wedding under 60");
  await expect(page.getByLabel("answer").first()).toBeVisible();
  await page.getByRole("button", { name: /related|more like/i }).first().click();
  await expect(page.getByLabel("answer").first()).toBeVisible();
  await scan(page, "detail");
});

test("a form is clean, and every field is named", async ({ page }) => {
  await say(page, "remember me, my email is ada@example.com");
  const form = page.locator("form:not([role='search'])").first();
  await expect(form).toBeVisible();

  // A field whose only label is a styled <div> passes the eye and fails a screen reader. axe checks the
  // accessible name exists; this checks it is not the empty string dressed up as one.
  for (const input of await form.locator("input, textarea, select").all()) {
    const name = await input.evaluate((el) => {
      const id = el.getAttribute("aria-label") ?? document.querySelector(`label[for="${el.id}"]`)?.textContent;
      return (id ?? "").trim();
    });
    expect({ field: await input.getAttribute("name"), named: name.length > 0 }).toEqual({ field: await input.getAttribute("name"), named: true });
  }
  await scan(page, "form");
});

test("the confirm dialog is clean", async ({ page }) => {
  await say(page, "remember me, my email is ada@example.com");
  await page.getByRole("button", { name: /Review & confirm|^Confirm$/ }).first().click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await scan(page, "confirm");
});

test("a timeline is clean", async ({ page }) => {
  await say(page, "remember me, my email is ada@example.com");
  await page.getByRole("button", { name: /Review & confirm|^Confirm$/ }).first().click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog).toBeHidden();
  await say(page, "where are my orders");
  await expect(page.getByLabel("answer").first()).toBeVisible();
  await scan(page, "timeline");
});

// ---- keyboard only ------------------------------------------------------------------------------------

test("a whole turn works with no pointer at all", async ({ page }) => {
  // The input is autofocused, which is right for a conversation: the first thing you do is talk.
  await expect(page.getByLabel("Say what you're after")).toBeFocused();

  await page.keyboard.type("something bold for a wedding under 60");
  await page.keyboard.press("Enter");                       // a search form submits on Enter, no reaching for Send
  await expect(page.getByLabel("answer").first()).toBeVisible();

  // Every chip the pour offers has to be reachable by Tab. Walk forward and collect what we land on;
  // if a chip is a <div> with an onClick it will never appear here, which is exactly the bug to catch.
  const reached: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const el = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      return a && a !== document.body ? { tag: a.tagName.toLowerCase(), name: (a.getAttribute("aria-label") ?? a.textContent ?? "").trim().slice(0, 40) } : null;
    });
    if (!el) break;
    reached.push(`${el.tag}:${el.name}`);
  }
  expect(reached.length).toBeGreaterThan(2);

  // Nothing focusable may be invisible: a tab stop you cannot see is a keyboard user lost on the page.
  const offscreen = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])")]
      .filter((el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true")
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width === 0 || r.height === 0; })
      .map((el) => el.tagName.toLowerCase() + ":" + (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)));
  expect(offscreen).toEqual([]);
});

test("a write can be reached, refused and escaped from the keyboard", async ({ page }) => {
  await say(page, "remember me, my email is ada@example.com");
  const review = page.getByRole("button", { name: /Review & confirm|^Confirm$/ }).first();
  await review.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();

  // Focus must move into the dialog. If it stays behind, a keyboard user is typing into a page they
  // cannot see past an overlay — and the next Tab takes them somewhere the dialog has covered up.
  await expect(dialog.locator(":focus")).toBeVisible();

  // And it must stay there. Twenty tabs is more stops than the dialog has, so a leak shows up as focus
  // landing on something outside it.
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }

  // Escape is how you refuse a write without performing it. A confirm you can only accept is a trap.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Say what you're after")).toBeVisible();
});

test("each pour is announced, once, in a live region", async ({ page }) => {
  const live = page.locator("[aria-live='polite']");
  await expect(live).toHaveCount(1);                         // two polite regions talk over each other

  await say(page, "something bold for a wedding under 60");
  await expect(page.getByLabel("answer").first()).toBeVisible();
  await expect(live).not.toBeEmpty();                        // a silent pour is a pour a screen reader missed
});
