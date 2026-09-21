// Playwright walkthrough (needs a running stack; run with `bunx playwright test` after `bunx playwright install chromium`).
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const UI = process.env.FISHTEA_UI_URL ?? "http://localhost:5173";

test("stranger → find → outfit → known → cart → checkout → timeline", async ({ page }) => {
  await page.goto(UI);
  await expect(page.getByRole("search")).toBeVisible();
  const axeOk = async () => { const r = await new AxeBuilder({ page }).analyze(); expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]); };
  await axeOk();
  await page.getByLabel("Say what you're after").fill("something bold for a wedding under 60");
  await page.getByLabel("Send").click();
  await expect(page.getByLabel("answer")).toContainText(/records/);
  await axeOk();
  await page.getByRole("button", { name: /Build an outfit/ }).first().click();
  await expect(page.getByText(/Completes/)).toBeVisible();
  await page.getByRole("button", { name: /Save your email/ }).click();
  await page.getByLabel(/Email/).fill("pw@example.com");
  await page.getByRole("button", { name: /Review & confirm/ }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("customer")).toBeVisible();
  await page.getByLabel("Say what you're after").fill("add p_pearl_drop to my cart");
  await page.getByLabel("Send").click();
  await page.getByRole("button", { name: /Review & confirm|Confirm/ }).first().click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("mid-purchase")).toBeVisible();
  await page.getByRole("button", { name: /Check out/ }).click();
  await page.getByLabel(/Email/).fill("pw@example.com");
  for (const [k, v] of Object.entries({ name: "PW", line1: "1 Main", city: "Austin", region: "TX", postal: "78701" })) await page.getByLabel(new RegExp(k, "i")).fill(v);
  await page.getByRole("button", { name: /Review & confirm/ }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText(/Order ord_/)).toBeVisible();
  await page.getByRole("button", { name: /Track order/ }).click();
  await expect(page.getByLabel("timeline")).toBeVisible();
  await axeOk();
});
