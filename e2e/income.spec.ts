import { expect, test } from "@playwright/test";
import { available, goTo, openAddTransaction, signInWithHousehold } from "./helpers";

test("inflows wait for review until marked Income", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await signInWithHousehold(page);
  await goTo(page, "Accounts");
  await page.getByLabel("Account name").fill("Checking");
  await page.getByLabel("Opening balance").fill("100");
  await page.getByRole("button", { name: "Add account" }).click();

  // Two inflows left Uncategorized, and Income is only for inflows.
  for (const [payee, amount] of [
    ["Paycheck", "1500"],
    ["Side job", "250"],
  ]) {
    const dialog = await openAddTransaction(page);
    const income = dialog.locator("option", { hasText: "Income (to Available to Assign)" });
    await expect(income).toHaveAttribute("disabled");
    await dialog.getByRole("radio", { name: "Inflow" }).check();
    await expect(income).not.toHaveAttribute("disabled");
    await dialog.getByLabel("Amount").fill(amount);
    await dialog.getByLabel("Payee").fill(payee);
    await dialog.getByRole("button", { name: "Add transaction" }).click();
    await expect(dialog).toBeHidden();
  }

  await goTo(page, "Budget");
  await expect(available(page)).toContainText("$100.00");
  await expect(available(page)).toContainText("Income this month $0.00");
  await expect(
    page.getByText(
      "2 transactions to review ($1,750.00 in, $0.00 out) are not in Available to Assign yet.",
    ),
  ).toBeVisible();

  await page.getByRole("link", { name: "Review them on Activity" }).click();
  const review = page.getByRole("region", { name: "To review" });
  await expect(review).toContainText(
    "$1,750.00 in and $0.00 out are not in Available to Assign yet.",
  );
  await review.getByRole("button", { name: "Mark all 2 inflows as Income" }).click();
  await expect(review).toHaveCount(0);

  await goTo(page, "Budget");
  await expect(available(page)).toContainText("$1,850.00");
  await expect(available(page)).toContainText("Income this month $1,750.00");
  await expect(page.getByText("not in Available to Assign yet")).toHaveCount(0);
});
