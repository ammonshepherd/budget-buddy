import { expect, test, type Page } from "@playwright/test";
import {
  activityRow,
  goTo,
  openActivityMonth,
  openAddTransaction,
  signInWithHousehold,
} from "./helpers";

async function addAccount(page: Page, name: string) {
  await goTo(page, "Accounts");
  const add = page.getByRole("form", { name: "Add an account" });
  await add.getByLabel("Account name").fill(name);
  await add.getByLabel("Opening balance").fill("500");
  await add.getByLabel("Opening date", { exact: true }).fill("2030-01-01");
  await add.getByRole("button", { name: "Add account" }).click();
}

async function add(page: Page, payee: string, account: string, amount: string, date: string) {
  const dialog = await openAddTransaction(page);
  await dialog.getByLabel("Amount").first().fill(amount);
  await dialog.getByLabel("Payee").fill(payee);
  await dialog.getByLabel("Date").fill(date);
  await dialog.getByLabel("Account").selectOption({ label: account });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
}

const picker = (page: Page) => page.getByLabel("Account", { exact: true });
const payees = (page: Page) =>
  page.getByRole("region", { name: "Transactions" }).locator(".activity-payee");

test("Activity shows only the chosen account's transactions", async ({ page }) => {
  await signInWithHousehold(page);
  await addAccount(page, "Checking");
  await addAccount(page, "Savings");
  await openActivityMonth(page, "2030-01");
  await add(page, "Grocer", "Checking", "20", "2030-01-05");
  await add(page, "Bakery", "Savings", "7", "2030-01-06");
  await add(page, "Later", "Savings", "3", "2030-02-02");

  await expect(picker(page)).toHaveValue("");
  await expect(payees(page)).toHaveText(["Bakery", "Grocer"]);

  await picker(page).selectOption({ label: "Savings" });
  await expect(payees(page)).toHaveText(["Bakery"]);
  await expect(activityRow(page, "Grocer")).toHaveCount(0);
  await expect(page.getByRole("definition").nth(1)).toHaveText("−$7.00");
  await expect(page.getByLabel("Totals for January 2030 in Savings")).toBeVisible();
  // The review list narrows too.
  const review = page.getByRole("list", { name: "To review" });
  await expect(review.getByRole("listitem")).toHaveCount(2);
  await expect(review).not.toContainText("Grocer");

  // Kept in another month and after visiting another page.
  await page.getByRole("link", { name: "Next month" }).click();
  await expect(picker(page)).toHaveValue(/.+/);
  await expect(payees(page)).toHaveText(["Later"]);
  await goTo(page, "Budget");
  await goTo(page, "Activity");
  await expect(payees(page)).toHaveText(["Later"]);

  // An empty month says which account.
  await page.getByRole("link", { name: "Next month" }).click();
  await expect(page.getByText("No transactions in Savings in March 2030.")).toBeVisible();

  // All accounts again.
  await picker(page).selectOption({ label: "All accounts" });
  await page.getByRole("link", { name: "Previous month" }).click();
  await page.getByRole("link", { name: "Previous month" }).click();
  await expect(payees(page)).toHaveText(["Bakery", "Grocer"]);
});
