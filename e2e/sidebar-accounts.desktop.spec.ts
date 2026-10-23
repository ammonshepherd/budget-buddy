import { expect, test } from "@playwright/test";
import { addAccount, signInWithHousehold } from "./helpers";

// The desktop sidebar lists every open account, with its balance, under Accounts (1280×800).

test("the sidebar lists budget accounts, then tracking accounts apart, and opens them", async ({
  page,
}) => {
  await signInWithHousehold(page);
  await addAccount(page, { name: "Savings", balance: "500" });
  await addAccount(page, { name: "Visa", owed: "200" });
  await addAccount(page, { name: "Brokerage", balance: "5000", tracking: true });
  await addAccount(page, { name: "Main", balance: "1000" });

  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  const budget = sidebar.getByRole("list", { name: "Budget accounts" });
  const tracking = sidebar.getByRole("list", { name: "Tracking accounts" });
  await expect(budget.getByRole("link")).toHaveText([
    "All accounts",
    "Main$1,000.00",
    "Savings$500.00",
    "Visa-$200.00",
  ]);
  await expect(tracking.getByRole("link")).toHaveText(["Brokerage$5,000.00"]);
  await expect(budget.getByRole("link", { name: "Visa, balance -$200.00" })).toBeVisible();

  // The tracking list sits clearly below the budget accounts.
  const budgetBox = await budget.boundingBox();
  const trackingBox = await tracking.boundingBox();
  expect(trackingBox!.y - (budgetBox!.y + budgetBox!.height)).toBeGreaterThanOrEqual(12);

  await budget.getByRole("link", { name: "Savings" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Savings" })).toBeVisible();
  await expect(budget.getByRole("link", { name: "Savings" })).toHaveAttribute(
    "aria-current",
    "true",
  );

  await tracking.getByRole("link", { name: "Brokerage" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Brokerage" })).toBeVisible();

  await budget.getByRole("link", { name: "All accounts" }).click();
  await expect(page.getByRole("region", { name: "Transactions" })).toBeVisible();

  // Collapsed to icons, the sub-menu hides.
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(budget).toBeHidden();
});
