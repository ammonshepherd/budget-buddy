import { expect, test } from "@playwright/test";
import {
  addGroupWithEnvelopes,
  addTransaction,
  available,
  envelope,
  envelopeAction,
  goTo,
  signInWithHousehold,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept()); // confirm() prompts
  await signInWithHousehold(page);
});

test("add an account, envelopes, assign, spend, and cover a shortfall", async ({ page }) => {
  // Account: its opening balance becomes money to assign.
  await page.getByRole("link", { name: "adding an account" }).click();
  await page.getByLabel("Account name").fill("Checking");
  await page.getByLabel("Opening balance").fill("1,000");
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page.locator(".item", { hasText: "Checking" })).toContainText("$1,000.00");

  // Group and envelopes.
  await goTo(page, "Budget");
  await expect(available(page)).toContainText("$1,000.00");
  await addGroupWithEnvelopes(page, "Everyday", ["Groceries", "Fun"]);

  // Assign, and the block when Available to Assign is insufficient.
  await envelopeAction(page, "Groceries", "Assign (negative to take back)", "300");
  await expect(available(page)).toContainText("$700.00");
  await expect(envelope(page, "Groceries").locator(".envelope-remaining")).toHaveText("$300.00");
  await envelopeAction(page, "Fun", "Assign (negative to take back)", "2000");
  await expect(envelope(page, "Fun").getByRole("alert")).toHaveText(
    /Only \$700\.00 is available to assign/,
  );
  await envelopeAction(page, "Fun", "Assign (negative to take back)", "100");
  await expect(available(page)).toContainText("$600.00");

  // Spending within the envelope.
  await addTransaction(page, { amount: "50", payee: "Market", envelope: "Groceries" });
  await expect(page.locator(".item", { hasText: "Market" })).toContainText("-$50.00");

  // Overspending: the cover prompt. Saved is 0 here, so Fun or Available to Assign covers it.
  await addTransaction(page, { amount: "400", payee: "Big shop", envelope: "Groceries" });
  const cover = page.getByRole("alertdialog");
  await expect(cover).toContainText("Groceries would be $150.00 short");
  await expect(cover.getByRole("radio", { name: /Fun/ })).toHaveCount(0); // Fun has only $100
  await cover.getByRole("radio", { name: /Available to Assign/ }).check();
  await cover.getByRole("button", { name: "Cover and save" }).click();
  await expect(page.locator(".item", { hasText: "Big shop" })).toContainText("-$400.00");

  // Uncategorized spending and a transfer.
  await addTransaction(page, { amount: "20", payee: "Coffee" });
  await expect(page.locator(".item", { hasText: "Coffee" })).toContainText("Uncategorized");
  await goTo(page, "Accounts");
  await page.getByLabel("Account name").fill("Savings");
  await page.getByRole("button", { name: "Add account" }).click();
  // One entry records both sides: out of Checking, into Savings.
  await addTransaction(page, {
    amount: "5",
    payee: "To savings",
    envelope: "Transfer (not spending or income)",
  });
  const sides = page.locator(".item", { hasText: "To savings" });
  await expect(sides).toHaveCount(2);
  await expect(sides.filter({ hasText: "Transfer to Savings" })).toContainText("-$5.00");
  await expect(sides.filter({ hasText: "Transfer from Checking" })).toContainText("$5.00");

  // Budget: 1,000 − 300 − 100 − 150 (cover) − 20 (uncategorized); transfer ignored.
  await goTo(page, "Budget");
  await expect(available(page)).toContainText("$430.00");
  await expect(envelope(page, "Groceries").locator(".envelope-remaining")).toHaveText("$0.00");

  // Account balance = 1,000 − 50 − 400 − 20 − 5.
  await goTo(page, "Accounts");
  const account = (name: string) =>
    page.locator(".item").filter({ has: page.locator(".item-title", { hasText: name }) });
  await expect(account("Checking")).toContainText("$525.00");
  await expect(account("Savings")).toContainText("$5.00");

  // Next month: Fun's unspent $100 is now Saved, and the month is in the URL.
  await goTo(page, "Budget");
  await page.getByRole("link", { name: "Next month" }).click();
  await expect(page).toHaveURL(/#budget\/\d{4}-\d{2}$/);
  await expect(envelope(page, "Fun")).toContainText("Saved $100.00");
  await expect(envelope(page, "Fun").locator(".envelope-remaining")).toHaveText("$0.00");

  // Releasing Saved makes it spendable without changing Available to Assign.
  await envelopeAction(page, "Fun", "Release from Saved", "40");
  await expect(envelope(page, "Fun").locator(".envelope-remaining")).toHaveText("$40.00");
  await expect(envelope(page, "Fun")).toContainText("Saved $60.00");
  await expect(available(page)).toContainText("$430.00");
});

test("edit and delete a transaction", async ({ page }) => {
  await page.getByRole("link", { name: "adding an account" }).click();
  await page.getByLabel("Account name").fill("Checking");
  await page.getByLabel("Opening balance").fill("100");
  await page.getByRole("button", { name: "Add account" }).click();

  await addTransaction(page, { amount: "12.5", payee: "Lunch" });
  const row = page.locator(".item", { hasText: "Lunch" });
  await expect(row).toContainText("-$12.50");

  // Editing happens in the row itself.
  await row.getByRole("button", { name: "Edit" }).click();
  const form = page.getByRole("form", { name: "Edit transaction" });
  await expect(form.getByLabel("Amount")).toHaveValue("12.50");
  await form.getByLabel("Amount").fill("15");
  await form.getByLabel("Memo").fill("with a friend");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(form).toHaveCount(0);
  await expect(row).toContainText("-$15.00");
  await expect(row).toContainText("with a friend");

  // Cancel leaves the row as it was.
  await row.getByRole("button", { name: "Edit" }).click();
  await form.getByLabel("Amount").fill("99");
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(row).toContainText("-$15.00");

  await row.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".item", { hasText: "Lunch" })).toHaveCount(0);
  await expect(page.getByText("No transactions yet.")).toBeVisible();
});

test("an account can only be closed at a zero balance", async ({ page }) => {
  await page.getByRole("link", { name: "adding an account" }).click();
  await page.getByLabel("Account name").fill("Old bank");
  await page.getByLabel("Opening balance").fill("10");
  await page.getByRole("button", { name: "Add account" }).click();
  await page
    .locator(".item", { hasText: "Old bank" })
    .getByRole("button", { name: "Close" })
    .click();
  await expect(page.getByRole("alert")).toContainText("only a $0.00 account can be closed");
});
