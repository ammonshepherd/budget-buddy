import { expect, test } from "@playwright/test";
import {
  activityRow,
  addGroupWithEnvelopes,
  available,
  editCell,
  goTo,
  openAddTransaction,
  signInWithHousehold,
  addAccount,
  openAllAccounts,
  chooseEnvelope,
} from "./helpers";

const plus = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: "Add transaction", exact: true });

test("the + button is on Budget and Accounts, not Settings", async ({ page }) => {
  await signInWithHousehold(page);
  for (const name of ["Budget", "Accounts"] as const) {
    await goTo(page, name);
    await expect(plus(page)).toBeVisible();
  }
  await openAllAccounts(page);
  await expect(plus(page)).toBeVisible();
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
  await addAccount(page, { name: "Checking", balance: "500" });

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
  await chooseEnvelope(dialog.getByLabel("Envelope"), "Income (to Available to Assign)");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Budget" })).toBeVisible();
  await expect(available(page)).toContainText("$575.00");

  await openAllAccounts(page);
  await expect(activityRow(page, "Paycheck")).toContainText("Income");
});

test("envelope pickers show each envelope's Remaining in the transaction's month", async ({
  page,
}) => {
  await signInWithHousehold(page);
  await addAccount(page, { name: "Checking", balance: "500" });
  await addGroupWithEnvelopes(page, "Everyday", ["Groceries", "Fun"]);
  await editCell(page, "Groceries", "assigned", "120");

  const dialog = await openAddTransaction(page);
  const picker = dialog.getByLabel("Envelope", { exact: true });
  const matches = dialog.getByRole("listbox", { name: "Matches" });
  await picker.click();
  await expect(matches.getByRole("option", { name: /^Groceries/ })).toHaveText(
    "Groceries has $120.00",
  );
  await expect(matches.getByRole("option", { name: /^Fun/ })).toHaveText("Fun has $0.00");
  // Fixed choices keep their plain names.
  await expect(matches.getByRole("option").first()).toHaveText("Uncategorized");

  // Typing narrows the matches; tapping one picks it.
  await picker.fill("gro");
  await expect(matches.getByRole("option")).toHaveText(["Groceries has $120.00"]);
  await matches.getByRole("option", { name: /^Groceries/ }).click();
  await expect(picker).toHaveValue("Groceries");
  await expect(matches).toBeHidden();

  // Split lines show the same amounts.
  await dialog.getByLabel("Amount").fill("30");
  await chooseEnvelope(picker, "Split across envelopes");
  const line = dialog.getByLabel("Envelope 1");
  await line.click();
  await expect(matches.getByRole("option", { name: /^Groceries/ })).toHaveText(
    "Groceries has $120.00",
  );
  await line.press("Escape");

  // Another month shows that month's Remaining (this month's moves to Saved).
  await dialog.getByLabel("Date").fill("2099-06-15");
  await line.click();
  await expect(matches.getByRole("option", { name: /^Groceries/ })).toHaveText(
    "Groceries has $0.00",
  );
});

test("amounts fill in cents first; a typed period keeps what is typed", async ({ page }) => {
  await signInWithHousehold(page);
  await addAccount(page, { name: "Checking", balance: "500" });
  const dialog = await openAddTransaction(page);
  const amount = dialog.getByLabel("Amount");

  for (const [key, shown] of [
    ["1", "0.01"],
    ["2", "0.12"],
    ["3", "1.23"],
    ["4", "12.34"],
  ]) {
    await amount.press(key);
    await expect(amount).toHaveValue(shown);
  }
  await amount.press("Backspace");
  await expect(amount).toHaveValue("1.23");
  await amount.press("Backspace");
  await amount.press("Backspace");
  await amount.press("Backspace");
  await expect(amount).toHaveValue("");

  // A period typed after 1, 2 means $12, as typed.
  await amount.pressSequentially("12.5");
  await expect(amount).toHaveValue("12.5");

  // A pasted amount is taken as it is.
  await amount.fill("45");
  await expect(amount).toHaveValue("45");

  await amount.fill("");
  await amount.pressSequentially("4520");
  await dialog.getByLabel("Payee").fill("Bakery");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await openAllAccounts(page);
  await expect(activityRow(page, "Bakery")).toContainText("−$45.20");
});
