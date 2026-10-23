import { expect, test, type Page } from "@playwright/test";
import {
  activityRow,
  addAccount,
  addGroupWithEnvelopes,
  chooseEnvelope,
  choosePageMenu,
  menuOption,
  openPageMenu,
  editCell,
  goTo,
  openAccount,
  openAddTransaction,
  signInWithHousehold,
} from "./helpers";

async function add(
  page: Page,
  tx: { payee: string; amount: string; date: string; envelope?: string; memo?: string },
) {
  const dialog = await openAddTransaction(page);
  await dialog.getByLabel("Amount").first().fill(tx.amount);
  await dialog.getByLabel("Payee").fill(tx.payee);
  await dialog.getByLabel("Date").fill(tx.date);
  if (tx.memo) await dialog.getByLabel("Memo").fill(tx.memo);
  if (tx.envelope) await chooseEnvelope(dialog.getByLabel("Envelope").first(), tx.envelope);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** A $30 split: $10 to Groceries, $20 to Dining. */
async function addSplit(page: Page, payee: string, date: string) {
  const dialog = await openAddTransaction(page);
  await dialog.getByLabel("Amount").first().fill("30");
  await dialog.getByLabel("Payee").fill(payee);
  await dialog.getByLabel("Date").fill(date);
  await chooseEnvelope(dialog.getByLabel("Envelope").first(), "Groceries");
  await chooseEnvelope(dialog.getByLabel("Envelope").first(), "Split across envelopes");
  await dialog.getByLabel("Amount 1").fill("10");
  await chooseEnvelope(dialog.getByLabel("Envelope 2"), "Dining");
  await dialog.getByRole("button", { name: "Put the rest in the last line" }).click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
}

const payees = (page: Page) =>
  page.getByRole("region", { name: "Transactions" }).locator(".activity-payee");

test.beforeEach(async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await signInWithHousehold(page);
  await addAccount(page, { name: "Checking", balance: "1000", date: "2030-01-01" });
  await goTo(page, "Budget");
  await addGroupWithEnvelopes(page, "Food", ["Groceries", "Dining"]);
  await page.evaluate(() => (location.hash = "#budget/2030-01"));
  await editCell(page, "Groceries", "assigned", "200");
  await editCell(page, "Dining", "assigned", "200");
  await add(page, { payee: "Kroger", amount: "45.20", date: "2030-01-03", envelope: "Groceries" });
  await add(page, {
    payee: "Aldi",
    amount: "12",
    date: "2030-01-05",
    envelope: "Groceries",
    memo: "milk",
  });
  await add(page, { payee: "Pizza Place", amount: "25", date: "2030-01-04", envelope: "Dining" });
  await addSplit(page, "Costco", "2030-01-06");
  await add(page, { payee: "Zelle", amount: "60", date: "2030-01-07" });
  await openAccount(page, "Checking");
});

test("choosing an envelope shows only its transactions, a split by its part", async ({ page }) => {
  const search = page.getByRole("combobox", { name: "Search transactions" });
  await search.click();
  await search.fill("gro");
  const list = page.getByRole("listbox", { name: "Matches" });
  await expect(list.getByRole("option")).toHaveText([
    /^Groceries\s+3 transactions$/,
    "Search “gro” in payee and memo",
  ]);
  await list.getByRole("option", { name: /Groceries/ }).click();

  // A chip; To review steps aside; only Groceries rows, the split counting $10.
  await expect(page.getByRole("button", { name: "Remove Groceries filter" })).toBeVisible();
  await expect(search).toHaveValue("");
  await expect(page.getByRole("heading", { name: "To review" })).toHaveCount(0);
  await expect(payees(page)).toHaveText(["Costco", "Aldi", "Kroger"]);
  await expect(page.locator(".tx-search-summary")).toHaveText("3 matches · −$67.20");
  await expect(activityRow(page, "Costco").locator(".activity-portion.match")).toContainText(
    "Groceries",
  );

  // Typing narrows within the envelope (payee or memo).
  await search.fill("milk");
  await expect(payees(page)).toHaveText(["Aldi"]);

  // Backspace in the empty field removes the chip; clear brings To review back.
  await search.fill("");
  await search.press("Backspace");
  await expect(page.getByRole("button", { name: "Remove Groceries filter" })).toHaveCount(0);
  await expect(payees(page)).toHaveCount(5);
  await expect(page.getByRole("heading", { name: "To review" })).toBeVisible();
});

test("typed text finds payees and amounts; Enter keeps it as a search", async ({ page }) => {
  const search = page.getByRole("combobox", { name: "Search transactions" });
  await search.fill("pizza");
  await search.press("Enter");
  await expect(payees(page)).toHaveText(["Pizza Place"]);
  await expect(page.locator(".tx-search-summary")).toHaveText("1 match · −$25.00");

  await search.fill("45.2");
  await expect(payees(page)).toHaveText(["Kroger"]);

  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(search).toHaveValue("");
  await expect(payees(page)).toHaveCount(5);
});

test("kinds: only what is still to review", async ({ page }) => {
  const search = page.getByRole("combobox", { name: "Search transactions" });
  await search.click();
  await page.getByRole("option", { name: /Uncategorized/ }).click();
  await expect(payees(page)).toHaveText(["Zelle"]);
});

test("sorting by amount or name lists rows with their dates", async ({ page }) => {
  // The sort is in the page menu on a phone.
  await expect(page.getByRole("combobox", { name: "Sort by" })).toHaveCount(0);
  await choosePageMenu(page, "Amount");
  await expect(payees(page)).toHaveText(["Zelle", "Kroger", "Costco", "Pizza Place", "Aldi"]);
  await expect(page.getByRole("region", { name: "Transactions" }).getByRole("heading")).toHaveCount(
    0,
  );
  await expect(activityRow(page, "Zelle").locator(".activity-account")).toHaveText(/Jan 7/);

  await choosePageMenu(page, "Ascending");
  await expect(payees(page)).toHaveText(["Aldi", "Pizza Place", "Costco", "Kroger", "Zelle"]);

  await choosePageMenu(page, "Name");
  await expect(payees(page)).toHaveText(["Aldi", "Costco", "Kroger", "Pizza Place", "Zelle"]);
  await choosePageMenu(page, "Descending");
  await expect(payees(page)).toHaveText(["Zelle", "Pizza Place", "Kroger", "Costco", "Aldi"]);

  // Income/expense: money in first, then money out.
  await choosePageMenu(page, "Income/expense");
  await expect(payees(page).first()).toHaveText("Zelle");

  await choosePageMenu(page, "Date");
  await choosePageMenu(page, "Ascending");
  await expect(payees(page)).toHaveText(["Kroger", "Pizza Place", "Aldi", "Costco", "Zelle"]);
  await expect(
    page.getByRole("region", { name: "Transactions" }).getByRole("heading"),
  ).not.toHaveCount(0);

  // Another account starts over.
  await addAccount(page, { name: "Savings", balance: "0", date: "2030-01-01" });
  await openAccount(page, "Checking");
  const menu = await openPageMenu(page);
  await expect(menuOption(menu, "Date")).toHaveAttribute("aria-checked", "true");
  await expect(menuOption(menu, "Descending")).toHaveAttribute("aria-checked", "true");
});

test("chips stack: Uncategorized and Not reconciled", async ({ page }) => {
  await add(page, { payee: "Venmo", amount: "15", date: "2030-01-08" });
  // Zelle is matched with the bank; Venmo is not.
  await activityRow(page, "Zelle").getByRole("checkbox").check();
  await page.getByRole("button", { name: "Mark reconciled" }).click();

  const search = page.getByRole("combobox", { name: "Search transactions" });
  await search.click();
  await page.getByRole("option", { name: /Uncategorized/ }).click();
  await expect(payees(page)).toHaveText(["Venmo", "Zelle"]);

  await search.click();
  const notReconciled = page.getByRole("option", { name: /Not reconciled/ });
  await expect(notReconciled).toContainText("1 transaction");
  await notReconciled.click();
  await expect(page.getByRole("button", { name: /^Remove .* filter$/ })).toHaveText([
    "Uncategorized ✕",
    "Not reconciled ✕",
  ]);
  await expect(payees(page)).toHaveText(["Venmo"]);

  // Picking an envelope replaces Uncategorized and keeps Not reconciled.
  await search.click();
  await page.getByRole("option", { name: /Groceries/ }).click();
  await expect(page.getByRole("button", { name: /^Remove .* filter$/ })).toHaveText([
    "Groceries ✕",
    "Not reconciled ✕",
  ]);
  await expect(payees(page)).toHaveText(["Costco", "Aldi", "Kroger"]);

  // Backspace removes the last chip.
  await search.press("Backspace");
  await expect(page.getByRole("button", { name: /^Remove .* filter$/ })).toHaveText([
    "Groceries ✕",
  ]);
});
