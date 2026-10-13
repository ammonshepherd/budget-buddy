import { expect, test } from "@playwright/test";
import { addTransaction, available, goTo, signInWithHousehold } from "./helpers";

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

test("edit an account's name, opening balance and opening date", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await signInWithHousehold(page);
  await goTo(page, "Accounts");
  await page.getByLabel("Account name").fill("Checking");
  await page.getByLabel("Opening balance").fill("100");
  await page.getByLabel("Opening date").fill("2026-01-01");
  await page.getByRole("button", { name: "Add account" }).click();
  const row = page.locator(".item", { hasText: "Checking" });
  await expect(row).toContainText("opened 2026-01-01 with $100.00");

  // The edit form starts with the current details.
  await row.getByRole("button", { name: "Edit" }).click();
  const form = page.getByRole("form", { name: "Edit Checking" });
  await expect(form.getByLabel("Opening balance")).toHaveValue("100.00");
  await form.getByLabel("Account name").fill("Main checking");
  await form.getByLabel("Opening balance").fill("1,250.50");
  await form.getByRole("button", { name: "Save changes" }).click();
  const edited = page.locator(".item", { hasText: "Main checking" });
  await expect(edited).toContainText("$1,250.50");
  await expect(edited).toContainText("opened 2026-01-01 with $1,250.50");

  // The new opening balance flows into Available to Assign. (The purchase is
  // still to review, so it does not count until it gets an envelope.)
  await addTransaction(page, { amount: "50.50", payee: "Groceries" });
  await goTo(page, "Budget");
  await expect(available(page)).toContainText("$1,250.50");

  // The opening date cannot move past the account's first transaction.
  await goTo(page, "Accounts");
  await edited.getByRole("button", { name: "Edit" }).click();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const again = page.getByRole("form", { name: "Edit Main checking" });
  await again.getByLabel("Opening date").fill(iso(tomorrow));
  await again.getByRole("button", { name: "Save changes" }).click();
  await expect(again.getByRole("alert")).toHaveText(
    `Main checking has transactions from ${iso(new Date())}, so its opening date can be ${iso(new Date())} at the latest.`,
  );

  // Cancel leaves it unchanged.
  await again.getByRole("button", { name: "Cancel" }).click();
  await expect(edited).toContainText("opened 2026-01-01 with $1,250.50");
  await expect(edited).toContainText("$1,200.00");
});
