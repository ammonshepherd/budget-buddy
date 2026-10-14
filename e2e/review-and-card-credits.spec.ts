import { expect, test } from "@playwright/test";
import {
  addGroupWithEnvelopes,
  available,
  envelope,
  envelopeAction,
  goTo,
  openAddTransaction,
  signInWithHousehold,
} from "./helpers";

test("giving envelopes, covering and refunds move Available to Assign as expected", async ({
  page,
}) => {
  await signInWithHousehold(page);
  await goTo(page, "Accounts");
  await page.getByLabel("Account name").fill("Checking");
  await page.getByLabel("Opening balance").fill("500");
  await page.getByRole("button", { name: "Add account" }).click();
  await addGroupWithEnvelopes(page, "Everyday", ["Groceries"]);
  await envelopeAction(page, "Groceries", "Assign (negative to take back)", "100");
  await expect(available(page)).toContainText("$400.00");
  const groceries = envelope(page, "Groceries");

  // Issue 1: an Uncategorized purchase waits for review; giving it an envelope
  // takes it from that envelope and leaves Available to Assign alone.
  let dialog = await openAddTransaction(page);
  await dialog.getByLabel("Amount").fill("30");
  await dialog.getByLabel("Payee").fill("Market");
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(available(page)).toContainText("$400.00");
  await expect(page.getByText("1 transaction to review ($0.00 in, $30.00 out)")).toBeVisible();
  await goTo(page, "Activity");
  await page
    .getByRole("region", { name: "Transactions" })
    .locator(".item", { hasText: "Market" })
    .click();
  const edit = page.getByRole("dialog", { name: "Edit transaction" });
  await edit.getByLabel("Envelope").selectOption({ label: "Groceries" });
  await edit.getByRole("button", { name: "Save changes" }).click();
  await goTo(page, "Budget");
  await expect(available(page)).toContainText("$400.00");
  await expect(groceries.locator(".envelope-remaining")).toHaveText("$70.00");

  // Issue 3: covering from Available to Assign lowers it by the cover and adds
  // that to the envelope's Assigned.
  dialog = await openAddTransaction(page);
  await dialog.getByLabel("Amount").fill("150");
  await dialog.getByLabel("Payee").fill("Big shop");
  await dialog.getByLabel("Envelope").selectOption({ label: "Groceries" });
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  const cover = dialog.getByRole("alertdialog");
  await expect(cover).toContainText("Groceries would be $80.00 short");
  await cover.getByRole("radio", { name: /Available to Assign/ }).check();
  await cover.getByRole("button", { name: "Cover and save" }).click();
  await expect(available(page)).toContainText("$320.00");
  await expect(groceries).toContainText("Assigned $180.00");
  await expect(groceries.locator(".envelope-remaining")).toHaveText("$0.00");

  // Issue 2: a refund into an envelope adds to it, with no prompt, and leaves
  // Available to Assign alone.
  dialog = await openAddTransaction(page);
  await dialog.getByRole("radio", { name: "Inflow" }).check();
  await dialog.getByLabel("Amount").fill("10");
  await dialog.getByLabel("Payee").fill("Refund");
  await dialog.getByLabel("Envelope").selectOption({ label: "Groceries" });
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(dialog).toBeHidden();
  await expect(groceries.locator(".envelope-remaining")).toHaveText("$10.00");
  await expect(available(page)).toContainText("$320.00");
  // The refund cancels out part of this month's spending: $180 − $10 = $170.
  await expect(groceries).toContainText("Spent $170.00");
  // Closed, the row shows only what's left, Planned and Saved; tapping shows the rest.
  const summary = groceries.locator("summary");
  await expect(summary).toContainText("Planned $0.00");
  await expect(summary).not.toContainText("Assigned");
  await expect(summary).not.toContainText("Spent");
  const details = groceries.getByLabel("This month");
  await expect(details).toBeHidden();
  await summary.click();
  await expect(details).toBeVisible();
  await expect(details).toHaveText("Assigned $180.00Spent $170.00");
});

test("money into a credit card is a card credit that only lowers what is owed", async ({
  page,
}) => {
  await signInWithHousehold(page);
  await goTo(page, "Accounts");
  await page.getByLabel("Account name").fill("Checking");
  await page.getByLabel("Opening balance").fill("500");
  await page.getByRole("button", { name: "Add account" }).click();
  const add = page.getByRole("form", { name: "Add an account" });
  await add.getByRole("radio", { name: "Credit card" }).check();
  await add.getByLabel("Account name").fill("Visa");
  await add.getByLabel("Amount owed on the opening date").fill("200");
  await add.getByRole("button", { name: "Add account" }).click();

  await goTo(page, "Budget");
  const dialog = await openAddTransaction(page);
  await dialog.getByLabel("Account").selectOption({ label: "Visa" });
  await dialog.getByRole("radio", { name: "Inflow" }).check();
  // Only a card credit or a payment (Transfer) is offered.
  await expect(dialog.getByLabel("Envelope").locator("option")).toHaveText([
    "Card credit (lowers what you owe)",
    "Transfer (not spending or income)",
  ]);
  await dialog.getByLabel("Amount").fill("30");
  await dialog.getByLabel("Payee").fill("Returned shoes");
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(dialog).toBeHidden();

  // No prompt, nothing to review, Available to Assign unchanged; Visa owes less.
  await expect(available(page)).toContainText("$500.00");
  await expect(page.getByText("to review")).toHaveCount(0);
  const payment = envelope(page, "Visa payment");
  await expect(payment.locator(".envelope-remaining")).toHaveText("$0.00");
  await expect(payment).toContainText("Remaining debt $170.00");
  await goTo(page, "Activity");
  await expect(
    page
      .getByRole("region", { name: "Transactions" })
      .locator(".item", { hasText: "Returned shoes" }),
  ).toContainText("Visa · Card credit");
});
