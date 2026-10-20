import { expect, test } from "@playwright/test";
import {
  activityRow,
  addGroupWithEnvelopes,
  available,
  editCell,
  goTo,
  openAddTransaction,
  signInWithHousehold,
} from "./helpers";

const plus = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: "Add transaction", exact: true });

test("the + button is on Budget, Accounts and Activity, not Settings", async ({ page }) => {
  await signInWithHousehold(page);
  for (const name of ["Budget", "Accounts", "Activity"] as const) {
    await goTo(page, name);
    await expect(plus(page)).toBeVisible();
  }
  await goTo(page, "Settings");
  await expect(plus(page)).toHaveCount(0);
});

test("add a transaction from the Budget page without leaving it", async ({ page }) => {
  await signInWithHousehold(page);

  // With no account yet, the dialog points to Accounts.
  let dialog = await openAddTransaction(page);
  await dialog.getByRole("link", { name: "Add an account" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Accounts" })).toBeVisible();
  await page.getByLabel("Account name").fill("Checking");
  await page.getByLabel("Opening balance").fill("500");
  await page.getByRole("button", { name: "Add account" }).click();

  await goTo(page, "Budget");
  await expect(available(page)).toContainText("$500.00");

  // Escape and Cancel close it without saving.
  dialog = await openAddTransaction(page);
  await dialog.getByLabel("Amount").fill("10");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  dialog = await openAddTransaction(page);
  await expect(dialog.getByLabel("Amount")).toHaveValue("");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  dialog = await openAddTransaction(page);
  await dialog.getByRole("radio", { name: "Inflow" }).check();
  await dialog.getByLabel("Amount").fill("75");
  await dialog.getByLabel("Payee").fill("Paycheck");
  await dialog.getByLabel("Envelope").selectOption({ label: "Income (to Available to Assign)" });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Budget" })).toBeVisible();
  await expect(available(page)).toContainText("$575.00");

  await goTo(page, "Activity");
  await expect(activityRow(page, "Paycheck")).toContainText("Income");
});

test("envelope pickers show each envelope's Remaining in the transaction's month", async ({
  page,
}) => {
  await signInWithHousehold(page);
  await goTo(page, "Accounts");
  await page.getByLabel("Account name").fill("Checking");
  await page.getByLabel("Opening balance").fill("500");
  await page.getByRole("button", { name: "Add account" }).click();
  await addGroupWithEnvelopes(page, "Everyday", ["Groceries", "Fun"]);
  await editCell(page, "Groceries", "assigned", "120");

  const dialog = await openAddTransaction(page);
  const picker = dialog.getByLabel("Envelope");
  await expect(picker.locator("option", { hasText: "Groceries" })).toHaveText(
    "Groceries (has $120.00)",
  );
  await expect(picker.locator("option", { hasText: "Fun" })).toHaveText("Fun (has $0.00)");
  // Fixed choices keep their plain names.
  await expect(picker.locator("option").first()).toHaveText("Uncategorized");

  // Split lines show the same amounts.
  await dialog.getByLabel("Amount").fill("30");
  await picker.selectOption({ label: "Split across envelopes" });
  await expect(
    dialog.getByLabel("Envelope 1").locator("option", { hasText: "Groceries" }),
  ).toHaveText("Groceries (has $120.00)");

  // Another month shows that month's Remaining (this month's moves to Saved).
  await dialog.getByLabel("Date").fill("2099-06-15");
  await expect(
    dialog.getByLabel("Envelope 1").locator("option", { hasText: "Groceries" }),
  ).toHaveText("Groceries (has $0.00)");
});
