import { expect, test } from "@playwright/test";
import {
  activityRow,
  addGroupWithEnvelopes,
  addTransaction,
  available,
  envelope,
  editActivityRow,
  editCell,
  openEnvelope,
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
  await editCell(page, "Groceries", "assigned", "300");
  await expect(available(page)).toContainText("$700.00");
  await expect(envelope(page, "Groceries").locator(".envelope-remaining")).toHaveText("$300.00");
  await editCell(page, "Fun", "assigned", "2000");
  await expect(envelope(page, "Fun").getByRole("alert")).toHaveText(
    /Only \$700\.00 available to assign/,
  );
  await editCell(page, "Fun", "assigned", "100");
  await expect(available(page)).toContainText("$600.00");

  // Spending within the envelope.
  await addTransaction(page, { amount: "50", payee: "Market", envelope: "Groceries" });
  await expect(activityRow(page, "Market")).toContainText("−$50.00");

  // Overspending: the cover prompt. Saved is 0 here, so Fun or Available to Assign covers it.
  await addTransaction(page, { amount: "400", payee: "Big shop", envelope: "Groceries" });
  const cover = page.getByRole("alertdialog");
  await expect(cover).toContainText("Groceries would be $150.00 short");
  await expect(cover.getByRole("option", { name: /Fun/ })).toHaveCount(0); // Fun has only $100
  await cover.getByLabel(/cover .* from/i).selectOption("available");
  await cover.getByRole("button", { name: "Cover and save" }).click();
  await expect(activityRow(page, "Big shop")).toContainText("−$400.00");

  // Uncategorized spending and a transfer.
  await addTransaction(page, { amount: "20", payee: "Coffee" });
  await expect(activityRow(page, "Coffee")).toContainText("Uncategorized");
  await goTo(page, "Accounts");
  await page.getByLabel("Account name").fill("Savings");
  await page.getByRole("button", { name: "Add account" }).click();
  // One entry records both sides: out of Checking, into Savings.
  await addTransaction(page, {
    amount: "5",
    payee: "To savings",
    envelope: "Transfer (not spending or income)",
  });
  // Activity shows the transfer once: from → to, unsigned.
  const transfer = activityRow(page, "To savings");
  await expect(transfer).toHaveCount(1);
  await expect(transfer).toContainText("Checking → Savings");
  await expect(transfer.locator(".activity-amount")).toHaveText("$5.00");

  // Budget: 1,000 − 300 − 100 − 150 (cover); the $20 coffee is still to review
  // and the transfer is neither spending nor income.
  await goTo(page, "Budget");
  await expect(available(page)).toContainText("$450.00");
  await expect(envelope(page, "Groceries").locator(".envelope-remaining")).toHaveText("$0.00");

  // Account balance = 1,000 − 50 − 400 − 20 − 5.
  await goTo(page, "Accounts");
  const account = (name: string) =>
    page.locator(".item").filter({ has: page.locator(".item-title", { hasText: name }) });
  await expect(account("Checking")).toContainText("$525.00");
  await expect(account("Savings")).toContainText("$5.00");

  // Next month: Fun's unspent $100 is now Saved, and the month is in the URL.
  await goTo(page, "Budget");
  // With nothing saved yet, the Saved pill is quiet (no sparkles).
  await expect(envelope(page, "Fun").locator(".saved-chip.sparkle")).toHaveCount(0);
  await expect(envelope(page, "Fun")).toContainText("Saved $0.00");
  await page.getByRole("link", { name: "Next month" }).click();
  await expect(page).toHaveURL(/#budget\/\d{4}-\d{2}$/);
  await expect(envelope(page, "Fun")).toContainText("Saved $100.00");
  // Saved stands out to encourage saving.
  await expect(envelope(page, "Fun").locator(".saved-chip.sparkle")).toBeVisible();
  await expect(envelope(page, "Fun").locator(".envelope-remaining")).toHaveText("$0.00");

  // Releasing Saved makes it spendable without changing Available to Assign.
  const sheet = await openEnvelope(page, "Fun");
  await sheet.getByRole("button", { name: "Move some into Remaining…" }).click();
  await sheet.getByLabel("Amount to move into Remaining").fill("40");
  await sheet.getByRole("button", { name: "Move", exact: true }).click();
  await expect(sheet.locator(".sheet-hero-amount")).toHaveText("$40.00");
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(envelope(page, "Fun").locator(".envelope-remaining")).toHaveText("$40.00");
  await expect(envelope(page, "Fun")).toContainText("Saved $60.00");
  await expect(available(page)).toContainText("$450.00");
});

test("edit and delete a transaction", async ({ page }) => {
  await page.getByRole("link", { name: "adding an account" }).click();
  await page.getByLabel("Account name").fill("Checking");
  await page.getByLabel("Opening balance").fill("100");
  await page.getByRole("button", { name: "Add account" }).click();

  await addTransaction(page, { amount: "12.5", payee: "Lunch" });
  const row = activityRow(page, "Lunch");
  await expect(row).toContainText("−$12.50");

  // Tapping the payee opens it for editing.
  await editActivityRow(page, "Lunch");
  const form = page.getByRole("form", { name: "Edit transaction" });
  await expect(form.getByLabel("Amount")).toHaveValue("12.50");
  await form.getByLabel("Amount").fill("15");
  await form.getByLabel("Memo").fill("with a friend");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(form).toHaveCount(0);
  await expect(row).toContainText("−$15.00");

  // Cancel leaves the row as it was.
  await editActivityRow(page, "Lunch");
  await expect(form.getByLabel("Memo")).toHaveValue("with a friend");
  await form.getByLabel("Amount").fill("99");
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(row).toContainText("−$15.00");

  await editActivityRow(page, "Lunch");
  await form.getByRole("button", { name: "Delete transaction" }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByText(/^No transactions in \w+ \d{4}\.$/)).toBeVisible();
});

test("an account can only be closed at a zero balance", async ({ page }) => {
  await page.getByRole("link", { name: "adding an account" }).click();
  await page.getByLabel("Account name").fill("Old bank");
  await page.getByLabel("Opening balance").fill("10");
  await page.getByRole("button", { name: "Add account" }).click();
  await page.locator(".item", { hasText: "Old bank" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit Old bank" });
  await sheet.getByRole("button", { name: "Close account" }).click();
  await expect(sheet.getByRole("alert")).toContainText("only a $0.00 account can be closed");

  // At $0.00 it closes: the sheet shuts and the account moves to Closed accounts.
  await sheet.getByLabel("Opening balance").fill("0");
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await page.locator(".item", { hasText: "Old bank" }).click();
  await sheet.getByRole("button", { name: "Close account" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("heading", { name: "Closed accounts" })).toBeVisible();
});
