import { expect, test } from "@playwright/test";
import { goTo, openAddTransaction, signInWithHousehold } from "./helpers";

test("transactions sit under collapsible dates and open by tapping", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await signInWithHousehold(page);
  await goTo(page, "Accounts");
  await page.getByLabel("Account name").fill("Checking");
  await page.getByLabel("Opening balance").fill("500");
  await page.getByLabel("Opening date").fill("2030-01-01");
  await page.getByRole("button", { name: "Add account" }).click();

  for (const [payee, date] of [
    ["Coffee", "2030-01-02"],
    ["Lunch", "2030-01-02"],
    ["Books", "2030-01-03"],
  ]) {
    const dialog = await openAddTransaction(page);
    await dialog.getByLabel("Amount").fill("5");
    await dialog.getByLabel("Payee").fill(payee);
    await dialog.getByLabel("Date").fill(date);
    await dialog.getByRole("button", { name: "Add transaction" }).click();
    await expect(dialog).toBeHidden();
  }

  await goTo(page, "Activity");
  const list = page.getByRole("region", { name: "Transactions" });
  const days = list.locator("details.day-group");
  // Newest date first; each date lists its own transactions.
  await expect(days.locator("summary")).toHaveText([
    "Thursday, January 3, 20301",
    "Wednesday, January 2, 20302",
  ]);
  const jan2 = days.filter({ hasText: "January 2" });
  await expect(jan2.locator(".item")).toHaveCount(2);

  // Rows have no Edit or Delete links, and Uncategorized stands out.
  await expect(list.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(list.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
  await expect(list.locator(".badge-uncategorized").first()).toHaveText("Uncategorized");

  // Collapsing a date hides its transactions.
  await jan2.locator("summary").click();
  await expect(jan2.locator(".item").first()).toBeHidden();
  await jan2.locator("summary").click();

  // Tapping a row opens the edit dialog, which can delete it.
  await jan2.locator(".item", { hasText: "Lunch" }).click();
  const edit = page.getByRole("dialog", { name: "Edit transaction" });
  await expect(edit.getByLabel("Payee")).toHaveValue("Lunch");
  await edit.getByRole("button", { name: "Delete transaction" }).click();
  await expect(edit).toBeHidden();
  await expect(jan2.locator(".item")).toHaveCount(1);
});
