import { expect, test, type Page } from "@playwright/test";
import {
  activityRow,
  available,
  goTo,
  openActivityMonth,
  openAddTransaction,
  signInWithHousehold,
} from "./helpers";

// Made-up rows in the same layout as the bank's checking export.
const CHECKING = [
  "Account ID,Transaction ID,Date,Description,Check Number,Category,Tags,Amount,Balance",
  'X-1,20301012:1,01/12/30,Withdrawal Debit Card HARDWARE STORE,,,,"-$18.62","$1,481.38"',
  'X-1,20301011:2,01/11/30,Deposit ACH PAYROLL,,,,"$500.00","$1,500.00"',
  'X-1,20301002:3,01/02/30,Withdrawal ACH CARD PAYMENT,,,,"-$300.00","$1,000.00"',
  "X-1,20291231:4,12/31/29,Before the account opened,,,,-$9.99,",
  "X-1,20301003:5,pending,Not posted yet,,,,-$1.00,",
].join("\n");

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

test("import a bank CSV, skipping invalid, early and duplicate rows", async ({ page }) => {
  await signInWithHousehold(page);
  await addAccount(page, "Checking", "1300.00");

  await goTo(page, "Settings");
  const card = page.getByRole("region", { name: "Import transactions" });
  await card.getByLabel("Bank CSV file").setInputFiles(file("CHECKING.csv", CHECKING));

  // Columns were detected; the preview explains every skipped row.
  const columns = card.locator("details.import-columns");
  await expect(columns.locator("summary")).toHaveText("Columns: check these");
  await expect(columns.getByLabel("Date", { exact: true })).toHaveValue("2");
  await expect(columns.getByLabel("Bank transaction ID (prevents duplicates)")).toHaveValue("1");
  const status = card.getByRole("status");
  await expect(status).toContainText(
    "3 new transactions from 2030-01-02 to 2030-01-12: $500.00 in, $318.62 out. 1 row before the opening date skipped. 1 invalid row skipped.",
  );
  await expect(card.getByRole("list", { name: "Invalid rows" })).toContainText(
    'Line 6Date "pending" is not a date',
  );

  await card.getByRole("button", { name: "Import 3 transactions" }).click();
  await expect(status).toContainText("Imported 3 transactions into Checking");

  // They arrive Uncategorized and wait for review: none of them counts toward
  // Available to Assign until it is decided.
  // The link opens Activity at the month of the newest imported row.
  await card.getByRole("link", { name: "Give them envelopes on Activity" }).click();
  await expect(page).toHaveURL(/#activity\/2030-01$/);
  const hardware = activityRow(page, "Withdrawal Debit Card HARDWARE STORE");
  await expect(hardware).toContainText("Uncategorized");
  // Importing does not reconcile: that is ticking rows off against the bank.
  await expect(hardware.getByRole("img", { name: "Not reconciled" })).toBeVisible();
  await page.goto("./#budget/2030-01");
  await expect(available(page)).toContainText("$1,300.00");
  await expect(
    page.getByText(
      "3 transactions to review ($500.00 in, $318.62 out) are not in Available to Assign yet.",
    ),
  ).toBeVisible();
  await page.getByRole("link", { name: "Review them on Activity" }).click();
  const review = page.getByRole("list", { name: "To review" });
  await review
    .getByRole("listitem")
    .filter({ hasText: "PAYROLL" })
    .getByRole("button", { name: "Mark as Income" })
    .click();
  await expect(review).not.toContainText("PAYROLL");
  await expect(activityRow(page, "Deposit ACH PAYROLL")).toContainText("Income");
  await page.goto("./#budget/2030-01");
  await expect(available(page)).toContainText("$1,800.00");
  await expect(available(page)).toContainText("Income this month $500.00");
  await goTo(page, "Accounts");
  await expect(page.locator(".item", { hasText: "Checking" })).toContainText("$1,481.38");

  // The same file again: the saved columns are reused and nothing is imported twice.
  await goTo(page, "Settings");
  await card.getByLabel("Bank CSV file").setInputFiles(file("CHECKING.csv", CHECKING));
  await expect(columns.locator("summary")).toHaveText("Columns: using this account’s saved setup");
  await expect(status).toContainText("0 new transactions");
  await expect(status).toContainText("3 duplicates skipped");
  await expect(card.getByRole("button", { name: "Import 0 transactions" })).toBeDisabled();
});

test("a card export with positive purchases and changed columns", async ({ page }) => {
  await signInWithHousehold(page);
  await addAccount(page, "Card", "0");

  await goTo(page, "Settings");
  const card = page.getByRole("region", { name: "Import transactions" });
  await card
    .getByLabel("Bank CSV file")
    .setInputFiles(
      file(
        "card.csv",
        [
          "Trans. Date,Post Date,Description,Amount,Category",
          "01/03/2030,01/04/2030,GROCERY,45.10,Supermarkets",
          "01/05/2030,01/06/2030,GAS,30.00,Gasoline",
          "01/06/2030,01/06/2030,BOOKS,24.90,Merchandise",
          "01/07/2030,01/07/2030,PAYMENT,-100.00,Payments",
        ].join("\n"),
      ),
    );
  await expect(card.getByText("Most amounts are positive")).toBeVisible();
  await card.getByLabel(/flip signs/).check();
  await expect(card.getByText("Most amounts are positive")).toHaveCount(0);
  await expect(card.getByRole("status")).toContainText("$100.00 in, $100.00 out");

  // Use the posting date instead of the transaction date.
  await card.getByLabel("Date", { exact: true }).selectOption({ label: "Post Date (01/04/2030)" });
  await expect(card.getByRole("status")).toContainText("from 2030-01-04 to 2030-01-07");
  await card.getByRole("button", { name: "Import 4 transactions" }).click();
  await expect(card.getByRole("status")).toContainText("Imported 4 transactions into Card");

  await openActivityMonth(page, "2030-01");
  await expect(activityRow(page, "GROCERY")).toContainText("−$45.10");
  // Listed under its posting date's heading.
  await expect(
    page.getByRole("region", { name: "Fri Jan 4" }).locator(".activity-payee"),
  ).toHaveText(["GROCERY"]);
});

test("bank rows match transactions typed in before the import", async ({ page }) => {
  await signInWithHousehold(page);
  await addAccount(page, "Checking", "1300.00");
  for (const [date, amount, payee] of [
    ["2030-01-10", "18.62", "Hardware"],
    ["2030-01-02", "300.00", "Visa payment"],
  ]) {
    const dialog = await openAddTransaction(page);
    await dialog.getByLabel("Date").fill(date!);
    await dialog.getByLabel("Amount").fill(amount!);
    await dialog.getByLabel("Payee").fill(payee!);
    await dialog.getByRole("button", { name: "Add transaction" }).click();
    await expect(dialog).toBeHidden();
  }

  await goTo(page, "Settings");
  const card = page.getByRole("region", { name: "Import transactions" });
  await card.getByLabel("Bank CSV file").setInputFiles(file("CHECKING.csv", CHECKING));
  const status = card.getByRole("status");
  await expect(status).toContainText(
    "1 new transaction from 2030-01-11 to 2030-01-11: $500.00 in, $0.00 out.",
  );
  await expect(status).toContainText("2 rows will be matched to transactions you entered.");
  const matches = card.getByRole("list", { name: "Matched to transactions you entered" });
  await expect(matches.getByRole("listitem")).toHaveCount(2);
  await expect(matches.getByRole("listitem").first()).toContainText(
    "You entered 2030-01-10 · bank: 2030-01-12, Withdrawal Debit Card HARDWARE STORE",
  );

  // Keep the card payment separate: it is imported as a new row instead.
  await matches.getByRole("checkbox", { name: /CARD PAYMENT to Visa payment/ }).uncheck();
  await expect(status).toContainText("2 new transactions");
  await card.getByRole("button", { name: "Import 2 and match 1" }).click();
  await expect(status).toContainText(
    "Imported 2 transactions into Checking and matched 1 you entered.",
  );

  // The match kept what was typed; nothing was added twice.
  await openActivityMonth(page, "2030-01");
  await expect(activityRow(page, "Hardware")).toHaveCount(1);
  await expect(activityRow(page, "Withdrawal Debit Card HARDWARE STORE")).toHaveCount(0);
  await expect(activityRow(page, "Visa payment")).toHaveCount(1);
  await expect(activityRow(page, "Withdrawal ACH CARD PAYMENT")).toHaveCount(1);
  await goTo(page, "Accounts");
  await expect(page.locator(".item", { hasText: "Checking" })).toContainText("$1,181.38");
});
