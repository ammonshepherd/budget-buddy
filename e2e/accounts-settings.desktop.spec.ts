import { expect, test, type Page } from "@playwright/test";
import { accountRow, goTo, openAccount, signInWithHousehold } from "./helpers";

// Accounts and Settings in the desktop layout (this project runs at 1280×800).

const panel = (page: Page) => page.locator("aside.side-panel");

test("Accounts adds in the panel; an open account edits and imports there", async ({ page }) => {
  await signInWithHousehold(page);
  await goTo(page, "Accounts");
  await expect(panel(page)).toHaveAccessibleName("Add an account");
  await expect(
    page.getByText("No accounts yet. Add your checking account on the right."),
  ).toBeVisible();
  // No + Add account button: the form is already in the panel.
  await expect(page.getByRole("button", { name: "Add account", exact: true })).toHaveCount(1);

  for (const [name, balance] of [
    ["Checking", "250"],
    ["Old Savings", "0"],
  ]) {
    await panel(page).getByLabel("Account name").fill(name);
    await panel(page).getByLabel("Opening balance").fill(balance);
    await panel(page).getByRole("button", { name: "Add account" }).click();
  }
  await expect(accountRow(page, "Checking")).toContainText("$250.00");

  // An open account: the pencil edits it in the panel, not in a sheet, and
  // focus goes back to the pencil afterwards.
  await accountRow(page, "Checking").click();
  const pencil = page.getByRole("button", { name: "Edit Checking" });
  await pencil.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(panel(page)).toHaveAccessibleName("Edit Checking");
  // The transactions stay in view beside it.
  await expect(page.getByRole("region", { name: "Transactions" })).toBeVisible();
  await panel(page).getByRole("button", { name: "Cancel" }).click();
  await expect(panel(page)).toHaveAccessibleName("To review");
  await expect(pencil).toBeFocused();
  await pencil.click();
  await panel(page).getByLabel("Account name").fill("Everyday Checking");
  await panel(page).getByRole("button", { name: "Save changes" }).click();
  await expect(panel(page)).toHaveAccessibleName("To review");
  await expect(page.getByRole("heading", { level: 2, name: "Everyday Checking" })).toBeVisible();

  // Import CSV opens in the panel too, already in this account.
  await page.getByRole("button", { name: "Import CSV" }).click();
  await expect(panel(page)).toHaveAccessibleName("Import CSV into Everyday Checking");
  await expect(panel(page).getByLabel("Bank CSV file")).toBeVisible();
  await expect(panel(page).getByLabel("Account", { exact: true })).toHaveCount(0);

  // Close account from the panel; it returns to the list, where it is hidden.
  await openAccount(page, "Old Savings");
  await page.getByRole("button", { name: "Edit Old Savings" }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await panel(page).getByRole("button", { name: "Close account" }).click();
  await expect(page.getByRole("button", { name: "Show closed accounts (1)" })).toBeVisible();
  await expect(panel(page)).toHaveAccessibleName("Add an account");
});

test("Settings shows its sections in two columns", async ({ page }) => {
  await signInWithHousehold(page);
  await goTo(page, "Settings");
  const groups = page.getByRole("region", { name: "Envelope groups" });
  const rules = page.getByRole("region", { name: "Income rules" });
  const plan = page.getByRole("region", { name: "Import envelope plan" });
  const imports = page.getByRole("region", { name: "Import transactions" });
  const [g, r, p, i] = await Promise.all(
    [groups, rules, plan, imports].map(async (l) => (await l.boundingBox())!),
  );
  // Income rules and the plan import sit side by side; the bank import spans both.
  expect(Math.abs(r.y - p.y)).toBeLessThan(4);
  expect(p.x).toBeGreaterThan(r.x + r.width - 1);
  expect(i.width).toBeGreaterThan(g.width * 1.8);
});
