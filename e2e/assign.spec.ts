import { expect, test, type Page } from "@playwright/test";
import {
  addAccount,
  addGroupWithEnvelopes,
  available,
  editAccount,
  editCell,
  envelope,
  goTo,
  signInWithHousehold,
} from "./helpers";

const assignedCell = (page: Page, name: string) =>
  envelope(page, name).getByRole("button", { name: /^Edit assigned amount/ });

test.beforeEach(async ({ page }) => {
  await signInWithHousehold(page);
  await addAccount(page, { name: "Checking", balance: "1000" });
  await addGroupWithEnvelopes(page, "Everyday", ["Groceries", "Gas"]);
  await addGroupWithEnvelopes(page, "Bills", ["Car insurance"]);
  await editCell(page, "Groceries", "assigned", "100");
});

test("the banner is solid green with only Available to Assign", async ({ page }) => {
  const banner = available(page);
  await expect(banner).toHaveText("Available to Assign$900.00");
  await expect(banner).toHaveCSS("background-color", "rgb(31, 122, 69)");
  // The same type sizes as the Credit card debt strip.
  await expect(banner.locator(".assign-label")).toHaveCSS("font-size", "14px");
  await expect(banner.locator(".money")).toHaveCSS("font-size", "26px");
});

test("the banner opens a dialog that adds to an envelope's Assigned", async ({ page }) => {
  await available(page).getByRole("button").click();
  const dialog = page.getByRole("dialog", { name: "Assign money" });
  await expect(dialog).toContainText("$900.00 available");

  // Type to find the envelope: matches show what each has.
  const picker = dialog.getByLabel("Envelope");
  await picker.fill("gro");
  const matches = dialog.getByRole("listbox", { name: "Matches" });
  await expect(matches.getByRole("option")).toHaveText(["Groceries has $100.00"]);
  await matches.getByRole("option").click();
  await dialog.getByLabel("Amount to add").fill("50");
  await dialog.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(dialog).toBeHidden();

  // Added on top of the $100 already there.
  await expect(assignedCell(page, "Groceries")).toContainText("$150.00");
  await expect(available(page)).toContainText("$850.00");

  // Typing the full name works too; more than is available is refused.
  await available(page).getByRole("button").click();
  await dialog.getByLabel("Envelope").fill("car insurance");
  await dialog.getByLabel("Envelope").press("Enter");
  await expect(dialog.getByLabel("Envelope")).toHaveValue("Car insurance");
  await dialog.getByLabel("Amount to add").fill("2000");
  await dialog.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText(/Only \$850\.00 is available to assign/);
  // Cancel is a text link under Assign.
  const cancel = dialog.getByRole("button", { name: "Cancel" });
  const assignBox = await dialog.getByRole("button", { name: "Assign", exact: true }).boundingBox();
  const cancelBox = await cancel.boundingBox();
  expect(cancelBox!.y).toBeGreaterThan(assignBox!.y + assignBox!.height);
  await expect(cancel).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await cancel.click();
  await expect(dialog).toBeHidden();
  await expect(available(page)).toContainText("$850.00");
});

test("when over assigned the banner is red and takes money back", async ({ page }) => {
  // Lower the opening balance below what is assigned.
  const edit = await editAccount(page, "Checking");
  await edit.getByLabel("Opening balance").fill("60");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await goTo(page, "Budget");

  const banner = available(page);
  await expect(banner).toHaveText("Over Assigned$40.00");
  await expect(banner).toHaveCSS("background-color", "rgb(179, 38, 30)");

  await banner.getByRole("button").click();
  const dialog = page.getByRole("dialog", { name: "Assign money" });
  await expect(dialog).toContainText("Over Assigned by $40.00");
  await expect(dialog.getByLabel("Amount to take back")).toHaveValue("40.00");
  await dialog.getByLabel("Envelope").fill("Groceries");
  await dialog.getByLabel("Envelope").press("Enter");
  await dialog.getByRole("button", { name: "Take back" }).click();
  await expect(dialog).toBeHidden();

  await expect(assignedCell(page, "Groceries")).toContainText("$60.00");
  // Exactly $0.00 left to assign: the banner hides.
  await expect(banner).toHaveCount(0);
});

test("the number pad adds and takes away, showing the equation in the cell", async ({ page }) => {
  await assignedCell(page, "Gas").click();
  const pad = page.getByRole("dialog", { name: "Assigned for Gas" });
  const press = async (...keys: string[]) => {
    for (const key of keys) await pad.getByRole("button", { name: key, exact: true }).click();
  };

  // Digits first: a new total, filled in cents first.
  await press("8", "0");
  await expect(assignedCell(page, "Gas")).toContainText("0.80");
  await press("0", "0");
  await expect(assignedCell(page, "Gas")).toContainText("80.00");
  await press("Assign");
  await expect(pad).toBeHidden();
  await expect(assignedCell(page, "Gas")).toContainText("$80.00");
  await expect(available(page)).toContainText("$820.00");

  // Plus adds to it; a period switches to plain entry ("20" then "." is $20).
  await assignedCell(page, "Gas").click();
  await press("Plus", "2", "0", "Decimal point", "5");
  await expect(assignedCell(page, "Gas")).toContainText("80.00 + 20.5");
  await expect(pad).toContainText("= $100.50");
  await press("Assign");
  await expect(assignedCell(page, "Gas")).toContainText("$100.50");
  await expect(available(page)).toContainText("$799.50");

  // Minus returns money to Available to Assign.
  await assignedCell(page, "Gas").click();
  await press("Minus", "3", "0", "0", "0");
  await expect(assignedCell(page, "Gas")).toContainText("100.50 − 30.00");
  await press("Assign");
  await expect(assignedCell(page, "Gas")).toContainText("$70.50");
  await expect(available(page)).toContainText("$829.50");

  // Cancel (or tapping outside) changes nothing.
  await assignedCell(page, "Gas").click();
  await press("Plus", "9");
  await pad.getByRole("button", { name: "Cancel" }).click();
  await expect(pad).toBeHidden();
  await expect(assignedCell(page, "Gas")).toContainText("$70.50");
  await assignedCell(page, "Gas").click();
  await page.mouse.click(10, 10);
  await expect(pad).toBeHidden();

  // Below zero is refused.
  await assignedCell(page, "Gas").click();
  await press("Minus", "1", "0", "0", "0", "0", "Assign");
  await expect(pad.getByRole("alert")).toHaveText("Assigned cannot be negative.");
});
