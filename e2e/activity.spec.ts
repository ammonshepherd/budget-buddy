import { expect, test, type Page } from "@playwright/test";
import {
  editAccount,
  openAccount,
  activityRow,
  addGroupWithEnvelopes,
  editCell,
  goTo,
  openActivityMonth,
  openAddTransaction,
  signInWithHousehold,
  chooseEnvelope,
  addAccount,
  accountRow,
} from "./helpers";

const newAccount = (page: Page, name: string, opening: string) =>
  addAccount(page, { name, balance: opening, date: "2030-01-01" });

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
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** A $30 split: $10 to the first envelope, the rest to the second. */
async function addSplit(page: Page, payee: string, date: string, first: string, second: string) {
  const dialog = await openAddTransaction(page);
  await dialog.getByLabel("Amount").first().fill("30");
  await dialog.getByLabel("Payee").fill(payee);
  await dialog.getByLabel("Date").fill(date);
  await chooseEnvelope(dialog.getByLabel("Envelope").first(), first);
  await chooseEnvelope(dialog.getByLabel("Envelope").first(), "Split across envelopes");
  await dialog.getByLabel("Amount 1").fill("10");
  await chooseEnvelope(dialog.getByLabel("Envelope 2"), second);
  await dialog.getByRole("button", { name: "Put the rest in the last line" }).click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
}

const totals = (page: Page) => page.getByRole("definition");

test.beforeEach(async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await signInWithHousehold(page);
});

test("a month's transactions by day, with totals and day nets", async ({ page }) => {
  await newAccount(page, "Main Checking", "500");
  await newAccount(page, "Savings", "0");
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
  // In and Out leave transfers out on All accounts. The balance is today's,
  // so these 2030 transactions are not in it yet; none is reconciled.
  await expect(totals(page)).toHaveText(["+$250.00", "−$25.00", "$500.00", "Reconciled $500.00"]);

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
  await expect(kroger.locator(".activity-amount")).toHaveCSS("color", "rgb(179, 38, 30)");
  const pay = activityRow(page, "Paycheck");
  await expect(pay.locator(".activity-category")).toHaveText("Income");
  await expect(pay.locator(".activity-amount")).toHaveText("+$250.00");
  await expect(pay.locator(".activity-amount")).toHaveCSS("color", "rgb(31, 107, 66)");
  // A transfer once, From → To, red from its money-out side.
  const transfer = activityRow(page, "To savings");
  await expect(transfer).toHaveCount(1);
  await expect(transfer.locator(".activity-account")).toHaveText("Main Checking → Savings");
  await expect(transfer.locator(".activity-category")).toHaveText("Transfer");
  await expect(transfer.locator(".activity-amount")).toHaveText("−$40.00");
  await expect(transfer.locator(".activity-amount")).toHaveCSS("color", "rgb(179, 38, 30)");
  // Still to review: the amber label.
  await expect(activityRow(page, "Coffee").locator(".badge-uncategorized")).toHaveText(
    "Uncategorized",
  );
  // Nothing is reconciled with the bank yet: a grey bank.
  await expect(kroger.getByRole("img", { name: "Not reconciled" })).toBeVisible();
  // Another month's transaction is not listed.
  await expect(activityRow(page, "Next month")).toHaveCount(0);

  // The next month reloads the list and the totals.
  await page.getByRole("link", { name: "Next month" }).click();
  await expect(page).toHaveURL(/#accounts\/all\/2030-02$/);
  await expect(totals(page)).toHaveText(["$0.00", "−$7.00", "$500.00", "Reconciled $500.00"]);
  await expect(activityRow(page, "Next month")).toBeVisible();
  await expect(activityRow(page, "Kroger")).toHaveCount(0);

  // An empty month: a message and zero totals.
  await page.getByRole("link", { name: "Next month" }).click();
  await expect(page.getByText("No transactions in March 2030.")).toBeVisible();
  await expect(totals(page)).toHaveText(["$0.00", "$0.00", "$500.00", "Reconciled $500.00"]);
});

test("tapping the payee opens the transaction to edit or delete", async ({ page }) => {
  await newAccount(page, "Checking", "500");
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
  await newAccount(page, "Checking", "500");
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
  await newAccount(page, "Old Bank", "0");
  await add(page, { payee: "Fee", amount: "3", date: "2030-01-02" });
  await add(page, { payee: "Fee refund", amount: "3", date: "2030-01-03", inflow: true });
  const form = await editAccount(page, "Old Bank");
  await form.getByRole("button", { name: "Close account" }).click();
  // Closing goes back to the list, where closed accounts wait behind a toggle.
  await expect(page.getByRole("button", { name: "Show closed accounts (1)" })).toBeVisible();
  await expect(accountRow(page, "Old Bank")).toHaveCount(0);

  await openActivityMonth(page, "2030-01");
  await expect(activityRow(page, "Fee").locator(".activity-account")).toHaveText("Old Bank");
});

test("ticking rows shows their total and marks them reconciled", async ({ page }) => {
  await newAccount(page, "Checking", "500");
  await newAccount(page, "Savings", "0");
  await add(page, { payee: "Lunch", amount: "12", date: "2030-01-02" });
  await add(page, { payee: "Refund", amount: "5", date: "2030-01-03", inflow: true });
  await add(page, {
    payee: "To savings",
    amount: "40",
    date: "2030-01-04",
    envelope: "Transfer (not spending or income)",
  });
  await add(page, { payee: "February shop", amount: "1", date: "2030-02-01" });
  await openActivityMonth(page, "2030-01");

  const lunch = activityRow(page, "Lunch");
  const refund = activityRow(page, "Refund");
  const bar = page.getByRole("toolbar", { name: "Selected transactions" });
  await expect(bar).toHaveCount(0);

  // Ticked rows are highlighted and added up, signed.
  await lunch.getByRole("checkbox", { name: "Select Lunch, −$12.00" }).check();
  await expect(lunch).toHaveClass(/checked/);
  await expect(bar).toContainText("1 selected");
  await expect(bar).toContainText("−$12.00");
  await refund.getByRole("checkbox").check();
  await expect(bar).toContainText("2 selected");
  await expect(bar).toContainText("−$7.00");
  // On All accounts a transfer's sides cancel out.
  await activityRow(page, "To savings").getByRole("checkbox").check();
  await expect(bar).toContainText("3 selected");
  await expect(bar).toContainText("−$7.00");
  await expect(bar.getByRole("button", { name: "Mark unreconciled" })).toHaveCount(0);

  await bar.getByRole("button", { name: "Mark reconciled" }).click();
  await expect(bar).toHaveCount(0);
  await expect(lunch.getByRole("img", { name: "Reconciled" })).toBeVisible();
  await expect(refund.getByRole("img", { name: "Reconciled" })).toBeVisible();
  await expect(lunch).not.toHaveClass(/checked/);
  await expect(lunch.getByRole("checkbox")).not.toBeChecked();
  // Reconciled counts whatever the date: what the bank should show.
  await expect(page.locator(".activity-balance-detail")).toHaveText("Reconciled $493.00");

  // In one account a transfer stands for its side there.
  await openAccount(page, "Savings");
  const transfer = activityRow(page, "To savings");
  await expect(transfer.getByRole("img", { name: "Reconciled" })).toBeVisible();
  await transfer.getByRole("checkbox").check();
  await expect(bar).toContainText("+$40.00");
  await expect(bar.getByRole("button", { name: "Mark reconciled" })).toHaveCount(0);
  await bar.getByRole("button", { name: "Mark unreconciled" }).click();
  await expect(transfer.getByRole("img", { name: "Not reconciled" })).toBeVisible();

  // Changing the month (or account) starts with nothing ticked.
  await openActivityMonth(page, "2030-01");
  await lunch.getByRole("checkbox").check();
  await expect(bar).toBeVisible();
  await page.getByRole("link", { name: "Next month" }).click();
  await expect(activityRow(page, "February shop")).toBeVisible();
  await expect(bar).toHaveCount(0);
  await page.getByRole("link", { name: "Previous month" }).click();
  await expect(lunch.getByRole("checkbox")).not.toBeChecked();

  // Clear unticks everything without saving.
  await lunch.getByRole("checkbox").check();
  await bar.getByRole("button", { name: "Clear selection" }).click();
  await expect(bar).toHaveCount(0);
  await expect(lunch.getByRole("img", { name: "Reconciled" })).toBeVisible();
});
