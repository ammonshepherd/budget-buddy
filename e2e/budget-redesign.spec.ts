import { expect, test, type Page } from "@playwright/test";
import {
  addGroupWithEnvelopes,
  addTransaction,
  available,
  editCell,
  envelope,
  goTo,
  signInWithHousehold,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await signInWithHousehold(page);
  await goTo(page, "Accounts");
  await page.getByLabel("Account name").fill("Checking");
  await page.getByLabel("Opening balance").fill("1000");
  await page.getByRole("button", { name: "Add account" }).click();
  await addGroupWithEnvelopes(page, "Everyday", ["Groceries", "Fun"]);
});

const cell = (page: Page, name: string, which: "planned" | "assigned") =>
  envelope(page, name).getByRole("button", { name: new RegExp(`^Edit ${which} amount`) });
const field = (page: Page, name: string, which: "Planned" | "Assigned") =>
  envelope(page, name).getByRole("textbox", { name: `${which} amount for ${name}` });

test("Planned is edited in place and changes nothing else", async ({ page }) => {
  await expect(available(page)).toContainText("$1,000.00");

  // Tapping opens a field with the current amount, selected.
  await cell(page, "Groceries", "planned").click();
  const input = field(page, "Groceries", "Planned");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("0.00");

  // Tapping anywhere else saves.
  await input.fill("300");
  await available(page).click();
  await expect(cell(page, "Groceries", "planned")).toHaveAccessibleName(
    "Edit planned amount for Groceries, currently $300.00",
  );

  // Enter saves (rounded to the cent) and focus returns to the cell.
  await cell(page, "Groceries", "planned").click();
  await input.fill("$1,200.505");
  await input.press("Enter");
  await expect(cell(page, "Groceries", "planned")).toContainText("$1,200.51");
  await expect(cell(page, "Groceries", "planned")).toBeFocused();

  // Escape cancels.
  await cell(page, "Groceries", "planned").click();
  await input.fill("5");
  await input.press("Escape");
  await expect(cell(page, "Groceries", "planned")).toContainText("$1,200.51");

  // Not a number, or negative: the amount stays and the row says why.
  await editCell(page, "Groceries", "planned", "abc");
  await expect(envelope(page, "Groceries").getByRole("alert")).toHaveText(
    "Planned: enter an amount like 12.34",
  );
  await editCell(page, "Groceries", "planned", "-5");
  await expect(envelope(page, "Groceries").getByRole("alert")).toHaveText(
    "Planned cannot be negative.",
  );
  await expect(cell(page, "Groceries", "planned")).toContainText("$1,200.51");

  // Planned is a forecast only.
  await expect(available(page)).toContainText("$1,000.00");
  await expect(envelope(page, "Groceries").locator(".envelope-remaining")).toHaveText("$0.00");
});

test("Assigned is edited in place and moves Available to Assign", async ({ page }) => {
  await editCell(page, "Groceries", "assigned", "300");
  await expect(available(page)).toContainText("$700.00");
  await expect(envelope(page, "Groceries").locator(".envelope-remaining")).toHaveText("$300.00");

  // More than is available: blocked, and the amount stays.
  await editCell(page, "Groceries", "assigned", "1500");
  await expect(envelope(page, "Groceries").getByRole("alert")).toHaveText(
    "Only $700.00 available to assign.",
  );
  await expect(cell(page, "Groceries", "assigned")).toContainText("$300.00");

  // Lower than what is already spent: blocked too.
  await addTransaction(page, { amount: "120", payee: "Market", envelope: "Groceries" });
  await goTo(page, "Budget");
  await editCell(page, "Groceries", "assigned", "100");
  await expect(envelope(page, "Groceries").getByRole("alert")).toHaveText(
    "Some is already spent: Assigned can go no lower than $120.00.",
  );

  // Lowering to exactly what is spent returns the rest; Remaining shows muted at $0.00.
  await editCell(page, "Groceries", "assigned", "120");
  await expect(available(page)).toContainText("$880.00");
  const left = envelope(page, "Groceries").locator(".envelope-left");
  await expect(left).toHaveText("$0.00 remaining");
  await expect(left).toHaveClass(/zero/);
});

test("tapping another cell saves the one being edited", async ({ page }) => {
  await cell(page, "Groceries", "planned").click();
  await field(page, "Groceries", "Planned").fill("50");
  await cell(page, "Fun", "assigned").click();
  await expect(cell(page, "Groceries", "planned")).toContainText("$50.00");
  // Only one field is open: Fun's Assigned.
  await expect(field(page, "Fun", "Assigned")).toBeFocused();
  await expect(page.getByRole("textbox", { name: /amount for/ })).toHaveCount(1);
});

test("Spent shows whether the month kept to Planned; groups show no totals", async ({ page }) => {
  await editCell(page, "Groceries", "assigned", "200");
  await editCell(page, "Groceries", "planned", "100");
  await addTransaction(page, { amount: "100", payee: "Market", envelope: "Groceries" });
  await goTo(page, "Budget");

  // Spent equal to Planned is within plan.
  const spent = envelope(page, "Groceries").locator(".cell.spent");
  await expect(spent).toHaveText("Spent $100.00");
  await expect(spent).not.toHaveClass(/over/);

  // Above Planned it is over plan, which is not overspending: no Short, no warning.
  await editCell(page, "Groceries", "planned", "99.99");
  await expect(spent).toHaveText("Spent · over Planned $100.00");
  await expect(spent).toHaveClass(/over/);
  await expect(envelope(page, "Groceries")).not.toContainText("Short");
  await expect(available(page)).not.toHaveClass(/over/);

  const heading = page.getByRole("region", { name: "Everyday" }).locator(".group-heading");
  await expect(heading).not.toContainText("$");
  await expect(heading.getByRole("button", { name: "Add envelope to Everyday" })).toBeVisible();

  // Saved: quiet at $0.00, purple with a star and six sparkles once money is saved.
  await editCell(page, "Fun", "assigned", "40");
  await expect(envelope(page, "Fun").locator(".saved-chip")).toHaveText("Saved $0.00");
  await expect(envelope(page, "Fun").locator(".saved-chip svg")).toHaveCount(0);
  await page.getByRole("link", { name: "Next month" }).click();
  const chip = envelope(page, "Fun").locator(".saved-chip.sparkle");
  await expect(chip).toHaveText("Saved $40.00");
  await expect(chip.locator('svg[aria-hidden="true"]')).toHaveCount(7);
});
