import { expect, test, type Page } from "@playwright/test";
import {
  addAccount,
  addGroupWithEnvelopes,
  available,
  editCell,
  envelope,
  goTo,
  signInWithHousehold,
} from "./helpers";

const assignedCell = (page: Page, name: string) => envelope(page, name).locator(".cell.assigned");
const moveButton = (page: Page, name: string) =>
  envelope(page, name).getByRole("button", { name: `Move money from ${name}`, exact: false });

test.beforeEach(async ({ page }) => {
  await signInWithHousehold(page);
  await addAccount(page, { name: "Checking", balance: "1000" });
  await addGroupWithEnvelopes(page, "Everyday", ["Groceries", "Gas"]);
  await editCell(page, "Groceries", "assigned", "100");
});

test("tapping what is left moves money to another envelope", async ({ page }) => {
  // Nothing left in Gas: its amount is not a button.
  await expect(moveButton(page, "Gas")).toHaveCount(0);

  await moveButton(page, "Groceries").click();
  const dialog = page.getByRole("dialog", { name: "Move money" });
  await expect(dialog).toContainText("$100.00 can be moved");
  // Starts with everything that can be moved.
  await expect(dialog.getByLabel("Amount to move")).toHaveValue("100.00");

  // More than is left is refused.
  await dialog.getByLabel("Move to").fill("Gas");
  await dialog.getByLabel("Move to").press("Enter");
  await dialog.getByLabel("Amount to move").fill("150");
  await dialog.getByRole("button", { name: "Move", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("You can move at most $100.00.");

  await dialog.getByLabel("Amount to move").fill("30");
  await dialog.getByRole("button", { name: "Move", exact: true }).click();
  await expect(dialog).toBeHidden();

  // Both Assigned amounts change; Available to Assign does not.
  await expect(assignedCell(page, "Groceries")).toContainText("$70.00");
  await expect(assignedCell(page, "Gas")).toContainText("$30.00");
  await expect(envelope(page, "Gas").locator(".envelope-remaining")).toHaveText("$30.00");
  await expect(available(page)).toContainText("$900.00");
});

test("money can go back to Available to Assign", async ({ page }) => {
  await moveButton(page, "Groceries").click();
  const dialog = page.getByRole("dialog", { name: "Move money" });
  const picker = dialog.getByLabel("Move to");
  await picker.fill("avail");
  const matches = dialog.getByRole("listbox", { name: "Matches" });
  await expect(matches.getByRole("option")).toHaveText(["Available to Assign has $900.00"]);
  await matches.getByRole("option").click();
  await dialog.getByLabel("Amount to move").fill("40");
  await dialog.getByRole("button", { name: "Move", exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(assignedCell(page, "Groceries")).toContainText("$60.00");
  await expect(available(page)).toContainText("$940.00");
});

test("past months and card payment envelopes cannot move money out", async ({ page }) => {
  await addAccount(page, { name: "Visa", owed: "200" });
  // An account opened last month, so there is money to assign there.
  const lastMonth = new Date();
  lastMonth.setDate(1);
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  const date = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}-01`;
  await addAccount(page, { name: "Savings", balance: "100", date });
  await goTo(page, "Budget");
  await expect(envelope(page, "Visa payment")).toBeVisible();
  await expect(envelope(page, "Visa payment").locator("button.envelope-left")).toHaveCount(0);

  // Money assigned in last month stays there: a move would change this month's Saved.
  await page.getByRole("link", { name: "Previous month" }).click();
  const unused = page.getByRole("button", { name: /show unused/i });
  if (await unused.isVisible()) await unused.click();
  await editCell(page, "Gas", "assigned", "50");
  await expect(envelope(page, "Gas").locator(".envelope-remaining")).toHaveText("$50.00");
  await expect(moveButton(page, "Gas")).toHaveCount(0);
});
