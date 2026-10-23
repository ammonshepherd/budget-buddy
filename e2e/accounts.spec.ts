import { expect, test, type Page } from "@playwright/test";
import {
  accountRow,
  activityRow,
  addAccount,
  addTransaction,
  available,
  editAccount,
  goTo,
  openAccount,
  openAddTransaction,
  openAllAccounts,
  signInWithHousehold,
  chooseEnvelope,
} from "./helpers";

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Adds a transaction in an account with the + button (a transfer with `transferTo`). */
async function add(
  page: Page,
  tx: { payee: string; amount: string; date: string; account: string; inflow?: boolean },
  transferTo?: string,
) {
  const dialog = await openAddTransaction(page);
  if (tx.inflow) await dialog.getByRole("radio", { name: "Inflow" }).check();
  await dialog.getByLabel("Amount").first().fill(tx.amount);
  await dialog.getByLabel("Payee").fill(tx.payee);
  await dialog.getByLabel("Date").fill(tx.date);
  // Inside an open account the form has no picker, only that account's name.
  const picker = dialog.locator(".field-account select");
  if (await picker.count()) await picker.selectOption({ label: tx.account });
  else await expect(dialog.locator(".fixed-account strong")).toHaveText(tx.account);
  if (transferTo) {
    await chooseEnvelope(dialog.getByLabel("Envelope"), "Transfer (not spending or income)");
    await dialog.getByLabel("To account").selectOption({ label: transferTo });
  }
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** The info pane's figures, label → amount. */
async function figures(page: Page) {
  const out: Record<string, string> = {};
  for (const cell of await page.locator(".account-figure").all()) {
    out[(await cell.locator("dt").innerText()).toLowerCase()] = await cell
      .locator("dd")
      .innerText();
  }
  return out;
}

const payees = (page: Page) =>
  page.getByRole("region", { name: "Transactions" }).locator(".activity-payee");

test("the list groups accounts by type, with All accounts first and closed ones hidden", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  await signInWithHousehold(page);
  await addAccount(page, { name: "Savings", balance: "0" });
  await addAccount(page, { name: "Visa", owed: "200" });
  await addAccount(page, { name: "Checking", balance: "1000" });
  await addAccount(page, { name: "Old Bank", balance: "0" });

  await expect(page.locator(".account-group-heading h2")).toHaveText(["Checking", "Credit cards"]);
  const checking = page.getByRole("region", { name: "Checking" });
  await expect(checking.locator(".account-row-name")).toHaveText([
    "Checking",
    "Old Bank",
    "Savings",
  ]);
  await expect(
    page.getByRole("link", { name: "Open Checking, balance $1,000.00", exact: true }),
  ).toBeVisible();
  // A card's balance is what it owes, so it is negative (and red).
  await expect(accountRow(page, "Visa")).toContainText("-$200.00");
  await expect(accountRow(page, "Visa").locator(".account-row-balance")).toHaveCSS(
    "color",
    "rgb(179, 38, 30)",
  );
  // Rows are at least 48px tall.
  expect((await accountRow(page, "Checking").boundingBox())!.height).toBeGreaterThanOrEqual(48);

  // All accounts comes first and shows the month's money in and out.
  await addTransaction(page, { amount: "12.50", payee: "Lunch" });
  await goTo(page, "Accounts");
  const all = page.getByRole("link", { name: /^Open All accounts/ });
  await expect(all).toContainText("In $0.00 · Out −$12.50");

  // A closed account waits behind Show closed accounts.
  const form = await editAccount(page, "Old Bank");
  await form.getByRole("button", { name: "Close account" }).click();
  await expect(page).toHaveURL(/#accounts\/\d{4}-\d\d$/);
  await expect(accountRow(page, "Old Bank")).toHaveCount(0);
  await page.getByRole("button", { name: "Show closed accounts (1)" }).click();
  await expect(accountRow(page, "Old Bank")).toBeVisible();
  // A closed account opens read only: no pencil, no import.
  await accountRow(page, "Old Bank").click();
  await expect(page.getByRole("heading", { level: 2, name: /Old Bank/ })).toContainText("Closed");
  await expect(page.getByRole("button", { name: "Edit Old Bank" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Import CSV" })).toHaveCount(0);
});

test("Add account is in the page menu; adding inside an account has no Account picker", async ({
  page,
}) => {
  await signInWithHousehold(page);
  await addAccount(page, { name: "Checking", balance: "100" });
  await addAccount(page, { name: "Savings", balance: "0" });

  // No button on the list itself: Add account waits in the menu.
  await expect(page.getByRole("button", { name: "Add account", exact: true })).toHaveCount(0);

  // Inside an account: its name instead of the picker.
  await openAccount(page, "Savings");
  let dialog = await openAddTransaction(page);
  await expect(dialog.locator(".field-account select")).toHaveCount(0);
  await expect(dialog.locator(".fixed-account")).toHaveText("Account Savings");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // All accounts: the picker is back.
  await openAllAccounts(page);
  dialog = await openAddTransaction(page);
  await expect(dialog.locator(".field-account select")).toBeVisible();
});

test("an open account: its figures follow the month, its list does not", async ({ page }) => {
  await signInWithHousehold(page);
  await addAccount(page, { name: "Main", balance: "500", date: "2030-01-01" });
  await addAccount(page, { name: "Savings", balance: "0", date: "2030-01-01" });
  await page.evaluate(() => (location.hash = "#accounts/2030-01"));
  await add(page, { payee: "Grocer", amount: "20", date: "2030-01-05", account: "Main" });
  await add(page, {
    payee: "Refund",
    amount: "100",
    date: "2030-01-10",
    account: "Main",
    inflow: true,
  });
  await add(
    page,
    { payee: "To savings", amount: "40", date: "2030-01-15", account: "Main" },
    "Savings",
  );
  await add(page, { payee: "Bakery", amount: "7.00", date: "2030-02-02", account: "Main" });
  await add(page, { payee: "Other", amount: "3.00", date: "2030-01-06", account: "Savings" });

  await accountRow(page, "Main").click();
  await expect(page).toHaveURL(/#accounts\/[\w-]+\/2030-01$/);
  await expect(page.getByRole("heading", { level: 2, name: "Main" })).toBeVisible();
  // The transfer is left out of money in and out.
  await expect
    .poll(() => figures(page))
    .toEqual({
      "current balance": "$533.00",
      "month start": "$500.00",
      "opening balance": "$500.00",
      "money in": "+$100.00",
      "money out": "−$20.00",
      reconciled: "$500.00",
    });

  // Every month's transactions in this account, newest first, under month
  // dividers; the account line only on the transfer.
  const list = page.getByRole("region", { name: "Transactions" });
  await expect(list.locator(".activity-month-head")).toHaveText(["February 2030", "January 2030"]);
  await expect(payees(page)).toHaveText(["Bakery", "To savings", "Refund", "Grocer"]);
  await expect(activityRow(page, "Grocer").locator(".activity-account")).toHaveCount(0);
  await expect(activityRow(page, "To savings").locator(".activity-account")).toHaveText(
    "Main → Savings",
  );
  // Day nets leave the transfer out.
  await expect(list.locator(".activity-day-head span")).toHaveText([
    "−$7.00",
    "$0.00",
    "+$100.00",
    "−$20.00",
  ]);
  // To review narrows to the account.
  const review = page.getByRole("list", { name: "To review" });
  await expect(review.getByRole("listitem")).toHaveCount(3);
  await expect(review).not.toContainText("Other");

  // Next month: January's start plus its net activity, and the same list.
  await page.getByRole("link", { name: "Next month" }).click();
  await expect
    .poll(() => figures(page))
    .toMatchObject({
      "month start": "$540.00",
      "money in": "$0.00",
      "money out": "−$7.00",
    });
  await expect(payees(page)).toHaveText(["Bakery", "To savings", "Refund", "Grocer"]);

  // The + button adds to the open account.
  const dialog = await openAddTransaction(page);
  await expect(dialog.locator(".fixed-account strong")).toHaveText("Main");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // The back arrow returns to the list.
  await page.getByRole("link", { name: "Back to accounts" }).click();
  await expect(page).toHaveURL(/#accounts\/2030-02$/);
  await expect(accountRow(page, "Main")).toBeVisible();
});

test("edit an account from its pencil: name, opening balance and opening date", async ({
  page,
}) => {
  await signInWithHousehold(page);
  await addAccount(page, { name: "Checking", balance: "100", date: "2026-01-01" });
  await openAccount(page, "Checking");
  const pencil = page.getByRole("button", { name: "Edit Checking" });
  await pencil.click();
  const sheet = page.getByRole("dialog", { name: "Edit Checking" });
  const form = sheet.getByRole("form", { name: "Edit Checking" });
  await expect(form.getByLabel("Opening balance")).toHaveValue("100.00");

  // Escape closes it, and focus goes back to the pencil.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(pencil).toBeFocused();

  await pencil.click();
  await form.getByLabel("Account name").fill("Main checking");
  await form.getByLabel("Opening balance").fill("1,250.50");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(sheet).toBeHidden();
  // Saving updates the pane at once.
  await expect(page.getByRole("heading", { level: 2, name: "Main checking" })).toBeVisible();
  await expect.poll(() => figures(page)).toMatchObject({ "opening balance": "$1,250.50" });

  // The new opening balance flows into Available to Assign. (The purchase is
  // still to review, so it does not count until it gets an envelope.)
  await addTransaction(page, { amount: "50.50", payee: "Groceries" });
  await goTo(page, "Budget");
  await expect(available(page)).toContainText("$1,250.50");

  // The opening date cannot move past the account's first transaction.
  const again = await editAccount(page, "Main checking");
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  await again.getByLabel("Opening date").fill(iso(tomorrow));
  await again.getByRole("button", { name: "Save changes" }).click();
  await expect(again.getByRole("alert")).toHaveText(
    `Main checking has transactions from ${iso(new Date())}, so its opening date can be ${iso(new Date())} at the latest.`,
  );

  // Cancel leaves it unchanged.
  await again.getByRole("button", { name: "Cancel" }).click();
  await expect(again).toHaveCount(0);
  await expect.poll(() => figures(page)).toMatchObject({ "current balance": "$1,200.00" });
});

// 150 made-up bank rows, 12 a day from 2030-02-05 back into January.
const ROWS = 150;
const BIG_CSV = [
  "Account ID,Transaction ID,Date,Description,Check Number,Category,Tags,Amount,Balance",
  ...Array.from({ length: ROWS }, (_, i) => {
    const d = new Date(2030, 1, 5 - Math.floor(i / 12));
    const date = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/30`;
    return `X-1,ID${i + 1},${date},Row ${i + 1},,,,-$1.00,`;
  }),
].join("\n");

test("Import CSV from the account, then 100 rows at a time", async ({ page }) => {
  await signInWithHousehold(page);
  await addAccount(page, { name: "Checking", balance: "500", date: "2030-01-01" });
  await openAccount(page, "Checking");

  await page.getByRole("button", { name: "Import CSV" }).click();
  const sheet = page.getByRole("dialog", { name: "Import CSV into Checking" });
  // Already in this account: no account picker.
  await expect(sheet.getByLabel("Account", { exact: true })).toHaveCount(0);
  await sheet.getByLabel("Bank CSV file").setInputFiles({
    name: "BIG.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(BIG_CSV),
  });
  await sheet.getByRole("button", { name: `Import ${ROWS} transactions` }).click();
  await expect(sheet.getByRole("status")).toContainText(`Imported ${ROWS} transactions`);
  await sheet.getByRole("button", { name: "Close" }).click();

  // The newest 100 first, then "Show 50 more (50 left)".
  const rows = page.getByRole("region", { name: "Transactions" }).locator(".activity-item");
  await expect(rows).toHaveCount(100);
  const more = page.getByRole("button", { name: /^Show \d+ more/ });
  await expect(more).toHaveText("Show 50 more (50 left)");

  // A transaction added between pages: no rows repeated or skipped.
  await add(page, { payee: "Added", amount: "2.00", date: "2030-02-05", account: "Checking" });
  await expect(rows).toHaveCount(100);
  await expect(more).toHaveText("Show 51 more (51 left)");
  await more.click();
  await expect(rows).toHaveCount(ROWS + 1);
  await expect(more).toHaveCount(0);
  const names = await payees(page).allInnerTexts();
  expect(new Set(names).size).toBe(ROWS + 1);
  // A day that spanned the page boundary still has one heading.
  const days = await page.locator(".activity-day-head h3").allInnerTexts();
  expect(new Set(days).size).toBe(days.length);
  await expect(page.locator(".activity-month-head")).toHaveText(["February 2030", "January 2030"]);

  // Editing keeps every loaded row and the scroll position.
  const last = activityRow(page, `Row ${ROWS}`);
  await last.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  await last.locator(".activity-who").click();
  const edit = page.getByRole("dialog", { name: "Edit transaction" });
  await edit.getByLabel("Payee").fill("Edited row");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toBeHidden();
  await expect(activityRow(page, "Edited row")).toBeVisible();
  await expect(rows).toHaveCount(ROWS + 1);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThan(50);
});

test("the list comes back where it was scrolled", async ({ page }) => {
  await signInWithHousehold(page);
  for (let i = 1; i <= 14; i++) await addAccount(page, { name: `Account ${i}`, balance: "0" });
  await accountRow(page, "Account 9").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 200));
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(100);
  await accountRow(page, "Account 9").click();
  await expect(page.getByRole("heading", { level: 2, name: "Account 9" })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole("link", { name: "Back to accounts" }).click();
  await expect(accountRow(page, "Account 9")).toBeVisible();
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThan(5);
});
