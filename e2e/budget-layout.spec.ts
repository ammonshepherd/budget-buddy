import { expect, test } from "@playwright/test";
import {
  addGroupWithEnvelopes,
  available,
  envelope,
  editCell,
  goTo,
  openAddTransaction,
  signInWithHousehold,
  chooseEnvelope,
} from "./helpers";

test("the Budget page is envelopes under a sticky Available to Assign", async ({ page }) => {
  await signInWithHousehold(page);
  await expect(page.getByRole("region", { name: "Budget summary" })).toHaveCount(0);
  await expect(page.getByText("Give every dollar a job")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Add an envelope group in Settings" })).toBeVisible();

  const names = Array.from({ length: 15 }, (_, i) => `Envelope ${i + 1}`);
  await addGroupWithEnvelopes(page, "Everyday", names);
  // Nothing to assign yet: the card is hidden, the month picker is not.
  await expect(available(page)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Next month" })).toBeVisible();
  await goTo(page, "Accounts");
  await page.getByLabel("Account name").fill("Checking");
  await page.getByLabel("Opening balance").fill("50");
  await page.getByRole("button", { name: "Add account" }).click();
  await goTo(page, "Budget");
  await expect(available(page)).toContainText("$50.00");

  // Scroll to the last envelope: the card stays at the top of the screen,
  // while the month picker scrolls away.
  await envelope(page, "Envelope 15").scrollIntoViewIfNeeded();
  const box = await available(page).boundingBox();
  expect(box!.y).toBeLessThan(20);
  await expect(page.getByRole("link", { name: "Next month" })).not.toBeInViewport();
  await expect(available(page)).toBeInViewport();
});

test("the + button adds envelopes, and groups are managed in Settings", async ({ page }) => {
  await signInWithHousehold(page);
  await goTo(page, "Settings");
  const groups = page.getByRole("region", { name: "Envelope groups" });
  for (const name of ["Bills", "Spare"]) {
    await groups.getByLabel("Group name").fill(name);
    await groups.getByRole("button", { name: "Add group" }).click();
  }

  await goTo(page, "Budget");
  const bills = page.getByRole("region", { name: "Bills", exact: true });
  await expect(bills.getByLabel("New envelope")).toHaveCount(0); // hidden until +
  await bills.getByRole("button", { name: "Add envelope to Bills" }).click();
  await bills.getByLabel("New envelope").fill("Rent");
  await bills.getByRole("button", { name: "Add envelope" }).click();
  await expect(envelope(page, "Rent")).toBeVisible();

  // Only an empty group can be deleted, from its sheet.
  page.on("dialog", (dialog) => void dialog.accept()); // confirm()
  await goTo(page, "Settings");
  const list = groups.getByRole("list", { name: "Envelope groups" });
  await expect(list.getByRole("listitem").filter({ hasText: "Bills" })).toContainText("1 envelope");
  await list.getByRole("button", { name: /^Bills/ }).click();
  const sheet = page.getByRole("dialog", { name: "Bills" });
  await expect(sheet.getByRole("button", { name: "Delete group" })).toHaveCount(0);
  await expect(sheet).toContainText("Only an empty group can be deleted.");
  await sheet.getByRole("button", { name: "Close" }).click();
  await list.getByRole("button", { name: /^Spare/ }).click();
  await page
    .getByRole("dialog", { name: "Spare" })
    .getByRole("button", { name: "Delete group" })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(list.getByRole("listitem")).toHaveCount(1);
});

test("the card hides at $0.00 and comes back red when over assigned", async ({ page }) => {
  await signInWithHousehold(page);
  await goTo(page, "Accounts");
  await page.getByLabel("Account name").fill("Checking");
  await page.getByLabel("Opening balance").fill("100");
  await page.getByRole("button", { name: "Add account" }).click();
  await addGroupWithEnvelopes(page, "Everyday", ["Fun"]);
  await expect(available(page)).toContainText("$100.00");

  // Assign it all: nothing left, so the card goes away.
  await editCell(page, "Fun", "assigned", "100");
  await expect(available(page)).toHaveCount(0);

  // Lower the account's balance: now over assigned, and the card warns.
  await goTo(page, "Accounts");
  await page.locator(".item", { hasText: "Checking" }).click();
  await page.getByRole("form", { name: "Edit Checking" }).getByLabel("Opening balance").fill("60");
  await page.getByRole("button", { name: "Save changes" }).click();
  await goTo(page, "Budget");
  await expect(available(page)).toContainText("Over Assigned$40.00");
  await expect(available(page)).toHaveClass(/over/);
});

test("a refund with no spending this month shows as Refunded, not negative Spent", async ({
  page,
}) => {
  await signInWithHousehold(page);
  await goTo(page, "Accounts");
  await page.getByLabel("Account name").fill("Checking");
  await page.getByLabel("Opening balance").fill("1000");
  await page.getByRole("button", { name: "Add account" }).click();
  await addGroupWithEnvelopes(page, "Bills", ["Car insurance"]);
  await editCell(page, "Car insurance", "assigned", "700");

  const dialog = await openAddTransaction(page);
  await dialog.getByRole("radio", { name: "Inflow" }).check();
  await dialog.getByLabel("Amount").fill("85.37");
  await dialog.getByLabel("Payee").fill("Insurance refund");
  await chooseEnvelope(dialog.getByLabel("Envelope"), "Car insurance");
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(dialog).toBeHidden();

  const insurance = envelope(page, "Car insurance");
  await expect(insurance.locator(".envelope-remaining")).toHaveText("$785.37");
  // Saved by the name, then Planned, Assigned and Spent, and Refunded on a line below.
  await expect(insurance.locator(".saved-chip")).toHaveText("Saved $0.00");
  await expect(insurance.locator(".envelope-cells")).toHaveText(
    "Planned $0.00Assigned $700.00Spent $0.00",
  );
  await expect(insurance.locator(".envelope-extra")).toHaveText("Refunded $85.37");
});
