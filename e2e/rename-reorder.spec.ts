import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  addGroupWithEnvelopes,
  envelope,
  goTo,
  openEnvelope,
  signInWithHousehold,
} from "./helpers";

const budgetGroups = (page: Page) => page.locator(".budget-group .group-heading h2");
const budgetEnvelopes = (page: Page, group: string) =>
  page.getByRole("region", { name: group, exact: true }).locator(".envelope-name");
const settingsGroups = (page: Page) =>
  page
    .getByRole("region", { name: "Envelope groups" })
    .getByRole("list", { name: "Envelope groups" });

/** Drags a row by its six-dot handle onto another row, with the mouse. */
async function drag(handle: Locator, target: Locator) {
  const page = handle.page();
  // To the middle of the screen, clear of the bottom navigation.
  await handle.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const from = (await handle.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // A few steps, so the drag library sees the pointer travel.
  await page.mouse.move(from.x + from.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  // The drag library ignores clicks for 50 ms after a drop (so the drop is
  // not also a tap); a person never clicks that fast, but a test would.
  await page.waitForTimeout(100);
}

test("groups are reordered by dragging their handle, with the mouse or the keyboard", async ({
  page,
}) => {
  await signInWithHousehold(page);
  await addGroupWithEnvelopes(page, "Bills", ["Rent"]);
  await addGroupWithEnvelopes(page, "Everyday", ["Food"]);
  await addGroupWithEnvelopes(page, "Fun", ["Games"]);
  await expect(budgetGroups(page)).toHaveText(["Bills", "Everyday", "Fun"]);

  await goTo(page, "Settings");
  const list = settingsGroups(page);
  await expect(list.locator(".item-title")).toHaveText(["Bills", "Everyday", "Fun"]);

  // Mouse: drag Fun to the top.
  await drag(
    list.getByRole("button", { name: "Move Fun" }),
    list.getByRole("listitem").filter({ hasText: "Bills" }),
  );
  await expect(list.locator(".item-title")).toHaveText(["Fun", "Bills", "Everyday"]);

  // Keyboard: Space picks Everyday up, the arrow moves it, Space drops it.
  const handle = list.getByRole("button", { name: "Move Everyday" });
  await handle.focus();
  // Each key waits for the drag library to measure the rows.
  for (const key of ["Space", "ArrowUp", "Space"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(100);
  }
  await expect(list.locator(".item-title")).toHaveText(["Fun", "Everyday", "Bills"]);

  // The Budget page shows the groups in the new order, and it is saved.
  await goTo(page, "Budget");
  await expect(budgetGroups(page)).toHaveText(["Fun", "Everyday", "Bills"]);
});

test("a group's sheet renames it and reorders its envelopes", async ({ page }) => {
  await signInWithHousehold(page);
  await addGroupWithEnvelopes(page, "Everyday", ["Food", "Fuel", "Haircuts"]);

  await goTo(page, "Settings");
  await settingsGroups(page)
    .getByRole("button", { name: /^Everyday/ })
    .click();
  let sheet = page.getByRole("dialog", { name: "Everyday" });
  await expect(sheet).toContainText("Envelope group");

  // Rename: Escape puts the name back, Enter saves.
  await sheet.getByRole("button", { name: "Rename Everyday" }).click();
  await sheet.getByLabel("Group name").fill("Nope");
  await sheet.getByLabel("Group name").press("Escape");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Everyday" })).toBeVisible();
  await sheet.getByRole("button", { name: "Rename Everyday" }).click();
  await sheet.getByLabel("Group name").fill("  ");
  await sheet.getByLabel("Group name").press("Enter");
  await expect(sheet.getByRole("alert")).toHaveText("Group name is required");
  await sheet.getByLabel("Group name").fill("Daily");
  await sheet.getByLabel("Group name").press("Enter");
  sheet = page.getByRole("dialog", { name: "Daily" });
  await expect(sheet.getByRole("heading", { name: "Daily" })).toBeVisible();

  // Its envelopes are listed with handles; drag Haircuts to the top.
  const envelopes = sheet.getByRole("list", { name: "Envelopes in Daily" });
  await expect(envelopes.getByRole("listitem")).toHaveText(["Food", "Fuel", "Haircuts"]);
  await drag(
    envelopes.getByRole("button", { name: "Move Haircuts" }),
    envelopes.getByRole("listitem").filter({ hasText: "Food" }),
  );
  await expect(envelopes.getByRole("listitem")).toHaveText(["Haircuts", "Food", "Fuel"]);
  // A group with envelopes cannot be deleted.
  await expect(sheet.getByRole("button", { name: "Delete group" })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(settingsGroups(page)).toContainText("Daily3 envelopes");

  await goTo(page, "Budget");
  await expect(budgetEnvelopes(page, "Daily")).toHaveText(["Haircuts", "Food", "Fuel"]);
});

test("an envelope is renamed in its sheet; a card's payment envelope is not", async ({ page }) => {
  await signInWithHousehold(page);
  await addGroupWithEnvelopes(page, "Everyday", ["Food"]);

  const sheet = await openEnvelope(page, "Food");
  await sheet.getByRole("button", { name: "Rename Food" }).click();
  const field = sheet.getByLabel("Envelope name");
  await expect(field).toBeFocused();
  await field.fill("Groceries");
  // Leaving the field saves, like Planned and Assigned.
  await sheet.locator(".sheet-hero").click();
  const renamed = page.getByRole("dialog", { name: "Groceries envelope" });
  await expect(renamed.getByRole("heading", { name: "Groceries" })).toBeVisible();
  await renamed.getByRole("button", { name: "Close" }).click();
  await expect(envelope(page, "Groceries")).toBeVisible();
  await expect(page.locator(".envelope-name", { hasText: "Food" })).toHaveCount(0);

  // A card's payment envelope is named after its card.
  await goTo(page, "Accounts");
  const add = page.getByRole("form", { name: "Add an account" });
  await add.getByRole("radio", { name: "Credit card" }).check();
  await add.getByLabel("Account name").fill("Visa");
  await add.getByLabel("Amount owed on the opening date").fill("0");
  await add.getByRole("button", { name: "Add account" }).click();
  await goTo(page, "Budget");
  const card = await openEnvelope(page, "Visa payment");
  await expect(card.getByRole("heading", { name: "Visa payment" })).toBeVisible();
  await expect(card.getByRole("button", { name: /^Rename/ })).toHaveCount(0);
});
