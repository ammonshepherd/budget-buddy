import { expect, test, type Page } from "@playwright/test";
import {
  addGroupWithEnvelopes,
  available,
  chooseEnvelope,
  editCell,
  envelope,
  goTo,
  signInWithHousehold,
} from "./helpers";

// The desktop layout (1000px and up; this project runs at 1280×800).

const panel = (page: Page) => page.locator("aside.side-panel");

/** Adds an outflow through the sidebar's Add transaction (the dialog, on Budget). */
async function addTransaction(page: Page, tx: { amount: string; payee: string; envelope: string }) {
  await goTo(page, "Budget");
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a transaction" });
  await dialog.getByLabel("Amount").fill(tx.amount);
  await dialog.getByLabel("Payee").fill(tx.payee);
  await chooseEnvelope(dialog.getByLabel("Envelope"), tx.envelope);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function setUp(page: Page) {
  await signInWithHousehold(page);
  await goTo(page, "Accounts");
  await page.getByLabel("Account name").fill("Checking");
  await page.getByLabel("Opening balance").fill("1000");
  await page.getByRole("button", { name: "Add account" }).click();
  await addGroupWithEnvelopes(page, "Everyday", ["Groceries", "Gas"]);
  await editCell(page, "Groceries", "planned", "100");
  await editCell(page, "Groceries", "assigned", "300");
}

test("a sidebar takes the place of the header and the bottom bar", async ({ page }) => {
  await signInWithHousehold(page);
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  await expect(sidebar.getByLabel("Application version")).toHaveText(/^v\d+\.\d+\.\d+$/);
  await expect(sidebar).toContainText("test@example.com");
  await expect(page.locator(".app-header")).toHaveCount(0);
  await expect(page.locator(".bottom-nav")).toHaveCount(0);
  await expect(page.locator(".fab")).toHaveCount(0);

  for (const name of ["Accounts", "Activity", "Settings", "Budget"] as const) {
    await goTo(page, name);
    await expect(page.getByRole("heading", { level: 1, name })).toBeAttached();
  }
  // No Add transaction on Settings.
  await goTo(page, "Settings");
  await expect(sidebar.getByRole("button", { name: "Add transaction" })).toHaveCount(0);
  await goTo(page, "Budget");
  await expect(sidebar.getByRole("button", { name: "Add transaction" })).toBeVisible();

  // Collapsed to icons: the pages keep their names, and it is remembered.
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar).toHaveClass(/collapsed/);
  await expect(sidebar.getByText("test@example.com")).toBeHidden();
  await goTo(page, "Accounts");
  await expect(page).toHaveURL(/#accounts$/);
  expect(
    await page.evaluate(() =>
      Object.entries(localStorage).find(([key]) => key.startsWith("bb.layout.navCollapsed.")),
    ),
  ).toEqual([expect.any(String), "1"]);
  await sidebar.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(sidebar).not.toHaveClass(/collapsed/);
});

test("envelopes are one-line rows under a band with the month and Available to Assign", async ({
  page,
}) => {
  await setUp(page);
  const band = page.locator(".budget-band");
  await expect(band.getByRole("link", { name: "Next month" })).toBeVisible();
  await expect(band.getByRole("region", { name: "Available to Assign" })).toContainText("$700.00");

  // Planned, Assigned, Spent and Remaining sit on the name's line.
  const row = envelope(page, "Groceries");
  const name = await row.locator(".envelope-name").boundingBox();
  for (const cell of [".cell.planned", ".cell.assigned", ".cell.spent", ".envelope-left"]) {
    const box = await row.locator(cell).boundingBox();
    expect(Math.abs(box!.y + box!.height / 2 - (name!.y + name!.height / 2))).toBeLessThan(12);
  }
  await expect(row.locator(".envelope-left")).toContainText("$300.00");

  // The band stays at the top while the page scrolls.
  await page.mouse.wheel(0, 400);
  expect((await available(page).boundingBox())!.y).toBeLessThan(40);
});

test("the panel shows the month, then the chosen envelope", async ({ page }) => {
  await setUp(page);
  await addTransaction(page, { amount: "150", payee: "Corner Market", envelope: "Groceries" });
  await goTo(page, "Budget");

  // Nothing chosen: this month at a glance, with what is over Planned.
  await expect(panel(page)).toContainText("This month at a glance");
  await expect(panel(page).locator(".summary-stat", { hasText: "Spent" })).toContainText("$150.00");
  const over = panel(page).getByRole("region", { name: "Spent over Planned" });
  await expect(over).toContainText("Groceries");
  await expect(over).toContainText("$50.00 over");

  // Choosing an envelope shows it in the panel, not in a sheet.
  await envelope(page, "Groceries").locator(".envelope-top").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(panel(page)).toHaveAccessibleName("Groceries envelope");
  await expect(panel(page)).toContainText("Remaining this month");
  await expect(envelope(page, "Groceries")).toHaveClass(/selected/);
  await expect(envelope(page, "Groceries").locator(".envelope-top")).toHaveAttribute(
    "aria-expanded",
    "true",
  );

  // Its Assigned edits from the panel too.
  const assigned = panel(page).getByRole("textbox", { name: "Assigned amount for Groceries" });
  await assigned.fill("350");
  await assigned.press("Enter");
  await expect(envelope(page, "Groceries").locator(".envelope-left")).toContainText("$200.00");

  // A watch-list entry opens its envelope; × goes back to the summary.
  await panel(page).getByRole("button", { name: "Close" }).click();
  await expect(panel(page)).toContainText("This month at a glance");
  await over.getByRole("button", { name: /Groceries/ }).click();
  await expect(panel(page)).toHaveAccessibleName("Groceries envelope");
});

test("a transaction is edited in the panel and returns to its envelope", async ({ page }) => {
  await setUp(page);
  await addTransaction(page, { amount: "40", payee: "Corner Market", envelope: "Groceries" });
  await goTo(page, "Budget");
  await envelope(page, "Groceries").locator(".envelope-top").click();

  await panel(page)
    .getByRole("button", { name: /^Edit Corner Market/ })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const form = panel(page).getByRole("form", { name: "Edit transaction" });
  await form.getByLabel("Payee").fill("Farmers Market");
  await form.getByLabel("Amount").fill("45");
  await form.getByRole("button", { name: "Save changes" }).click();

  await expect(panel(page)).toHaveAccessibleName("Groceries envelope");
  await expect(panel(page)).toContainText("Farmers Market");
  await expect(envelope(page, "Groceries").locator(".cell.spent")).toContainText("$45.00");

  // Back without saving.
  await panel(page)
    .getByRole("button", { name: /^Edit Farmers Market/ })
    .click();
  await panel(page).getByRole("button", { name: "‹ Back to Groceries" }).click();
  await expect(panel(page)).toContainText("Remaining this month");
});

test("the panel collapses to a rail and opens when an envelope is chosen", async ({ page }) => {
  await setUp(page);
  await panel(page).getByRole("button", { name: "Hide panel" }).click();
  await expect(panel(page)).toHaveClass(/collapsed/);
  await expect(panel(page)).not.toContainText("This month at a glance");
  expect((await panel(page).boundingBox())!.width).toBeLessThan(60);

  await envelope(page, "Gas").locator(".envelope-top").click();
  await expect(panel(page)).not.toHaveClass(/collapsed/);
  await expect(panel(page)).toHaveAccessibleName("Gas envelope");

  await panel(page).getByRole("button", { name: "Hide panel" }).click();
  await panel(page).getByRole("button", { name: "Show panel" }).click();
  await expect(panel(page)).toHaveAccessibleName("Gas envelope");
});

test("the dialog still adds transactions from the sidebar on Budget", async ({ page }) => {
  await setUp(page);
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add a transaction" })).toBeVisible();
});
