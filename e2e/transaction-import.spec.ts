import { expect, test, type Page } from "@playwright/test";
import { available, goTo, signInWithHousehold } from "./helpers";

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

  // They arrive Uncategorized: spending lowers Available to Assign straight away,
  // but the payroll deposit waits for review until it is marked Income.
  await card.getByRole("link", { name: "Give them envelopes on Activity" }).click();
  await expect(page.locator(".item", { hasText: "HARDWARE STORE" })).toContainText("Uncategorized");
  await page.goto("./#budget/2030-01");
  await expect(available(page)).toContainText("$981.38");
  await expect(
    page.getByText("1 inflow ($500.00) is not in Available to Assign yet."),
  ).toBeVisible();
  await page.getByRole("link", { name: "Review them on Activity" }).click();
  const review = page.getByRole("list", { name: "Inflows to review" });
  await review
    .locator(".item", { hasText: "PAYROLL" })
    .getByRole("button", { name: "Mark as Income" })
    .click();
  await expect(page.getByRole("heading", { name: "Inflows to review" })).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Transactions" }).locator(".item", { hasText: "PAYROLL" }),
  ).toContainText("Income");
  await page.goto("./#budget/2030-01");
  await expect(available(page)).toContainText("$1,481.38");
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

  await goTo(page, "Activity");
  await expect(page.locator(".item", { hasText: "GROCERY" })).toContainText("-$45.10");
  // Listed under its posting date's heading.
  await expect(
    page.locator("details.day-group", { hasText: "Friday, January 4, 2030" }).locator(".item"),
  ).toContainText("GROCERY");
});
