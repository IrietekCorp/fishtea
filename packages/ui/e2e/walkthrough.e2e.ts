/**
 * The walkthrough, headless.
 *
 * This replaces the manual checklist that used to live in README.md here. It is written against what the
 * UI actually exposes — accessible names and roles — rather than against CSS, so it breaks when behaviour
 * changes and not when styling does.
 *
 * Every step below corresponds to a defect found the first time a human opened this interface. The three
 * marked REGRESSION are the ones that made the product unusable rather than merely ugly.
 */
import { test, expect, type Page } from "@playwright/test";

const say = async (page: Page, text: string) => {
  await page.getByLabel("Say what you're after").fill(text);
  await page.getByLabel("Send").click();
};

/** The engine collects arguments first and only then offers the write, so a write is two submits. */
const confirmWrite = async (page: Page) => {
  const review = page.getByRole("button", { name: /Review & confirm|^Confirm$/ });
  await review.first().click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog).toBeHidden();
};

test.beforeEach(async ({ page }) => {
  await page.context().clearCookies();                 // each test is a fresh visitor, and so a fresh trail
  await page.goto("/");
  await expect(page.getByRole("search")).toBeVisible();
});

test("a stranger is greeted with offers, not an empty box", async ({ page }) => {
  await expect(page.getByRole("banner").getByText("stranger", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Find products/i })).toBeVisible();
});

test("search pours a list, and the card shows the price rather than internal ids", async ({ page }) => {
  await say(page, "something bold for a wedding under 60");
  const answer = page.getByLabel("answer");
  await expect(answer).toBeVisible();

  // REGRESSION: cards used to render the first six fields in declaration order, so a shopper saw
  // vendorId, sourceId and a raw jsonb blob — and never the price, which is the tenth field.
  await expect(answer.getByText(/^Price$/).first()).toBeVisible();
  await expect(answer.getByText(/\$\d+\.\d{2}/).first()).toBeVisible();
  await expect(answer.getByText(/^Vendor Id$/)).toHaveCount(0);
  await expect(answer.getByText(/^Source Id$/)).toHaveCount(0);
  await expect(answer.getByText(/"colors"/)).toHaveCount(0);

  await expect(page.getByLabel("verify")).toContainText("findProducts");
  await expect(page.getByLabel("verify")).toContainText("read business.product");
});

test("a related-products chip pours a detail with its seed and its related set", async ({ page }) => {
  await say(page, "something bold for a wedding under 60");
  await page.getByRole("button", { name: /^More like / }).first().click();
  await expect(page.getByLabel("answer")).toContainText(/Seed/);
  await expect(page.getByLabel("answer")).toContainText(/Related/);
});

test("becoming known is a write: it confirms first, then the persona moves", async ({ page }) => {
  await say(page, "save my email so we can keep this conversation");
  await page.getByLabel(/^Email/).fill("e2e@example.com");
  await page.getByRole("button", { name: "Answer" }).click();

  await confirmWrite(page);
  await expect(page.getByLabel("verify")).toContainText("wrote business.customer");

  // Persona is evaluated when a request starts, so it moves on the *next* turn, not this one.
  await say(page, "what's popular");
  // Scoped to the banner: "customer" also appears in the verify strip ("calls customer.upsert").
  await expect(page.getByRole("banner").getByText("customer", { exact: true })).toBeVisible();
});

test("a required field is announced, and an empty submit says why", async ({ page }) => {
  await say(page, "save my email so we can keep this conversation");
  const email = page.getByLabel(/^Email/);
  // REGRESSION: `register(..., {required})` is form-library validation and sets no DOM attribute, so the
  // asterisk in the label was invisible to assistive technology.
  await expect(email).toHaveAttribute("aria-required", "true");

  await email.fill("");
  await page.getByRole("button", { name: "Answer" }).click();
  // REGRESSION: the library blocked submission and rendered nothing, so the button looked dead.
  await expect(page.getByText("Required").first()).toBeVisible();
});

test("checkout keeps every address line, and submits all of them", async ({ page }) => {
  await say(page, "save my email so we can keep this conversation");
  await page.getByLabel(/^Email/).fill("e2e@example.com");
  await page.getByRole("button", { name: "Answer" }).click();
  await confirmWrite(page);

  await say(page, "add p_coral_hoops to my cart");
  await confirmWrite(page);
  await expect(page.getByLabel("verify")).toContainText("wrote business.cart");

  await page.getByRole("button", { name: /Check out/ }).click();
  await expect(page.getByLabel(/Ship To · Line 1/)).toBeVisible();   // humanised, not "line1"

  // REGRESSION: submitting with one line blank made that input vanish for good, because sub-fields were
  // rendered from whatever keys the server echoed back and the server drops empty values.
  await page.getByLabel(/Ship To · Name/).fill("E2E Person");
  await page.getByRole("button", { name: "Answer" }).click();
  await expect(page.getByLabel(/Ship To · City/)).toBeVisible();

  for (const [label, value] of [
    [/Ship To · Line 1/, "12 Example Way"], [/Ship To · City/, "Leeds"],
    [/Ship To · Region/, "West Yorkshire"], [/Ship To · Postal/, "LS1 1AA"],
    [/^Email/, "e2e@example.com"],
  ] as const) await page.getByLabel(label).fill(value);

  await page.getByRole("button", { name: "Answer" }).click();
  await confirmWrite(page);

  // REGRESSION: the form library nests dotted field names, so every address line was dropped and the
  // order went out with nothing but a country default. If that returns, this write never lands.
  await expect(page.getByLabel("verify")).toContainText("wrote business.order");
  await expect(page.getByLabel("answer")).toContainText(/ord_/);
});

test("an order's timeline renders events that carry no title", async ({ page }) => {
  await say(page, "save my email so we can keep this conversation");
  await page.getByLabel(/^Email/).fill("e2e@example.com");
  await page.getByRole("button", { name: "Answer" }).click();
  await confirmWrite(page);
  await say(page, "add p_coral_hoops to my cart");
  await confirmWrite(page);
  await page.getByRole("button", { name: /Check out/ }).click();
  for (const [label, value] of [
    [/Ship To · Name/, "E2E Person"], [/Ship To · Line 1/, "12 Example Way"], [/Ship To · City/, "Leeds"],
    [/Ship To · Region/, "West Yorkshire"], [/Ship To · Postal/, "LS1 1AA"], [/^Email/, "e2e@example.com"],
  ] as const) await page.getByLabel(label).fill(value);
  await page.getByRole("button", { name: "Answer" }).click();
  await confirmWrite(page);

  await page.getByRole("button", { name: /Track order/ }).click();
  const timeline = page.getByLabel("timeline");
  await expect(timeline).toBeVisible();
  await expect(timeline).toContainText("placed");
  // These events have `status` and `note` but no `title`; a stray "0" here means a falsy guard regressed.
  await expect(timeline).not.toContainText(/^0$/);
});

test("the trail rewinds, and a new utterance branches from there", async ({ page }) => {
  await say(page, "something bold for a wedding under 60");
  await say(page, "what's popular");
  await page.getByRole("button", { name: /^trail ·/ }).click();

  const rewind = page.getByRole("button", { name: /rewind to turn 2/ });
  await expect(rewind).toBeVisible();
  await rewind.click();

  await say(page, "something playful for a festival");
  await expect(page.getByLabel("answer")).toContainText(/playful/i);
  // The original is still in the trail: a branch adds, it does not replace.
  await expect(page.getByLabel("trail")).toContainText("what's popular");
});

test("reloading resumes the conversation rather than starting one", async ({ page }) => {
  await say(page, "something bold for a wedding under 60");
  await expect(page.getByLabel("verify")).toContainText("findProducts");
  await page.reload();
  // A fresh visit would pour the greeting `ask`; resuming pours the turn we were on.
  await expect(page.getByLabel("verify")).toContainText("findProducts");
  await expect(page.getByLabel("answer")).toBeVisible();
});

/**
 * A composite that arrives in pieces.
 *
 * The scaffolded application does not compose anything, so this drives the engine's streaming path the
 * only way a browser can see it: the spec is patched through the operator surface, the page reloads to
 * pick it up, and the test watches the second part appear *after* the first answer is already on screen.
 */
test("a composite streams: the lead answers, then the part arrives over SSE", async ({ page, request }) => {
  const core = process.env.FISHTEA_E2E_CORE_URL ?? "http://localhost:3111";
  const token = process.env.FISHTEA_OPERATOR_TOKEN ?? "change-me";
  const op = { "x-fishtea-operator": token, "content-type": "application/json" };
  const read = await request.get(`${core}/op/spec`, { headers: op });
  test.skip(!read.ok(), `operator surface unavailable (${read.status()})`);
  const { spec } = await read.json();

  // Edit the section the way the console does, and let the core's spec watcher reload it.
  const patched = await request.post(`${core}/op/utter`, {
    headers: op,
    data: { shape: "op.editSection", args: { section: "shapes", patch: { findProducts: { ...spec.shapes.findProducts, compose: ["trending"] } } } },
  });
  test.skip(!patched.ok(), `section edit unavailable (${patched.status()})`);

  // Wait for the effect, not for a guess at how long it takes. Writing spec.json also trips the core's
  // file watcher, so there is a second reload in flight behind the one the edit awaited, and a fixed
  // sleep raced it — this test passed alone and failed in a full run for exactly that reason.
  await expect.poll(async () => {
    const r = await request.get(`${core}/op/spec`, { headers: op });
    if (!r.ok()) return null;
    return (await r.json()).spec.shapes.findProducts.compose ?? null;
  }, { timeout: 15_000, message: "the core never picked up the composing shape" }).toEqual(["trending"]);

  await page.reload();
  // Wait for the page to have *resumed*, not merely painted. The SSE subscription is created once the
  // visitor is known, and uttering before that means the parts are published to nobody: the search box
  // appears well before any of that has happened.
  await expect(page.getByRole("banner").getByText("stranger", { exact: true })).toBeVisible();
  await expect(page.getByRole("search")).toBeVisible();
  await say(page, "something bold for a wedding under 60");

  // The lead is on screen while the part is still being planned; then it lands without a reload.
  const answers = page.getByLabel("answer").first();
  await expect(answers).toBeVisible();
  await expect(page.locator('section[aria-label="trending"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/still coming/)).toBeHidden();

  // Both parts are attributed separately in the verify strip — a composite stays inspectable.
  await expect(page.locator('[aria-label="verify"]')).toHaveCount(2);
});
