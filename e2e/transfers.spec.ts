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
  const out = page.locator(".item", { hasText: "TRANSFER TO SAVINGS" });
  await out.getByRole("button", { name: "Edit" }).click();
  const form = page.getByRole("form", { name: "Edit transaction" });
  await form.getByLabel("Envelope").selectOption({ label: "Transfer (not spending or income)" });
  await expect(form.getByLabel("To account")).toHaveValue(/.+/);
  await expect(form.getByRole("note")).toHaveText(
    "Links to the Savings transaction on 2030-01-06 (TRANSFER FROM CHECKING), so it is not added twice.",
  );
  await form.getByRole("button", { name: "Save changes" }).click();

  // Still two rows, both now a linked Transfer; the bank's own dates are kept.
  await expect(page.locator(".item")).toHaveCount(2);
  await expect(out).toContainText("2030-01-05 · Checking · Transfer to Savings");
  const into = page.locator(".item", { hasText: "TRANSFER FROM CHECKING" });
  await expect(into).toContainText("2030-01-06 · Savings · Transfer from Checking");

  // Neither side is spending or income.
  await page.goto("./#budget/2030-01");
  await expect(page.getByRole("region", { name: "Available to Assign" })).toContainText(
    "$1,000.00",
  );

  // Deleting one imported side keeps the other bank row, unlinked.
  page.on("dialog", (dialog) => dialog.accept());
  await goTo(page, "Activity");
  await out.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".item")).toHaveCount(1);
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

  const rows = page.locator(".item", { hasText: "Move" });
  await expect(rows).toHaveCount(2);
  await rows
    .filter({ hasText: "Transfer from Checking" })
    .getByRole("button", { name: "Edit" })
    .click();
  const form = page.getByRole("form", { name: "Edit transaction" });
  await expect(form.getByRole("note")).toHaveText("Also updates the Checking side.");
  await form.getByLabel("Amount").fill("80");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(rows.filter({ hasText: "Transfer to Savings" })).toContainText("-$80.00");

  // Making one side ordinary spending removes the typed-in other side.
  await rows
    .filter({ hasText: "Transfer to Savings" })
    .getByRole("button", { name: "Edit" })
    .click();
  await form.getByLabel("Envelope").selectOption({ label: "Uncategorized" });
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Checking · Uncategorized");
});
