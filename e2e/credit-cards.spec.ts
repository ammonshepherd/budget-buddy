import { expect, test } from "@playwright/test";
import {
  addGroupWithEnvelopes,
  available,
  envelope,
  envelopeAction,
  goTo,
  openAddTransaction,
  signInWithHousehold,
} from "./helpers";

test("a credit card account owes money and gets a payment envelope", async ({ page }) => {
  await signInWithHousehold(page);
  await goTo(page, "Accounts");
  await page.getByLabel("Account name").fill("Checking");
  await page.getByLabel("Opening balance").fill("1000");
  await page.getByRole("button", { name: "Add account" }).click();

  // Choosing Credit card asks for the amount owed instead of a balance.
  const add = page.getByRole("form", { name: "Add an account" });
  await add.getByRole("radio", { name: "Credit card" }).check();
  await add.getByLabel("Account name").fill("Visa");
  await add.getByLabel("Amount owed on the opening date").fill("200");
  await add.getByRole("button", { name: "Add account" }).click();
  const visa = page.locator(".item", { hasText: "Visa" });
  await expect(visa).toContainText("-$200.00");
  await expect(visa).toContainText(/Credit card · opened \d{4}-\d\d-\d\d owing \$200\.00/);
  // The add form goes back to Checking for the next account.
  await expect(add.getByRole("radio", { name: "Checking" })).toBeChecked();

  // What the card owes does not lower Available to Assign; it shows as Uncovered.
  await goTo(page, "Budget");
  await expect(available(page)).toContainText("$1,000.00");
  const payment = envelope(page, "Visa payment");
  await expect(page.getByRole("region", { name: "Credit card payments" })).toContainText(
    "Visa payment",
  );
  await expect(payment).toContainText("Available to pay $0.00");
  await expect(payment).toContainText("Remaining debt $200.00");
  await expect(payment).not.toContainText("Assigned");

  // A purchase on the card, entered from the Budget page.
  const dialog = await openAddTransaction(page);
  await dialog.getByLabel("Account").selectOption({ label: "Visa" });
  await dialog.getByLabel("Amount").fill("30");
  await dialog.getByLabel("Payee").fill("Gas");
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(dialog).toBeHidden();
  // Uncategorized card spending waits for review: only what is owed changes.
  await expect(available(page)).toContainText("$1,000.00");
  await expect(payment.locator(".envelope-remaining")).toHaveText("$0.00");
  await expect(payment).toContainText("Remaining debt $230.00");

  // Editing keeps the type and shows the amount owed.
  await goTo(page, "Accounts");
  await expect(visa).toContainText("-$230.00");
  await visa.click();
  const edit = page.getByRole("form", { name: "Edit Visa" });
  await expect(edit.getByRole("radiogroup", { name: "Account type" })).toHaveCount(0);
  await expect(edit.getByLabel("Amount owed on the opening date")).toHaveValue("200.00");
  await edit.getByLabel("Amount owed on the opening date").fill("250");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(visa).toContainText("-$280.00");
  await expect(visa).toContainText("owing $250.00");

  // Renaming the card renames its payment envelope.
  await visa.click();
  await page.getByRole("form", { name: "Edit Visa" }).getByLabel("Account name").fill("Visa Gold");
  await page.getByRole("button", { name: "Save changes" }).click();
  await goTo(page, "Budget");
  await expect(envelope(page, "Visa Gold payment")).toContainText("Remaining debt $280.00");
});

test("pay a card from checking, covering what the payment envelope lacks", async ({ page }) => {
  await signInWithHousehold(page);
  await goTo(page, "Accounts");
  await page.getByLabel("Account name").fill("Checking");
  await page.getByLabel("Opening balance").fill("1000");
  await page.getByRole("button", { name: "Add account" }).click();

  await addGroupWithEnvelopes(page, "Everyday", ["Groceries"]);
  await envelopeAction(page, "Groceries", "Assign (negative to take back)", "100");

  await goTo(page, "Accounts");
  const add = page.getByRole("form", { name: "Add an account" });
  await add.getByRole("radio", { name: "Credit card" }).check();
  await add.getByLabel("Account name").fill("Visa");
  await add.getByLabel("Amount owed on the opening date").fill("200");
  await add.getByRole("button", { name: "Add account" }).click();
  await expect(page.locator(".item", { hasText: "Visa" })).toContainText("-$200.00");

  // A $40 grocery purchase on the card moves $40 into Visa payment.
  await goTo(page, "Budget");
  let dialog = await openAddTransaction(page);
  // The payment envelope fills itself, so it is not an envelope choice.
  await expect(
    dialog.getByLabel("Envelope").locator("option", { hasText: "Visa payment" }),
  ).toHaveCount(0);
  await dialog.getByLabel("Account").selectOption({ label: "Visa" });
  await dialog.getByLabel("Amount").fill("40");
  await dialog.getByLabel("Payee").fill("Market");
  await dialog.getByLabel("Envelope").selectOption({ label: "Groceries" });
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(dialog).toBeHidden();
  const payment = envelope(page, "Visa payment");
  await expect(payment.locator(".envelope-remaining")).toHaveText("$40.00");
  await expect(envelope(page, "Groceries").locator(".envelope-remaining")).toHaveText("$60.00");
  await expect(available(page)).toContainText("$900.00");

  // Pay $140 from checking: one entry, a Transfer to the Visa.
  dialog = await openAddTransaction(page);
  await dialog.getByLabel("Amount").fill("140");
  await dialog.getByLabel("Payee").fill("Visa payment");
  await dialog.getByLabel("Envelope").selectOption({ label: "Transfer (not spending or income)" });
  await expect(dialog.getByLabel("To account")).toHaveValue(/.+/);
  await expect(dialog.getByRole("note")).toHaveText("Also adds the matching inflow in Visa.");
  await dialog.getByRole("button", { name: "Add transaction" }).click();

  // Visa payment holds only $40, so the other $100 must be covered.
  const cover = dialog.getByRole("alertdialog");
  await expect(cover).toContainText("Visa payment would be $100.00 short");
  await cover.getByLabel(/cover .* from/i).selectOption("available");
  await cover.getByRole("button", { name: "Cover and save" }).click();
  await expect(dialog).toBeHidden();

  await expect(available(page)).toContainText("$800.00");
  await expect(payment.locator(".envelope-remaining")).toHaveText("$0.00");
  await expect(payment).toContainText("Available to pay $0.00");
  await expect(payment).toContainText("Remaining debt $100.00");
  await goTo(page, "Accounts");
  await expect(page.locator(".item", { hasText: "Visa" })).toContainText("-$100.00");
  await expect(page.locator(".item", { hasText: "Checking" })).toContainText("$860.00");
});

test("a payment nothing can cover is not suggested as Uncategorized", async ({ page }) => {
  await signInWithHousehold(page);
  await goTo(page, "Accounts");
  await page.getByLabel("Account name").fill("Checking");
  await page.getByRole("button", { name: "Add account" }).click();
  const add = page.getByRole("form", { name: "Add an account" });
  await add.getByRole("radio", { name: "Credit card" }).check();
  await add.getByLabel("Account name").fill("Visa");
  await add.getByLabel("Amount owed on the opening date").fill("300");
  await add.getByRole("button", { name: "Add account" }).click();

  // Checking holds $0, so nothing can cover an extra $300 payment.
  const dialog = await openAddTransaction(page);
  await dialog.getByLabel("Amount").fill("300");
  await dialog.getByLabel("Envelope").selectOption({ label: "Transfer (not spending or income)" });
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  const cover = dialog.getByRole("alertdialog");
  await expect(cover).toContainText(
    "There isn’t enough money to cover this payment yet. Assign more to Visa payment or add income first",
  );
  await expect(cover).not.toContainText("Uncategorized");
  await expect(cover.getByRole("button", { name: "Cover and save" })).toBeDisabled();
});
