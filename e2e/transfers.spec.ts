import { expect, test, type Page } from "@playwright/test";
import { goTo, signInWithHousehold } from "./helpers";

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
const items = (page: Page) => page.getByRole("region", { name: "Transactions" }).locator(".item");

/** The Activity row whose title is exactly `title` (text matching ignores case). */
const row = (page: Page, title: string) =>
  items(page).filter({
    has: page.locator(".item-title", { hasText: new RegExp(`^${title}$`) }),
  });

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

  await goTo(page, "Activity");
  const out = items(page).filter({ hasText: "TRANSFER TO SAVINGS" });
  await out.click();
  const form = page.getByRole("form", { name: "Edit transaction" });
  await form.getByLabel("Envelope").selectOption({ label: "Transfer (not spending or income)" });
  await expect(form.getByLabel("To account")).toHaveValue(/.+/);
  await expect(form.getByRole("note")).toHaveText(
    "Links to the Savings transaction on 2030-01-06 (TRANSFER FROM CHECKING), so it is not added twice.",
  );
  await form.getByRole("button", { name: "Save changes" }).click();

  // Still two rows, both now a linked Transfer; the bank's own dates are kept.
  await expect(items(page)).toHaveCount(2);
  await expect(out).toContainText("Checking · Transfer to Savings");
  const into = items(page).filter({ hasText: "TRANSFER FROM CHECKING" });
  await expect(into).toContainText("Savings · Transfer from Checking");

  // Neither side is spending or income.
  await page.goto("./#budget/2030-01");
  await expect(page.getByRole("region", { name: "Available to Assign" })).toContainText(
    "$1,000.00",
  );

  // Deleting one imported side keeps the other bank row, unlinked.
  page.on("dialog", (dialog) => dialog.accept());
  await goTo(page, "Activity");
  await out.click();
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

  const rows = items(page).filter({ hasText: "Move" });
  await expect(rows).toHaveCount(2);
  await rows.filter({ hasText: "Transfer from Checking" }).click();
  const form = page.getByRole("form", { name: "Edit transaction" });
  await expect(form.getByRole("note")).toHaveText("Also updates the Checking side.");
  await form.getByLabel("Amount").fill("80");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(rows.filter({ hasText: "Transfer to Savings" })).toContainText("-$80.00");

  // Making one side ordinary spending removes the typed-in other side.
  await rows.filter({ hasText: "Transfer to Savings" }).click();
  await form.getByLabel("Envelope").selectOption({ label: "Uncategorized" });
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Checking · Uncategorized");
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

  await goTo(page, "Activity");
  const out = items(page).filter({ hasText: "TO SAVINGS" });
  await out.click();
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
  await expect(row(page, "FROM CHECKING")).toContainText("Transfer from Checking");
  await expect(row(page, "BIRTHDAY GIFT")).toContainText("Uncategorized");

  // Change it to a new transaction: the bank row goes back to Uncategorized.
  await out.click();
  await expect(otherSide.locator("option:checked")).toHaveText(
    "Keep 2030-01-20 · FROM CHECKING · $200.00 (15 days later)",
  );
  await otherSide.selectOption({ label: "Add a new transaction instead" });
  await expect(form.getByRole("note")).toHaveText("Also adds the matching inflow in Savings.");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(row(page, "FROM CHECKING")).toContainText("Uncategorized");
  await expect(items(page).filter({ hasText: "Transfer from Checking" })).toContainText("Savings");
  await expect(items(page)).toHaveCount(4);
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
  await goTo(page, "Activity");
  await page.locator(".item", { hasText: "Transfer to Savings" }).click();
  const form = page.getByRole("form", { name: "Edit transaction" });
  await expect(form.getByLabel("Other side").locator("option")).toHaveText([
    "Keep the side you typed in (updated to match)",
    "2030-01-11 · ONLINE TRANSFER · $50.00 (1 day later)",
  ]);
  await form.getByLabel("Other side").selectOption({ index: 1 });
  await form.getByRole("button", { name: "Save changes" }).click();

  // The typed-in Savings side is gone; the bank row is now the other side.
  await expect(items(page)).toHaveCount(2);
  await expect(items(page).filter({ hasText: "ONLINE TRANSFER" })).toContainText(
    "Transfer from Checking",
  );
});
