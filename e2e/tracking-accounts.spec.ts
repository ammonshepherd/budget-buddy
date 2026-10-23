import { expect, test, type Page } from "@playwright/test";
import {
  accountRow,
  activityRow,
  addAccount,
  available,
  chooseEnvelope,
  goTo,
  menuOption,
  openAccount,
  openAddTransaction,
  openAllAccounts,
  openPageMenu,
  signInWithHousehold,
} from "./helpers";

/** Adds a transaction with the + button inside the open account. */
async function add(
  page: Page,
  tx: { payee: string; amount: string; notes?: string; inflow?: boolean },
) {
  const dialog = await openAddTransaction(page);
  if (tx.inflow) await dialog.getByRole("radio", { name: "Inflow" }).check();
  await dialog.getByLabel("Amount").fill(tx.amount);
  await dialog.getByLabel("Payee").fill(tx.payee);
  if (tx.notes) await dialog.getByLabel("Notes").fill(tx.notes);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** The info pane's figure with this label. */
const figure = (page: Page, label: string) =>
  page.locator(".account-figure").filter({ has: page.locator("dt", { hasText: label }) });

test("a tracking account stands alone: own balance, no envelopes, no transfers", async ({
  page,
}) => {
  await signInWithHousehold(page);
  await addAccount(page, { name: "Checking", balance: "1000" });
  await addAccount(page, { name: "Savings", balance: "0" });
  await addAccount(page, { name: "Brokerage", balance: "5000", tracking: true });

  // It sits in its own group, and Available to Assign leaves it out.
  await expect(page.locator(".account-group-heading h2")).toHaveText(["Checking", "Tracking"]);
  await expect(accountRow(page, "Brokerage")).toContainText("$5,000.00");
  await goTo(page, "Budget");
  await expect(available(page)).toContainText("$1,000.00");

  // Its form has no envelope, and Memo is called Notes.
  await openAccount(page, "Brokerage");
  const dialog = await openAddTransaction(page);
  await expect(dialog.getByLabel("Envelope")).toHaveCount(0);
  await expect(dialog.locator(".fixed-account")).toHaveText("Account Brokerage");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await add(page, { payee: "Dividend", amount: "25", notes: "Q3 payout", inflow: true });
  await add(page, { payee: "Fee", amount: "10" });

  // Nothing to review; rows show their notes instead of an envelope.
  await expect(page.getByRole("region", { name: "To review" })).toHaveCount(0);
  await expect(activityRow(page, "Dividend")).toContainText("Q3 payout");
  await expect(page.locator(".badge-uncategorized")).toHaveCount(0);
  await expect(figure(page, "Current balance")).toContainText("$5,015.00");

  // Reconciling works as in any account.
  await activityRow(page, "Dividend").getByRole("checkbox").check();
  await page.getByRole("button", { name: "Mark reconciled" }).click();
  await expect(
    activityRow(page, "Dividend").getByRole("img", { name: "Reconciled" }),
  ).toBeVisible();
  await expect(figure(page, "Reconciled")).toContainText("$5,025.00");

  // Search offers only Not reconciled, and no Envelope sort.
  await page.getByRole("combobox", { name: "Search transactions" }).click();
  await expect(page.getByRole("listbox", { name: "Matches" }).getByRole("option")).toHaveText([
    /Not reconciled/,
  ]);
  await page.keyboard.press("Escape");
  const menu = await openPageMenu(page);
  await expect(menuOption(menu, "Envelope")).toHaveCount(0);
  await expect(menuOption(menu, "Name")).toBeVisible();
  await page.keyboard.press("Escape");

  // Editing keeps it a tracking transaction.
  await activityRow(page, "Fee").locator(".activity-who").click();
  const edit = page.getByRole("dialog", { name: "Edit transaction" });
  await expect(edit.getByLabel("Envelope")).toHaveCount(0);
  await edit.getByRole("button", { name: "Cancel" }).click();

  // Budget and All accounts never see it.
  await goTo(page, "Budget");
  await expect(available(page)).toContainText("$1,000.00");
  await openAllAccounts(page);
  await expect(activityRow(page, "Dividend")).toHaveCount(0);

  // From a budget account it is neither an account choice nor a transfer target.
  const form = await openAddTransaction(page);
  await expect(form.locator(".field-account select option")).toHaveText(["Checking", "Savings"]);
  await chooseEnvelope(form.getByLabel("Envelope"), "Transfer (not spending or income)");
  await expect(form.getByLabel("To account").locator("option")).toHaveText(["Savings"]);
});
