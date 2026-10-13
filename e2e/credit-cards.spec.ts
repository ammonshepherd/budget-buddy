import { expect, test } from "@playwright/test";
import { available, goTo, openAddTransaction, signInWithHousehold } from "./helpers";

test("a credit card account owes money and lowers Available to Assign", async ({ page }) => {
  await signInWithHousehold(page);
  await goTo(page, "Accounts");
  await page.getByLabel("Account name").fill("Checking");
  await page.getByLabel("Opening balance").fill("1000");
  await page.getByRole("button", { name: "Add account" }).click();

  // Choosing Credit card asks for the amount owed instead of a balance.
  const add = page.getByRole("form", { name: "Add an account" });
  await add.getByRole("radio", { name: "Credit card" }).check();
  await add.getByLabel("Account name").fill("Visa");
  await add.getByLabel("Amount owed on the opening date").fill("200");
  await add.getByRole("button", { name: "Add account" }).click();
  const visa = page.locator(".item", { hasText: "Visa" });
  await expect(visa).toContainText("-$200.00");
  await expect(visa).toContainText(/Credit card · opened \d{4}-\d\d-\d\d owing \$200\.00/);
  // The add form goes back to Checking for the next account.
  await expect(add.getByRole("radio", { name: "Checking" })).toBeChecked();

  await goTo(page, "Budget");
  await expect(available(page)).toContainText("$800.00");

  // A purchase on the card, entered from the Budget page.
  const dialog = await openAddTransaction(page);
  await dialog.getByLabel("Account").selectOption({ label: "Visa" });
  await dialog.getByLabel("Amount").fill("30");
  await dialog.getByLabel("Payee").fill("Gas");
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(dialog).toBeHidden();
  await expect(available(page)).toContainText("$770.00");

  // Editing keeps the type and shows the amount owed.
  await goTo(page, "Accounts");
  await expect(visa).toContainText("-$230.00");
  await visa.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("form", { name: "Edit Visa" });
  await expect(edit.getByRole("radiogroup", { name: "Account type" })).toHaveCount(0);
  await expect(edit.getByLabel("Amount owed on the opening date")).toHaveValue("200.00");
  await edit.getByLabel("Amount owed on the opening date").fill("250");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(visa).toContainText("-$280.00");
  await expect(visa).toContainText("owing $250.00");
});
