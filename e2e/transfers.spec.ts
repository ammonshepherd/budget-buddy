import { expect, test, type Page } from "@playwright/test";
import {
  activityRow,
  editActivityRow,
  goTo,
  openActivityMonth,
  signInWithHousehold,
} from "./helpers";

const file = (name: string, text: string) => ({
  name,
  mimeType: "text/csv",
  buffer: Buffer.from(text),
});

async function addAccount(page: Page, name: string, balance: string) {
  await goTo(page, "Accounts");
  await page.getByLabel("Account name").fill(name);
  await page.getByLabel("Opening balance").fill(balance);
  await page.getByLabel("Opening date").fill("2030-01-01");
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page.locator(".item", { hasText: name }).first()).toBeVisible();
}

/** Rows of the Activity page's Transactions list (not the review list). */
const items = (page: Page) =>
  page.getByRole("region", { name: "Transactions" }).locator(".activity-item");

/** The "Other side" a transfer's edit form has chosen. */
const otherSideChosen = (page: Page) =>
  page
    .getByRole("form", { name: "Edit transaction" })
    .getByLabel("Other side")
    .locator("option:checked");

async function importCsv(page: Page, account: string, name: string, text: string) {
  await goTo(page, "Settings");
  const card = page.getByRole("region", { name: "Import transactions" });
  await card.getByLabel("Account").selectOption({ label: account });
  await card.getByLabel("Bank CSV file").setInputFiles(file(name, text));
  await card.getByRole("button", { name: /^Import \d+ transactions?$/ }).click();
  await expect(card.getByRole("status")).toContainText(`into ${account}`);
}

test("marking an imported row as a Transfer links the other account's bank row", async ({
  page,
}) => {
  await signInWithHousehold(page);
  await addAccount(page, "Checking", "1000");
  await addAccount(page, "Savings", "0");
  // Made-up rows: the same $200 move as each bank reports it.
  await importCsv(
    page,
    "Checking",
    "checking.csv",
    "Date,Description,Amount\n01/05/2030,TRANSFER TO SAVINGS,-200.00",
  );
  await importCsv(
    page,
    "Savings",
    "savings.csv",
    "Date,Description,Amount\n01/06/2030,TRANSFER FROM CHECKING,200.00",
  );

  await openActivityMonth(page, "2030-01");
  const out = activityRow(page, "TRANSFER TO SAVINGS");
  await editActivityRow(page, "TRANSFER TO SAVINGS");
  const form = page.getByRole("form", { name: "Edit transaction" });
  await form.getByLabel("Envelope").selectOption({ label: "Transfer (not spending or income)" });
  await expect(form.getByLabel("To account")).toHaveValue(/.+/);
  await expect(form.getByRole("note")).toHaveText(
    "Links to the Savings transaction on 2030-01-06 (TRANSFER FROM CHECKING), so it is not added twice.",
  );
  await form.getByRole("button", { name: "Save changes" }).click();

  // One linked Transfer, shown once from its money-out side.
  await expect(items(page)).toHaveCount(1);
  await expect(out.locator(".activity-account")).toHaveText("Checking → Savings");
  await expect(out.locator(".activity-category")).toHaveText("Transfer");
  await expect(out.locator(".activity-amount")).toHaveText("$200.00");
  const into = activityRow(page, "TRANSFER FROM CHECKING");
  await expect(into).toHaveCount(0);

  // Neither side is spending or income.
  await page.goto("./#budget/2030-01");
  await expect(page.getByRole("region", { name: "Available to Assign" })).toContainText(
    "$1,000.00",
  );

  // Deleting one imported side keeps the other bank row, unlinked.
  page.on("dialog", (dialog) => dialog.accept());
  await openActivityMonth(page, "2030-01");
  await editActivityRow(page, "TRANSFER TO SAVINGS");
  await page.getByRole("button", { name: "Delete transfer" }).click();
  await expect(items(page)).toHaveCount(1);
  await expect(into).toContainText("Uncategorized");
});

test("a typed transfer edits and deletes as one", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await signInWithHousehold(page);
  await addAccount(page, "Checking", "1000");
  await addAccount(page, "Savings", "0");

  await goTo(page, "Activity");
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a transaction" });
  await dialog.getByRole("radio", { name: "Inflow" }).check();
  await dialog.getByLabel("Account").selectOption({ label: "Savings" });
  await dialog.getByLabel("Amount").fill("75");
  await dialog.getByLabel("Payee").fill("Move");
  await dialog.getByLabel("Envelope").selectOption({ label: "Transfer (not spending or income)" });
  await expect(dialog.getByLabel("From account")).toHaveValue(/.+/);
  await dialog.getByRole("button", { name: "Add transaction" }).click();

  // One row for both sides, opened at its money-out side.
  const move = activityRow(page, "Move");
  await expect(move).toHaveCount(1);
  await expect(move.locator(".activity-account")).toHaveText("Checking → Savings");
  await editActivityRow(page, "Move");
  const form = page.getByRole("form", { name: "Edit transaction" });
  await expect(form.getByRole("note")).toHaveText("Also updates the Savings side.");
  await form.getByLabel("Amount").fill("80");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(move.locator(".activity-amount")).toHaveText("$80.00");

  // Making one side ordinary spending removes the typed-in other side.
  await editActivityRow(page, "Move");
  await form.getByLabel("Envelope").selectOption({ label: "Uncategorized" });
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(items(page)).toHaveCount(1);
  await expect(move.locator(".activity-account")).toHaveText("Checking");
  await expect(move.locator(".activity-category")).toHaveText("Uncategorized");
  await expect(move.locator(".activity-amount")).toHaveText("−$80.00");
});

test("pick a different bank row, or a new transaction, as the other side", async ({ page }) => {
  await signInWithHousehold(page);
  await addAccount(page, "Checking", "1000");
  await addAccount(page, "Savings", "0");
  await importCsv(
    page,
    "Checking",
    "checking.csv",
    "Date,Description,Amount\n01/05/2030,TO SAVINGS,-200.00",
  );
  // Two made-up $200 rows: the closest is not the right one.
  await importCsv(
    page,
    "Savings",
    "savings.csv",
    "Date,Description,Amount\n01/06/2030,BIRTHDAY GIFT,200.00\n01/20/2030,FROM CHECKING,200.00",
  );

  await openActivityMonth(page, "2030-01");
  const out = activityRow(page, "TO SAVINGS");
  await editActivityRow(page, "TO SAVINGS");
  const form = page.getByRole("form", { name: "Edit transaction" });
  await form.getByLabel("Envelope").selectOption({ label: "Transfer (not spending or income)" });
  const otherSide = form.getByLabel("Other side");
  // The closest row is chosen first; the later one and "new" are offered.
  await expect(otherSide.locator("option:checked")).toHaveText(
    "2030-01-06 · BIRTHDAY GIFT · $200.00 (1 day later)",
  );
  await expect(otherSide.locator("option")).toHaveText([
    "2030-01-06 · BIRTHDAY GIFT · $200.00 (1 day later)",
    "2030-01-20 · FROM CHECKING · $200.00 (15 days later)",
    "Add a new transaction instead",
  ]);
  await otherSide.selectOption({ label: "2030-01-20 · FROM CHECKING · $200.00 (15 days later)" });
  await expect(form.getByRole("note")).toHaveText(
    "Links to the Savings transaction on 2030-01-20 (FROM CHECKING), so it is not added twice.",
  );
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(out.locator(".activity-account")).toHaveText("Checking → Savings");
  await expect(activityRow(page, "FROM CHECKING")).toHaveCount(0); // shown with its other side
  await expect(activityRow(page, "BIRTHDAY GIFT")).toContainText("Uncategorized");

  // Change it to a new transaction: the bank row goes back to Uncategorized.
  await editActivityRow(page, "TO SAVINGS");
  await expect(otherSide.locator("option:checked")).toHaveText(
    "Keep 2030-01-20 · FROM CHECKING · $200.00 (15 days later)",
  );
  await otherSide.selectOption({ label: "Add a new transaction instead" });
  await expect(form.getByRole("note")).toHaveText("Also adds the matching inflow in Savings.");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(activityRow(page, "FROM CHECKING")).toContainText("Uncategorized");
  await expect(out.locator(".activity-account")).toHaveText("Checking → Savings");
  // The transfer (once), BIRTHDAY GIFT and FROM CHECKING.
  await expect(items(page)).toHaveCount(3);
});

test("swap a typed-in side for the bank row that arrives later", async ({ page }) => {
  await signInWithHousehold(page);
  await addAccount(page, "Checking", "1000");
  await addAccount(page, "Savings", "0");

  await goTo(page, "Activity");
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a transaction" });
  await dialog.getByLabel("Amount").fill("50");
  await dialog.getByLabel("Payee").fill("Typed move");
  await dialog.getByLabel("Date").fill("2030-01-10");
  await dialog.getByLabel("Envelope").selectOption({ label: "Transfer (not spending or income)" });
  await expect(dialog.getByLabel("Other side")).toHaveCount(0); // nothing to choose yet
  await dialog.getByRole("button", { name: "Add transaction" }).click();

  await importCsv(
    page,
    "Savings",
    "savings.csv",
    "Date,Description,Amount\n01/11/2030,ONLINE TRANSFER,50.00",
  );
  await openActivityMonth(page, "2030-01");
  await editActivityRow(page, "Typed move");
  const form = page.getByRole("form", { name: "Edit transaction" });
  await expect(form.getByLabel("Other side").locator("option")).toHaveText([
    "Keep the side you typed in (updated to match)",
    "2030-01-11 · ONLINE TRANSFER · $50.00 (1 day later)",
  ]);
  await form.getByLabel("Other side").selectOption({ index: 1 });
  await form.getByRole("button", { name: "Save changes" }).click();

  // The typed-in Savings side is gone; the bank row is now the other side.
  await expect(items(page)).toHaveCount(1);
  await expect(activityRow(page, "Typed move").locator(".activity-account")).toHaveText(
    "Checking → Savings",
  );
  await editActivityRow(page, "Typed move");
  await expect(otherSideChosen(page)).toHaveText(
    "Keep 2030-01-11 · ONLINE TRANSFER · $50.00 (1 day later)",
  );
});
