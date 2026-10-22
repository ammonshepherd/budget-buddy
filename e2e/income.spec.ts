import { expect, test } from "@playwright/test";
import { addAccount, available, goTo, openAddTransaction, signInWithHousehold } from "./helpers";

test("inflows wait for review until marked Income", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await signInWithHousehold(page);
  await addAccount(page, { name: "Checking", balance: "100" });

  // Two inflows left Uncategorized, and Income is only for inflows.
  for (const [payee, amount] of [
    ["Paycheck", "1500"],
    ["Side job", "250"],
  ]) {
    const dialog = await openAddTransaction(page);
    const income = dialog.getByRole("option", { name: "Income (to Available to Assign)" });
    await dialog.getByLabel("Envelope").click();
    await expect(income).toHaveAttribute("aria-disabled", "true");
    await dialog.getByLabel("Envelope").press("Escape");
    await dialog.getByRole("radio", { name: "Inflow" }).check();
    await dialog.getByLabel("Envelope").click();
    await expect(income).not.toHaveAttribute("aria-disabled");
    await dialog.getByLabel("Envelope").press("Escape");
    await dialog.getByLabel("Amount").fill(amount);
    await dialog.getByLabel("Payee").fill(payee);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();
  }

  await goTo(page, "Budget");
  await expect(available(page)).toContainText("$100.00");
  // The banner shows only what is left to assign (no income line).
  await expect(available(page)).not.toContainText("Income this month");
  await expect(
    page.getByText(
      "2 transactions to review ($1,750.00 in, $0.00 out) are not in Available to Assign yet.",
    ),
  ).toBeVisible();

  await page.getByRole("link", { name: "Review them in All accounts" }).click();
  const review = page.getByRole("region", { name: "To review" });
  await expect(review).toContainText(
    "$1,750.00 in and $0.00 out are not in Available to Assign yet.",
  );
  await review.getByRole("button", { name: "Mark all 2 inflows as Income" }).click();
  await expect(review).toHaveCount(0);

  await goTo(page, "Budget");
  await expect(available(page)).toContainText("$1,850.00");
  await expect(page.getByText("not in Available to Assign yet")).toHaveCount(0);
});
