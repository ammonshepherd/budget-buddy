import { expect, test, type Page } from "@playwright/test";
import {
  addGroupWithEnvelopes,
  available,
  envelope,
  editCell,
  goTo,
  openAddTransaction,
  signInWithHousehold,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await signInWithHousehold(page);
});

async function addAccount(page: Page, name: string, opening: string, card = false) {
  await goTo(page, "Accounts");
  const add = page.getByRole("form", { name: "Add an account" });
  if (card) await add.getByRole("radio", { name: "Credit card" }).check();
  await add.getByLabel("Account name").fill(name);
  await add.getByLabel(card ? "Amount owed on the opening date" : "Opening balance").fill(opening);
  await add.getByRole("button", { name: "Add account" }).click();
}

const remaining = (page: Page, name: string) => envelope(page, name).locator(".envelope-remaining");

test("split a transaction across envelopes, edit it, and undo the split", async ({ page }) => {
  await addAccount(page, "Checking", "1000");
  await goTo(page, "Budget");
  await addGroupWithEnvelopes(page, "Everyday", ["Groceries", "Household"]);
  await editCell(page, "Groceries", "assigned", "200");
  await editCell(page, "Household", "assigned", "100");

  const dialog = await openAddTransaction(page);
  await dialog.getByLabel("Amount").first().fill("75");
  await dialog.getByLabel("Payee").fill("Superstore");
  await dialog.getByLabel("Envelope").first().selectOption({ label: "Groceries" });
  await dialog.getByLabel("Envelope").first().selectOption({ label: "Split across envelopes" });
  // The envelope already chosen starts the first line.
  await expect(dialog.getByLabel("Envelope 1")).toHaveValue(/.+/);
  await dialog.getByLabel("Amount 1").fill("50");
  await expect(dialog.getByRole("status")).toHaveText("$25.00 left to split");
  // Saving before the lines add up explains what is missing.
  await dialog.getByLabel("Envelope 2").selectOption({ label: "Household" });
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(dialog.getByRole("alert")).toContainText("$25.00 is not in an envelope yet");
  await dialog.getByRole("button", { name: "Put the rest in the last line" }).click();
  await expect(dialog.getByLabel("Amount 2")).toHaveValue("25.00");
  await expect(dialog.getByRole("status")).toHaveText("Adds up");
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(dialog).toBeHidden();

  // Each envelope pays its line; Available to Assign does not change.
  await expect(remaining(page, "Groceries")).toHaveText("$150.00");
  await expect(remaining(page, "Household")).toHaveText("$75.00");
  await expect(available(page)).toContainText("$700.00");

  // Activity shows the split; editing loads every line.
  await goTo(page, "Activity");
  const row = page.locator(".item", { hasText: "Superstore" });
  await expect(row).toContainText("Split: Groceries, Household");
  await row.click();
  const form = page.getByRole("form", { name: "Edit transaction" });
  await expect(form.getByLabel("Envelope").first()).toHaveValue("split");
  await expect(form.getByLabel("Amount 1")).toHaveValue("50.00");
  await expect(form.getByLabel("Amount 2")).toHaveValue("25.00");
  // A third line, then removed again (a split keeps at least two lines).
  await form.getByRole("button", { name: "+ Add line" }).click();
  await expect(form.getByLabel("Envelope 3")).toBeVisible();
  await form.getByRole("button", { name: "Remove line 3" }).click();
  await expect(form.getByRole("button", { name: "Remove line 2" })).toBeDisabled();
  await form.getByLabel("Amount 1").fill("60");
  await expect(form.getByRole("status")).toHaveText("$10.00 too much");
  await form.getByLabel("Amount 2").fill("15");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(form).toHaveCount(0);

  // Choosing one envelope again undoes the split.
  await row.click();
  await form.getByLabel("Envelope").first().selectOption({ label: "Household" });
  await expect(form.getByLabel("Envelope 1")).toHaveCount(0);
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(row).toContainText("Household");
  await expect(row).not.toContainText("Split");
  await goTo(page, "Budget");
  await expect(remaining(page, "Groceries")).toHaveText("$200.00");
  await expect(remaining(page, "Household")).toHaveText("$25.00");
});

test("a split that overdraws two envelopes covers them one at a time", async ({ page }) => {
  await addAccount(page, "Checking", "1000");
  await goTo(page, "Budget");
  await addGroupWithEnvelopes(page, "Everyday", ["Groceries", "Fun", "Gifts"]);
  await editCell(page, "Groceries", "assigned", "100");
  await editCell(page, "Fun", "assigned", "100");
  await editCell(page, "Gifts", "assigned", "200");
  await expect(available(page)).toContainText("$600.00");

  const dialog = await openAddTransaction(page);
  await dialog.getByLabel("Amount").first().fill("260");
  await dialog.getByLabel("Payee").fill("Party");
  await dialog.getByLabel("Envelope").first().selectOption({ label: "Split across envelopes" });
  await dialog.getByLabel("Envelope 1").selectOption({ label: "Groceries" });
  await dialog.getByLabel("Amount 1").fill("130");
  await dialog.getByLabel("Envelope 2").selectOption({ label: "Fun" });
  await dialog.getByLabel("Amount 2").fill("130");
  await dialog.getByRole("button", { name: "Add transaction" }).click();

  const cover = dialog.getByRole("alertdialog");
  await expect(cover).toContainText("Envelope 1 of 2 to cover");
  await expect(cover).toContainText("Groceries would be $30.00 short");
  // Fun is spent by this same split, so it has nothing to give.
  await expect(cover.getByRole("option", { name: /Fun/ })).toHaveCount(0);
  await expect(cover.getByLabel(/cover .* from/i)).toHaveValue(/.+/);
  await expect(cover.getByRole("option", { name: "Gifts (has $200.00)" })).toBeAttached();
  await cover.getByRole("button", { name: "Cover and continue" }).click();

  await expect(cover).toContainText("Envelope 2 of 2 to cover");
  await expect(cover).toContainText("Fun would be $30.00 short");
  // Gifts already gave $30 to Groceries.
  await expect(cover.getByRole("option", { name: "Gifts (has $170.00)" })).toBeAttached();
  await cover.getByLabel(/cover .* from/i).selectOption("available");
  await cover.getByRole("button", { name: "Cover and save" }).click();
  await expect(dialog).toBeHidden();

  await expect(remaining(page, "Groceries")).toHaveText("$0.00");
  await expect(remaining(page, "Fun")).toHaveText("$0.00");
  await expect(remaining(page, "Gifts")).toHaveText("$170.00");
  await expect(available(page)).toContainText("$570.00");
});

test("a card purchase can be split; money into a card cannot", async ({ page }) => {
  await addAccount(page, "Checking", "1000");
  await addAccount(page, "Visa", "0", true);
  await goTo(page, "Budget");
  await addGroupWithEnvelopes(page, "Everyday", ["Groceries", "Fun"]);
  await editCell(page, "Groceries", "assigned", "100");
  await editCell(page, "Fun", "assigned", "100");

  const dialog = await openAddTransaction(page);
  await dialog.getByLabel("Account").selectOption({ label: "Visa" });
  await dialog.getByLabel("Amount").first().fill("70");
  await dialog.getByLabel("Payee").fill("Card shop");
  await dialog.getByLabel("Envelope").first().selectOption({ label: "Split across envelopes" });
  await dialog.getByLabel("Envelope 1").selectOption({ label: "Groceries" });
  await dialog.getByLabel("Amount 1").fill("50");
  await dialog.getByLabel("Envelope 2").selectOption({ label: "Fun" });
  await dialog.getByLabel("Amount 2").fill("20");
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(dialog).toBeHidden();

  // The whole purchase moves into the card's payment envelope.
  await expect(remaining(page, "Groceries")).toHaveText("$50.00");
  await expect(remaining(page, "Fun")).toHaveText("$80.00");
  await expect(envelope(page, "Visa payment")).toContainText("Available to pay $70.00");

  // An inflow on the card is a card credit: no envelopes, so no split.
  const credit = await openAddTransaction(page);
  await credit.getByLabel("Account").selectOption({ label: "Visa" });
  await credit.getByRole("radio", { name: "Inflow" }).check();
  await expect(credit.getByRole("option", { name: "Split across envelopes" })).toHaveCount(0);
});
