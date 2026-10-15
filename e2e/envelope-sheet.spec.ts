import { expect, test, type Page } from "@playwright/test";
import {
  addGroupWithEnvelopes,
  addTransaction,
  available,
  editCell,
  envelope,
  goTo,
  openEnvelope,
  signInWithHousehold,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept()); // confirm() prompts
  await signInWithHousehold(page);
});

async function addAccount(page: Page, name: string, opening: string, card = false) {
  await goTo(page, "Accounts");
  const add = page.getByRole("form", { name: "Add an account" });
  if (card) await add.getByRole("radio", { name: "Credit card" }).check();
  await add.getByLabel("Account name").fill(name);
  await add.getByLabel(card ? "Amount owed on the opening date" : "Opening balance").fill(opening);
  await add.getByRole("button", { name: "Add account" }).click();
}

test("the sheet shows what is left, the plan and the month's transactions", async ({ page }) => {
  await addAccount(page, "Checking", "1000");
  await addGroupWithEnvelopes(page, "Weekly Basics", ["Groceries"]);
  await editCell(page, "Groceries", "assigned", "300");
  await editCell(page, "Groceries", "planned", "300");
  await addTransaction(page, { amount: "120", payee: "Market", envelope: "Groceries" });
  await goTo(page, "Budget");

  const sheet = await openEnvelope(page, "Groceries");
  await expect(sheet.locator(".sheet-eyebrow")).toHaveText("Weekly Basics");
  await expect(sheet.getByRole("heading", { name: "Groceries" })).toBeVisible();
  await expect(sheet.locator(".sheet-hero-amount")).toHaveText("$180.00");
  await expect(sheet.locator(".sheet-hero-parts")).toHaveText("$300.00 assigned − $120.00 spent");
  await expect(sheet.locator(".plan-line")).toHaveText(
    "Spent $120.00 of $300.00 planned$180.00 under",
  );
  const activity = sheet.getByRole("region", { name: "Groceries transactions" });
  await expect(activity.getByRole("listitem")).toHaveCount(1);
  await expect(activity.getByRole("listitem")).toContainText("Market");
  await expect(activity.getByRole("listitem")).toContainText("-$120.00");

  // Planned edits here too: Enter saves, and the page behind updates.
  const planned = sheet.getByLabel("Planned amount for Groceries");
  await expect(planned).toHaveValue("300.00");
  await planned.fill("100");
  await planned.press("Enter");
  await expect(sheet.locator(".plan-line")).toHaveText(
    "Spent $120.00 of $100.00 planned$20.00 over",
  );
  await expect(sheet.locator(".plan-line")).toHaveClass(/over/);

  // Escape undoes the typing without closing the sheet.
  await planned.fill("5");
  await planned.press("Escape");
  await expect(planned).toHaveValue("100.00");
  await expect(sheet).toBeVisible();

  // Assigned is checked as on the row: refused, the amount goes back.
  const assigned = sheet.getByLabel("Assigned amount for Groceries");
  await assigned.fill("5000");
  await assigned.press("Enter");
  await expect(sheet.getByRole("alert")).toHaveText("Only $700.00 available to assign.");
  await expect(assigned).toHaveValue("300.00");
  // Leaving the field saves.
  await assigned.fill("350");
  await sheet.getByRole("heading", { name: "Groceries" }).click();
  await expect(sheet.locator(".sheet-hero-amount")).toHaveText("$230.00");

  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
  await expect(envelope(page, "Groceries").locator(".envelope-remaining")).toHaveText("$230.00");
  await expect(available(page)).toContainText("$650.00");
});

test("Saved can be moved into Remaining from the sheet", async ({ page }) => {
  await addAccount(page, "Checking", "1000");
  await addGroupWithEnvelopes(page, "Often", ["Gifts"]);
  await editCell(page, "Gifts", "assigned", "50");

  // Nothing saved yet: a quiet panel, nothing to move.
  let sheet = await openEnvelope(page, "Gifts");
  const saved = sheet.getByRole("region", { name: "Saved" });
  await expect(saved).toContainText("Nothing saved yet");
  await expect(saved.getByRole("button", { name: "Move some into Remaining…" })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Close" }).click();

  // Next month the $50 is Saved.
  await page.getByRole("link", { name: "Next month" }).click();
  sheet = await openEnvelope(page, "Gifts");
  await expect(saved).toHaveClass(/^saved-panel$/);
  await expect(saved.locator(".saved-panel-amount")).toHaveText("$50.00");
  await expect(saved.locator('svg[aria-hidden="true"]')).toHaveCount(2);
  await saved.getByRole("button", { name: "Move some into Remaining…" }).click();
  const amount = saved.getByLabel("Amount to move into Remaining");
  await amount.fill("60");
  await saved.getByRole("button", { name: "Move", exact: true }).click();
  await expect(saved.getByRole("alert")).toHaveText("Only $50.00 is saved.");
  await amount.fill("20");
  await saved.getByRole("button", { name: "Move", exact: true }).click();
  await expect(saved.locator(".saved-panel-amount")).toHaveText("$30.00");
  await expect(sheet.locator(".sheet-hero-amount")).toHaveText("$20.00");
  await expect(sheet.locator(".sheet-hero-parts")).toHaveText(
    "$0.00 assigned + $20.00 released − $0.00 spent",
  );
  // Nothing planned this month.
  await expect(sheet.locator(".plan-line")).toHaveText("Spent $0.00 · nothing planned this month");
  // Moving Saved does not change Available to Assign.
  await expect(available(page)).toContainText("$950.00");
});

test("an envelope is deleted from its sheet", async ({ page }) => {
  await addAccount(page, "Checking", "100");
  await addGroupWithEnvelopes(page, "Everyday", ["Old", "Keep"]);
  const sheet = await openEnvelope(page, "Old");
  await sheet.getByRole("button", { name: "Delete envelope" }).click();
  await expect(sheet).toBeHidden();
  await expect(envelope(page, "Old")).toHaveCount(0);
  await expect(envelope(page, "Keep")).toBeVisible();
});

test("a card's payment envelope sheet shows what can be paid and takes assigning", async ({
  page,
}) => {
  await addAccount(page, "Checking", "1000");
  await addAccount(page, "Visa", "200", true);
  await goTo(page, "Budget");
  const sheet = await openEnvelope(page, "Visa payment");
  await expect(sheet.locator(".sheet-hero-label")).toHaveText("Available to pay");
  await expect(sheet.locator(".sheet-hero-parts")).toHaveText(
    "Owed $200.00 · Remaining debt $200.00",
  );
  await expect(sheet.getByRole("button", { name: "Delete envelope" })).toHaveCount(0);
  await sheet.getByLabel("Assign (negative to take back)").fill("150");
  await sheet.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(sheet.locator(".sheet-hero-amount")).toHaveText("$150.00");
  await expect(sheet.locator(".sheet-hero-parts")).toHaveText(
    "Owed $200.00 · Remaining debt $50.00",
  );
});
