import { expect, test, type Page } from "@playwright/test";
import {
  openAccount,
  activityRow,
  addGroupWithEnvelopes,
  chooseEnvelope,
  editCell,
  signInWithHousehold,
  addAccount,
  openAllAccounts,
} from "./helpers";

// Activity in the desktop layout (this project runs at 1280×800).

const panel = (page: Page) => page.locator("aside.side-panel");
const newRow = (page: Page) => page.getByRole("form", { name: "New transaction" });
const addButton = (page: Page) =>
  page.getByRole("complementary", { name: "Sidebar" }).getByRole("button", {
    name: "Add transaction",
  });

const newAccount = (page: Page, name: string, balance: string) =>
  addAccount(page, { name, balance });

async function setUp(page: Page) {
  await signInWithHousehold(page);
  await newAccount(page, "Checking", "1000");
  await addGroupWithEnvelopes(page, "Everyday", ["Groceries"]);
  await editCell(page, "Groceries", "assigned", "100");
  await openAllAccounts(page);
}

test("Add transaction opens a new row at the top of the list", async ({ page }) => {
  await setUp(page);
  await addButton(page).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(newRow(page)).toBeVisible();
  await expect(newRow(page).getByLabel("Payee")).toBeFocused();

  await newRow(page).getByLabel("Payee").fill("Corner Market");
  await newRow(page).getByLabel("Amount").fill("12.50");
  await chooseEnvelope(newRow(page).getByLabel("Envelope"), "Groceries");
  await newRow(page).getByLabel("Memo").fill("milk and eggs");
  await newRow(page).getByRole("button", { name: "Save", exact: true }).click();

  await expect(newRow(page)).toHaveCount(0);
  const row = activityRow(page, "Corner Market");
  await expect(row).toContainText("Groceries");
  await expect(row.locator(".activity-memo")).toHaveText("milk and eggs");
  await expect(row).toContainText("−$12.50");

  // Escape and Cancel close it without adding.
  await addButton(page).click();
  await newRow(page).getByLabel("Payee").fill("Never mind");
  await page.keyboard.press("Escape");
  await expect(newRow(page)).toHaveCount(0);
  await addButton(page).click();
  await newRow(page).getByRole("button", { name: "Cancel" }).click();
  await expect(newRow(page)).toHaveCount(0);
  await expect(activityRow(page, "Never mind")).toHaveCount(0);
});

test("the new row starts in the open account and runs the cover prompt", async ({ page }) => {
  await setUp(page);
  await newAccount(page, "Savings", "500");
  await openAccount(page, "Savings");

  await addButton(page).click();
  const account = newRow(page).getByRole("combobox", { name: "Account" });
  expect(await account.evaluate((s: HTMLSelectElement) => s.selectedOptions[0]?.text)).toBe(
    "Savings",
  );
  await newRow(page).getByLabel("Payee").fill("Big Shop");
  await newRow(page).getByLabel("Amount").fill("150");
  await chooseEnvelope(newRow(page).getByLabel("Envelope"), "Groceries");
  await newRow(page).getByRole("button", { name: "Save", exact: true }).click();

  // Groceries has $100: the cover prompt shows in the row.
  const cover = page.getByRole("alertdialog");
  await expect(cover).toContainText("Groceries would be $50.00 short");
  const from = cover.getByRole("combobox");
  const available = from.locator("option", { hasText: "Available to Assign" });
  await from.selectOption((await available.getAttribute("value"))!);
  await cover.getByRole("button", { name: "Cover and save" }).click();
  await expect(newRow(page)).toHaveCount(0);
  // Saved in Savings: it is in this account's list.
  await expect(activityRow(page, "Big Shop")).toContainText("Groceries");
});

test("transactions edit in the panel, which shows To review otherwise", async ({ page }) => {
  await setUp(page);
  for (const payee of ["Paycheck", "Shell"]) {
    await addButton(page).click();
    if (payee === "Paycheck") await newRow(page).getByRole("radio", { name: "Inflow" }).check();
    await newRow(page).getByLabel("Payee").fill(payee);
    await newRow(page)
      .getByLabel("Amount")
      .fill(payee === "Paycheck" ? "800" : "30");
    await newRow(page).getByRole("button", { name: "Save", exact: true }).click();
    await expect(newRow(page)).toHaveCount(0);
  }

  // The totals sit in the info pane above the list, not in the band or the
  // panel; the payee is bold only while it waits for review.
  await expect(page.locator(".account-pane .activity-totals")).toContainText("Balance today");
  await expect(page.locator(".activity-band .activity-totals")).toHaveCount(0);
  await expect(panel(page).locator(".activity-totals")).toHaveCount(0);
  await expect(activityRow(page, "Shell").locator(".activity-payee")).toHaveCSS(
    "font-weight",
    "700",
  );

  // To review lives in the panel, not above the list.
  await expect(panel(page)).toHaveAccessibleName("To review");
  await expect(panel(page).getByRole("list", { name: "To review" })).toContainText("Shell");
  await expect(page.locator(".activity-page > .activity-review")).toHaveCount(0);
  await panel(page).getByRole("button", { name: "Mark as Income" }).click();
  await expect(activityRow(page, "Paycheck")).toContainText("Income");

  // Tapping a row edits it in the panel.
  await activityRow(page, "Shell").locator(".activity-who").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(panel(page)).toHaveAccessibleName("Edit transaction");
  await expect(activityRow(page, "Shell")).toHaveClass(/selected/);
  const form = panel(page).getByRole("form", { name: "Edit transaction" });
  await chooseEnvelope(form.getByLabel("Envelope"), "Groceries");
  await form.getByRole("button", { name: "Save changes" }).click();

  await expect(panel(page)).toHaveAccessibleName("To review");
  await expect(panel(page)).toContainText("Nothing to review");
  await expect(activityRow(page, "Shell")).toContainText("Groceries");
  await expect(activityRow(page, "Shell").locator(".activity-payee")).toHaveCSS(
    "font-weight",
    "400",
  );

  // And deletes from there.
  await activityRow(page, "Shell").locator(".activity-who").click();
  page.once("dialog", (dialog) => void dialog.accept());
  await panel(page).getByRole("button", { name: "Delete transaction" }).click();
  await expect(activityRow(page, "Shell")).toHaveCount(0);
  await expect(panel(page)).toHaveAccessibleName("To review");
});
