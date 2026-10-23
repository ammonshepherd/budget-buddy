import { expect, test, type Page } from "@playwright/test";
import {
  activityRow,
  addAccount,
  addGroupWithEnvelopes,
  choosePageMenu,
  goTo,
  menuOption,
  openAccount,
  openAddTransaction,
  openPageMenu,
  signInWithHousehold,
} from "./helpers";

/** The page menu: three bars in the phone header, with options for the page showing. */

const groupToggle = (page: Page, name: string) =>
  page.getByRole("region", { name, exact: true }).locator(".group-heading h2").getByRole("button");

async function add(
  page: Page,
  tx: { payee: string; amount: string; date: string; inflow?: boolean },
) {
  const dialog = await openAddTransaction(page);
  if (tx.inflow) await dialog.getByRole("radio", { name: "Inflow" }).check();
  await dialog.getByLabel("Amount").first().fill(tx.amount);
  await dialog.getByLabel("Payee").fill(tx.payee);
  await dialog.getByLabel("Date").fill(tx.date);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
}

const payees = (page: Page) =>
  page.getByRole("region", { name: "Transactions" }).locator(".activity-payee");

test("the header has the menu, not the version; Escape or a tap outside closes it", async ({
  page,
}) => {
  await signInWithHousehold(page);
  const header = page.locator(".app-header");
  await expect(header.getByLabel("Application version")).toHaveCount(0);
  const button = header.getByRole("button", { name: "Budget menu" });
  await expect(button).toHaveAttribute("aria-expanded", "false");

  const menu = await openPageMenu(page);
  await expect(button).toHaveAttribute("aria-expanded", "true");
  // The first option takes focus; arrows move between options.
  await expect(menuOption(menu, "Compact rows")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menuOption(menu, "Edit groups")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();

  await openPageMenu(page);
  // A tap on the page, left of the list (which opens on the right).
  await page.mouse.click(16, 500);
  await expect(page.getByRole("menu")).toBeHidden();
});

test("Budget: collapse all groups, go to this month, edit groups", async ({ page }) => {
  await signInWithHousehold(page);
  await addAccount(page, { name: "Checking", balance: "1000" });
  await addGroupWithEnvelopes(page, "Everyday", ["Groceries"]);
  await addGroupWithEnvelopes(page, "Bills", ["Rent"]);

  await choosePageMenu(page, "Collapse all groups");
  await expect(groupToggle(page, "Everyday")).toHaveAttribute("aria-expanded", "false");
  await expect(groupToggle(page, "Bills")).toHaveAttribute("aria-expanded", "false");
  // All collapsed: the option opens them again.
  await choosePageMenu(page, "Expand all groups");
  await expect(groupToggle(page, "Everyday")).toHaveAttribute("aria-expanded", "true");
  await expect(groupToggle(page, "Bills")).toHaveAttribute("aria-expanded", "true");

  // Go to this month shows only in another month.
  let menu = await openPageMenu(page);
  await expect(menuOption(menu, "Go to this month")).toHaveCount(0);
  await page.keyboard.press("Escape");
  const thisMonth = await page.locator(".budget-month span").textContent();
  await page.getByRole("link", { name: "Previous month" }).click();
  await expect(page.locator(".budget-month span")).not.toHaveText(thisMonth!);
  await choosePageMenu(page, "Go to this month");
  await expect(page.locator(".budget-month span")).toHaveText(thisMonth!);

  // Edit groups opens Settings at the envelope groups.
  menu = await openPageMenu(page);
  await menuOption(menu, "Edit groups").click();
  await expect(page).toHaveURL(/#settings\/groups$/);
  await expect(page.getByRole("heading", { name: "Envelope groups" })).toBeInViewport();
});

test("Accounts: fold dates, collapse the info pane, sort income first", async ({ page }) => {
  await signInWithHousehold(page);
  await addAccount(page, { name: "Checking", balance: "1000", date: "2030-01-01" });
  await openAccount(page, "Checking");
  await add(page, { payee: "Grocer", amount: "20.00", date: "2030-01-05" });
  await add(page, { payee: "Paycheck", amount: "500.00", date: "2030-01-03", inflow: true });
  await add(page, { payee: "Cafe", amount: "4.00", date: "2030-01-03" });

  // Collapse all dates: each day keeps its heading and net, rows hidden.
  const days = page.locator(".day-toggle");
  await expect(days).toHaveCount(2);
  await choosePageMenu(page, "Collapse all dates");
  await expect(days.nth(0)).toHaveAttribute("aria-expanded", "false");
  await expect(days.nth(1)).toHaveAttribute("aria-expanded", "false");
  await expect(activityRow(page, "Grocer")).toBeHidden();
  // A tapped heading opens just its day.
  await days.nth(1).click();
  await expect(activityRow(page, "Paycheck")).toBeVisible();
  await expect(activityRow(page, "Grocer")).toBeHidden();
  let menu = await openPageMenu(page);
  await menuOption(menu, "Collapse all dates").click();
  await expect(activityRow(page, "Paycheck")).toBeHidden();
  await choosePageMenu(page, "Expand all dates");
  await expect(activityRow(page, "Grocer")).toBeVisible();
  await expect(activityRow(page, "Paycheck")).toBeVisible();

  // Collapse info pane: only Current balance, remembered after a reload.
  const pane = page.getByRole("region", { name: "Checking", exact: true });
  await choosePageMenu(page, "Collapse info pane");
  await expect(pane.locator(".account-figure dt")).toHaveText(["Current balance"]);
  await expect(pane.locator(".account-figure dd")).toHaveText("$1,476.00");
  await expect(page.getByRole("button", { name: "Import CSV" })).toHaveCount(0);
  menu = await openPageMenu(page);
  await expect(menuOption(menu, "Collapse info pane")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(() => localStorage.getItem("bb.accounts.paneCollapsed.memory-user")),
  ).toBe("1");
  await choosePageMenu(page, "Collapse info pane");
  await expect(pane.locator(".account-figure dt")).toContainText(["Money in", "Money out"]);

  // Income/expense: money in first; Descending puts money out first.
  await choosePageMenu(page, "Income/expense");
  await expect(payees(page)).toHaveText(["Paycheck", "Grocer", "Cafe"]);
  await choosePageMenu(page, "Descending");
  await expect(payees(page)).toHaveText(["Grocer", "Cafe", "Paycheck"]);
  // Sorted other than by date: no day headings, so no Collapse all dates.
  menu = await openPageMenu(page);
  await expect(menuOption(menu, "Collapse all dates")).toHaveCount(0);
  await expect(menuOption(menu, "Income/expense")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
});

test("Settings: Sign out is in the menu", async ({ page }) => {
  await signInWithHousehold(page);
  await goTo(page, "Settings");
  const menu = await openPageMenu(page);
  await expect(menu.locator("[role^='menuitem']")).toHaveText(["Sign out"]);
  await menuOption(menu, "Sign out").click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});
