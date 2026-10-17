import { expect, test, type Page } from "@playwright/test";
import {
  activityRow,
  addGroupWithEnvelopes,
  editCell,
  goTo,
  openActivityMonth,
  openAddTransaction,
  signInWithHousehold,
  chooseEnvelope,
} from "./helpers";

async function addAccount(page: Page, name: string, opening: string) {
  await goTo(page, "Accounts");
  const add = page.getByRole("form", { name: "Add an account" });
  await add.getByLabel("Account name").fill(name);
  await add.getByLabel("Opening balance").fill(opening);
  await add.getByLabel("Opening date", { exact: true }).fill("2030-01-01");
  await add.getByRole("button", { name: "Add account" }).click();
}

async function add(
  page: Page,
  tx: { payee: string; amount: string; date: string; envelope?: string; inflow?: boolean },
) {
  const dialog = await openAddTransaction(page);
  if (tx.inflow) await dialog.getByRole("radio", { name: "Inflow" }).check();
  await dialog.getByLabel("Amount").first().fill(tx.amount);
  await dialog.getByLabel("Payee").fill(tx.payee);
  await dialog.getByLabel("Date").fill(tx.date);
  if (tx.envelope) await chooseEnvelope(dialog.getByLabel("Envelope").first(), tx.envelope);
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(dialog).toBeHidden();
}

/** A $30 split: $10 to the first envelope, the rest to the second. */
async function addSplit(page: Page, payee: string, date: string, first: string, second: string) {
  const dialog = await openAddTransaction(page);
  await dialog.getByLabel("Amount").first().fill("30");
  await dialog.getByLabel("Payee").fill(payee);
  await dialog.getByLabel("Date").fill(date);
  await chooseEnvelope(dialog.getByLabel("Envelope").first(), first);
  await dialog.getByLabel("Envelope").first().selectOption({ label: "Split across envelopes" });
  await dialog.getByLabel("Amount 1").fill("10");
  await chooseEnvelope(dialog.getByLabel("Envelope 2"), second);
  await dialog.getByRole("button", { name: "Put the rest in the last line" }).click();
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(dialog).toBeHidden();
}

const totals = (page: Page) => page.getByRole("definition");

test.beforeEach(async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await signInWithHousehold(page);
});

test("a month's transactions by day, with totals and day nets", async ({ page }) => {
  await addAccount(page, "Main Checking", "500");
  await addAccount(page, "Savings", "0");
  await goTo(page, "Budget");
  await addGroupWithEnvelopes(page, "Everyday", ["Groceries"]);
  await page.evaluate(() => (location.hash = "#budget/2030-01"));
  await editCell(page, "Groceries", "assigned", "100");

  await add(page, { payee: "Coffee", amount: "5", date: "2030-01-02" });
  await add(page, { payee: "Kroger", amount: "20", date: "2030-01-03", envelope: "Groceries" });
  await add(page, {
    payee: "Paycheck",
    amount: "250",
    date: "2030-01-03",
    inflow: true,
    envelope: "Income (to Available to Assign)",
  });
  await add(page, {
    payee: "To savings",
    amount: "40",
    date: "2030-01-04",
    envelope: "Transfer (not spending or income)",
  });
  await add(page, { payee: "Next month", amount: "7", date: "2030-02-01" });

  await openActivityMonth(page, "2030-01");
  await expect(page.locator(".budget-month")).toContainText("January 2030");
  // In excludes transfers; Out is spending; the transfer counts once.
  await expect(totals(page)).toHaveText(["+$250.00", "−$25.00", "$40.00"]);

  // Newest day first, each with its net (transfers left out).
  const list = page.getByRole("region", { name: "Transactions" });
  await expect(list.getByRole("heading", { level: 2 })).toHaveText([
    "Fri Jan 4",
    "Thu Jan 3",
    "Wed Jan 2",
  ]);
  await expect(list.locator(".activity-day-head span")).toHaveText(["$0.00", "+$230.00", "−$5.00"]);

  // Rows: payee over account, the envelope, and the signed amount.
  const kroger = activityRow(page, "Kroger");
  await expect(kroger.locator(".activity-account")).toHaveText("Main Checking");
  await expect(kroger.locator(".activity-category")).toHaveText("Groceries");
  await expect(kroger.locator(".activity-amount")).toHaveText("−$20.00");
  await expect(kroger.locator(".activity-amount")).toHaveCSS("color", "rgb(30, 26, 36)");
  const pay = activityRow(page, "Paycheck");
  await expect(pay.locator(".activity-category")).toHaveText("Income");
  await expect(pay.locator(".activity-amount")).toHaveText("+$250.00");
  await expect(pay.locator(".activity-amount")).toHaveCSS("color", "rgb(31, 107, 66)");
  // A transfer once, From → To, unsigned and grey.
  const transfer = activityRow(page, "To savings");
  await expect(transfer).toHaveCount(1);
  await expect(transfer.locator(".activity-account")).toHaveText("Main Checking → Savings");
  await expect(transfer.locator(".activity-category")).toHaveText("Transfer");
  await expect(transfer.locator(".activity-amount")).toHaveText("$40.00");
  await expect(transfer.locator(".activity-amount")).toHaveCSS("color", "rgb(106, 97, 117)");
  // Still to review: the amber label.
  await expect(activityRow(page, "Coffee").locator(".badge-uncategorized")).toHaveText(
    "Uncategorized",
  );
  // Typed transactions have not been seen by the bank yet.
  await expect(kroger.getByRole("img", { name: "Uncleared" })).toBeVisible();
  // Another month's transaction is not listed.
  await expect(activityRow(page, "Next month")).toHaveCount(0);

  // The next month reloads the list and the totals.
  await page.getByRole("link", { name: "Next month" }).click();
  await expect(page).toHaveURL(/#activity\/2030-02$/);
  await expect(totals(page)).toHaveText(["$0.00", "−$7.00", "$0.00"]);
  await expect(activityRow(page, "Next month")).toBeVisible();
  await expect(activityRow(page, "Kroger")).toHaveCount(0);

  // An empty month: a message and zero totals.
  await page.getByRole("link", { name: "Next month" }).click();
  await expect(page.getByText("No transactions in March 2030.")).toBeVisible();
  await expect(totals(page)).toHaveText(["$0.00", "$0.00", "$0.00"]);
});

test("tapping the payee opens the transaction to edit or delete", async ({ page }) => {
  await addAccount(page, "Checking", "500");
  await add(page, { payee: "Lunch", amount: "12", date: "2030-01-02" });
  await openActivityMonth(page, "2030-01");

  // Rows have no Edit or Delete links; the payee cell is the button.
  const list = page.getByRole("region", { name: "Transactions" });
  await expect(list.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
  await list.getByRole("button", { name: "Edit Lunch, −$12.00, Checking" }).click();
  const edit = page.getByRole("dialog", { name: "Edit transaction" });
  await expect(edit.getByLabel("Payee")).toHaveValue("Lunch");
  await edit.getByRole("button", { name: "Delete transaction" }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText("No transactions in January 2030.")).toBeVisible();
});

test("splits open with their parts and close one at a time", async ({ page }) => {
  await addAccount(page, "Checking", "500");
  await goTo(page, "Budget");
  await addGroupWithEnvelopes(page, "Everyday", ["Groceries", "Kids"]);
  await page.evaluate(() => (location.hash = "#budget/2030-01"));
  await editCell(page, "Groceries", "assigned", "100");
  await editCell(page, "Kids", "assigned", "100");
  await addSplit(page, "Target", "2030-01-05", "Kids", "Groceries");
  await addSplit(page, "Costco", "2030-01-04", "Groceries", "Kids");
  await add(page, { payee: "February shop", amount: "1", date: "2030-02-01" });

  await openActivityMonth(page, "2030-01");
  const target = activityRow(page, "Target");
  const costco = activityRow(page, "Costco");
  // Open by default, with each part's envelope and amount; counted once.
  const pill = target.getByRole("button", { name: "Close split for Target" });
  await expect(pill).toHaveText("Split (2)");
  await expect(pill).toHaveAttribute("aria-expanded", "true");
  await expect(target.locator(".activity-portion")).toHaveText([
    "↳ KidsKids−$10.00",
    "↳ GroceriesGroceries−$20.00",
  ]);
  await expect(totals(page).nth(1)).toHaveText("−$60.00");

  // Closing one hides only its parts; tapping again reopens it.
  await pill.click();
  const reopen = target.getByRole("button", { name: "Open split for Target" });
  await expect(reopen).toHaveAttribute("aria-expanded", "false");
  await expect(target.locator(".activity-portion").first()).toBeHidden();
  await expect(costco.locator(".activity-portion").first()).toBeVisible();
  await reopen.click();
  await expect(target.locator(".activity-portion").first()).toBeVisible();

  // Another month resets every split to open.
  await target.getByRole("button", { name: "Close split for Target" }).click();
  await page.getByRole("link", { name: "Next month" }).click();
  await expect(activityRow(page, "February shop")).toBeVisible();
  await page.getByRole("link", { name: "Previous month" }).click();
  await expect(target.getByRole("button", { name: "Close split for Target" })).toBeVisible();
  await expect(target.locator(".activity-portion").first()).toBeVisible();
});

test("a closed account's transactions keep its name", async ({ page }) => {
  await addAccount(page, "Old Bank", "0");
  await add(page, { payee: "Fee", amount: "3", date: "2030-01-02" });
  await add(page, { payee: "Fee refund", amount: "3", date: "2030-01-03", inflow: true });
  await goTo(page, "Accounts");
  await page.locator(".item", { hasText: "Old Bank" }).click();
  await page
    .getByRole("dialog", { name: "Edit Old Bank" })
    .getByRole("button", { name: "Close account" })
    .click();
  await expect(page.getByRole("heading", { name: "Closed accounts" })).toBeVisible();

  await openActivityMonth(page, "2030-01");
  await expect(activityRow(page, "Fee").locator(".activity-account")).toHaveText("Old Bank");
});
