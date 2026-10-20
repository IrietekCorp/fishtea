/**
 * The Fishtea menu, against its acceptance criteria (docs/design/fishtea-menu-v1/SPEC.md §9, items 3–8;
 * 1 and 2 — the Ask tab and the rooms — left the component after v1), and what changed since.
 *
 * The menu on its own: menu-harness.html renders it with the v1 prototype's linen-shop data and records
 * what it calls back on `window.menuCalls`. It needs only the Vite dev server, not the core:
 *
 *   FISHTEA_UI_URL=http://localhost:5180 bunx playwright test menu
 *
 * Items 9 and 10 (both themes on tokens alone; no layout shift at 375/768/1280) are judged by eye from
 * screenshots, and the token half of 9 by a grep: fishtea-menu.css holds no colour literals.
 */
import { test, expect, type Page } from "@playwright/test";

const open = (page: Page, query = "") => page.goto(`/menu-harness.html${query}`);
const calls = (page: Page) => page.evaluate(() => (window as any).menuCalls as { name: string; arg?: unknown }[]);
const input = (page: Page) => page.locator(".ft-menu__input");
const toggle = (page: Page) => page.locator(".ft-menu__toggle");
const drawer = (page: Page) => page.locator(".ft-menu__drawer");
const pills = (page: Page) => page.locator(".ft-menu__pill");

test.describe("1, 2 · No Ask tab, no rooms (since v1)", () => {
  test("the component is the prompt and the trail; navigation is the application's", async ({ page }) => {
    await open(page);
    await expect(page.locator(".ft-menu nav, .ft-menu a")).toHaveCount(0);
    await expect(input(page)).toHaveAttribute("aria-label", "Ask anything");
  });
});

test.describe("3 · Placeholder and suggestions", () => {
  test("rotates only while empty and unfocused", async ({ page }) => {
    await open(page);
    const ph = () => input(page).getAttribute("placeholder");
    const first = await ph();
    expect(first).toMatch(/^Ask anything — /);
    await page.waitForTimeout(3500);
    const second = await ph();
    expect(second).not.toBe(first);
    await input(page).focus();
    await page.waitForTimeout(3500);
    expect(await ph()).toBe(second);
  });
  test("a chip fills the input without submitting, and the chips go once there is text", async ({ page }) => {
    await open(page);
    const chips = page.locator(".ft-menu__suggestion");
    await expect(chips).toHaveCount(3);
    const text = await chips.first().innerText();
    await chips.first().click();
    await expect(input(page)).toHaveValue(text);
    await expect(input(page)).toBeFocused();
    expect(await calls(page)).toEqual([]);
    await expect(chips).toHaveCount(0);
  });
});

test.describe("4 · Send", () => {
  test("idle, charged with text, stop while busy; Enter submits trimmed text and clears", async ({ page }) => {
    await open(page);
    const send = page.locator(".ft-menu__send");
    await expect(send).toHaveAttribute("data-state", "idle");
    await input(page).fill("  where is my order?  ");
    await expect(send).toHaveAttribute("data-state", "charged");
    await input(page).press("Enter");
    expect(await calls(page)).toEqual([{ name: "submit", arg: "where is my order?" }]);
    await expect(input(page)).toHaveValue("");
    await expect(page.getByRole("button", { name: "Stop" })).toHaveAttribute("data-state", "busy");
    await page.getByRole("button", { name: "Stop" }).click();
    expect((await calls(page)).at(-1)).toEqual({ name: "stop" });
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  });
  test("blank text sends nothing", async ({ page }) => {
    await open(page);
    await input(page).fill("   ");
    await input(page).press("Enter");
    expect(await calls(page)).toEqual([]);
  });
});

test.describe("5 · Trail toggle", () => {
  test("+ Trail n opens into a tab: × Close, square-bottomed bar", async ({ page }) => {
    await open(page);
    await expect(toggle(page)).toHaveAttribute("aria-label", "Open the trail");
    await expect(toggle(page)).toContainText("Trail");
    await expect(page.locator(".ft-menu__count")).toHaveText("4");
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(toggle(page)).toHaveAttribute("aria-label", "Close the trail");
    await expect(toggle(page)).toContainText("Close");
    await page.waitForTimeout(500);
    const turned = await page.locator(".ft-menu__plus").evaluate((el) => getComputedStyle(el).transform);
    expect(turned).not.toBe("none");
    expect(await page.locator(".ft-menu__bar").evaluate((el) => getComputedStyle(el).borderBottomLeftRadius)).toBe("0px");
  });
  test("is disabled with no turns", async ({ page }) => {
    await open(page, "?empty");
    await expect(toggle(page)).toBeDisabled();
  });
});

test.describe("6 · Drawer", () => {
  test("overlays without shifting layout, and closes on toggle, Esc, an outside press and rewind", async ({ page }) => {
    await open(page);
    const height = () => page.locator(".ft-menu").evaluate((el) => el.getBoundingClientRect().height);
    const before = await height();
    await toggle(page).click();
    await expect(drawer(page)).toBeVisible();
    expect(await height()).toBe(before);
    expect(await drawer(page).evaluate((el) => getComputedStyle(el).position)).toBe("absolute");

    await toggle(page).click();
    await expect(drawer(page)).toBeHidden();

    await toggle(page).click();
    await pills(page).first().focus();
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toBeHidden();
    await expect(toggle(page)).toBeFocused();

    await toggle(page).click();
    await page.mouse.click(5, 700);
    await expect(drawer(page)).toBeHidden();
  });
});

test.describe("7 · Pills", () => {
  test("the current is solid ink; hover shows the card; arrows move between pills", async ({ page }) => {
    await open(page, "?open");
    const current = page.locator('.ft-menu__pill[aria-current="step"]');
    await expect(current).toHaveCount(1);
    const ink = await page.evaluate(() => { const p = document.createElement("p"); p.style.color = "var(--ft-ink)"; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; });
    expect(await current.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(ink);

    await pills(page).nth(1).hover();
    const card = page.locator(".ft-menu__card").nth(1);
    await expect(card).toHaveAttribute("data-show", "true");
    await expect(card).toContainText("Turn 2");
    await expect(card).toContainText("Rewind here");
    // since v1: the card holds while the pointer crosses onto it, and goes when it leaves both
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + 30, box.y - 6, { steps: 4 });
    await page.mouse.move(box.x + 30, box.y + 40, { steps: 4 });
    await expect(card).toHaveAttribute("data-show", "true");
    await page.mouse.move(5, 700);
    await expect(card).not.toHaveAttribute("data-show", "true");

    await pills(page).first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(pills(page).nth(1)).toBeFocused();
    await page.keyboard.press("End");
    await expect(pills(page).last()).toBeFocused();
    await page.keyboard.press("Home");
    await expect(pills(page).first()).toBeFocused();
  });
});

test.describe("8 · Rewind", () => {
  test("a past pill rewinds once and closes; the current one does nothing", async ({ page }) => {
    await open(page, "?open");
    await pills(page).last().click();
    expect(await calls(page)).toEqual([]);
    await pills(page).nth(1).click();
    expect(await calls(page)).toEqual([{ name: "rewind", arg: "t2" }]);
    await expect(drawer(page)).toBeHidden();
  });
  test("the card's Rewind here rewinds too", async ({ page }) => {
    await open(page, "?open");
    await pills(page).nth(1).hover();
    const card = page.locator(".ft-menu__card").nth(1);
    await expect(card).toHaveAttribute("data-show", "true");
    await card.getByRole("button", { name: "Rewind here" }).click();
    expect(await calls(page)).toEqual([{ name: "rewind", arg: "t2" }]);
    await expect(drawer(page)).toBeHidden();
  });
  test("on touch, the first tap previews and the second rewinds", async ({ browser }) => {
    const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await open(page, "?open");
    await pills(page).nth(0).tap();
    await expect(page.locator(".ft-menu__card").nth(0)).toHaveAttribute("data-show", "true");
    expect(await calls(page)).toEqual([]);
    await pills(page).nth(0).tap();
    expect(await calls(page)).toEqual([{ name: "rewind", arg: "t1" }]);
    await ctx.close();
  });
});

test.describe("Corners (since v1)", () => {
  test("follow --ft-radius: rounded by default, flat at 0, pills included", async ({ page }) => {
    await open(page, "?open");
    // this is FishTea's own derivation; a brand that sets the pill radius itself (piscopour does) opts out
    const pill = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ft-radius-pill"));
    test.skip(!pill.includes("1000"), `a brand sets --ft-radius-pill (${pill.trim()})`);
    const radius = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(await radius(".ft-menu__bar")).not.toBe("0px");
    await page.evaluate(() => document.documentElement.style.setProperty("--ft-radius", "0px"));
    await page.waitForTimeout(400); // the bar eases its corners (160ms); read them at rest
    for (const sel of [".ft-menu__bar", ".ft-menu__pill", ".ft-menu__send", ".ft-menu__suggestion"]) expect(await radius(sel)).toBe("0px");
  });
});

test.describe("Focus (since v1)", () => {
  test("no ring on the bar or the input; the prompt mark pulses at one rate, and focus only changes its colour", async ({ page, browser }) => {
    await open(page);
    const mark = page.locator(".ft-menu__prompt");
    const look = () => mark.evaluate((el) => ({ animation: getComputedStyle(el).animationName, duration: getComputedStyle(el).animationDuration, color: getComputedStyle(el).color }));
    const focus = await page.evaluate(() => { const p = document.createElement("p"); p.style.color = "var(--ft-focus)"; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; });
    await expect(mark).toHaveText("/");
    const standby = await look();
    expect(standby.animation).toBe("ft-pulse");
    expect(standby.color).not.toBe(focus);

    await input(page).click();
    await expect(input(page)).toBeFocused();
    await page.waitForTimeout(300); // the colour eases over 200ms
    const focused = await look();
    expect({ animation: focused.animation, duration: focused.duration }).toEqual({ animation: standby.animation, duration: standby.duration });
    expect(focused.color).toBe(focus);
    expect(await input(page).evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("none");
    expect(await page.locator(".ft-menu__bar").evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("none");

    // tab on: the mark dulls again, and the next control keeps its ring
    await page.keyboard.press("Tab");
    await page.waitForTimeout(300);
    expect((await look()).color).toBe(standby.color);
    expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).toBe("solid");

    const still = await browser.newPage({ reducedMotion: "reduce" });
    await open(still);
    expect(await still.locator(".ft-menu__prompt").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await still.close();
  });
});
