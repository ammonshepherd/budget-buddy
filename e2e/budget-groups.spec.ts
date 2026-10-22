import { expect, test, type Page } from "@playwright/test";
import {
  addGroupWithEnvelopes,
  available,
  editCell,
  envelope,
  goTo,
  signInWithHousehold,
  addAccount,
} from "./helpers";

const group = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const toggle = (page: Page, name: string) =>
  group(page, name).locator(".group-heading h2").getByRole("button");
const stored = (page: Page) =>
  page.evaluate(() => localStorage.getItem("bb.budget.collapsedGroups.memory-user"));

test.beforeEach(async ({ page }) => {
  await signInWithHousehold(page);
  await addAccount(page, { name: "Checking", balance: "1000" });
  await addGroupWithEnvelopes(page, "Everyday", ["Groceries", "Fun"]);
  await addGroupWithEnvelopes(page, "Bills", ["Rent"]);
  await editCell(page, "Groceries", "assigned", "300");
  await editCell(page, "Fun", "assigned", "40.5");
});

test("a group collapses to a count and its total left, and is remembered", async ({ page }) => {
  // Open: no numbers in the bar.
  await expect(toggle(page, "Everyday")).toHaveAttribute("aria-expanded", "true");
  await expect(toggle(page, "Everyday")).toHaveAccessibleName("Everyday");
  await expect(group(page, "Everyday").locator(".group-heading")).not.toContainText("$");
  await expect(group(page, "Everyday").locator(".group-heading")).not.toContainText(/remaining/i);

  await toggle(page, "Everyday").click();
  await expect(toggle(page, "Everyday")).toHaveAttribute("aria-expanded", "false");
  await expect(envelope(page, "Groceries")).toBeHidden();
  await expect(toggle(page, "Everyday")).toHaveAccessibleName("Everyday 2 envelopes");
  await expect(group(page, "Everyday").locator(".group-total")).toHaveText("$340.50 remaining");
  const chevron = toggle(page, "Everyday").locator("svg");
  await expect(chevron).toHaveCSS("transform", /matrix\(0, -1, 1, 0/);
  await expect(chevron).toHaveAttribute("aria-hidden", "true");
  // Other groups and the money are unaffected.
  await expect(envelope(page, "Rent")).toBeVisible();
  await expect(available(page)).toContainText("$659.50");
  await toggle(page, "Bills").click();
  await expect(toggle(page, "Bills")).toHaveAccessibleName("Bills 1 envelope");

  // Kept per user on this device, by group id.
  const ids = JSON.parse((await stored(page))!) as string[];
  expect(ids).toHaveLength(2);
  await expect(toggle(page, "Everyday")).toHaveAttribute("aria-controls", `group-rows-${ids[0]}`);

  // Still collapsed in another month and after visiting another page.
  await page.getByRole("link", { name: "Next month" }).click();
  await expect(toggle(page, "Everyday")).toHaveAttribute("aria-expanded", "false");
  await goTo(page, "Accounts");
  await goTo(page, "Budget");
  await expect(toggle(page, "Everyday")).toHaveAttribute("aria-expanded", "false");
  await expect(envelope(page, "Groceries")).toBeHidden();

  // Renaming the group keeps it collapsed.
  await goTo(page, "Settings");
  await page.getByRole("button", { name: /^Bills/ }).click();
  const sheet = page.getByRole("dialog", { name: "Bills" });
  await sheet.getByRole("button", { name: "Rename Bills" }).click();
  await sheet.getByLabel("Group name").fill("Monthly");
  await sheet.getByLabel("Group name").press("Enter");
  await expect(page.getByRole("dialog", { name: "Monthly" })).toBeVisible();
  await page.keyboard.press("Escape");
  await goTo(page, "Budget");
  await expect(toggle(page, "Monthly")).toHaveAttribute("aria-expanded", "false");

  // Expanding again shows the rows.
  await toggle(page, "Everyday").click();
  await expect(envelope(page, "Groceries")).toBeVisible();
  expect(JSON.parse((await stored(page))!)).toEqual([ids[1]]);
});

test("+ still adds to a collapsed group, which opens", async ({ page }) => {
  await toggle(page, "Bills").click();
  await group(page, "Bills").getByRole("button", { name: "Add envelope to Bills" }).click();
  await expect(toggle(page, "Bills")).toHaveAttribute("aria-expanded", "true");
  await group(page, "Bills").getByLabel("New envelope").fill("Water");
  await group(page, "Bills").getByRole("button", { name: "Add envelope" }).click();
  await expect(envelope(page, "Water")).toBeVisible();
});

test("collapsing or tapping another cell saves the open field first", async ({ page }) => {
  const row = envelope(page, "Groceries");
  await row.getByRole("button", { name: /^Edit planned amount/ }).click();
  await row.getByRole("textbox", { name: "Planned amount for Groceries" }).fill("250");
  // Another cell: the first saves, and Assigned opens the number pad.
  await envelope(page, "Fun")
    .getByRole("button", { name: /^Edit assigned amount/ })
    .click();
  await expect(row.getByRole("button", { name: /^Edit planned amount/ })).toContainText("$250.00");
  const pad = page.getByRole("dialog", { name: "Assigned for Fun" });
  for (const key of ["6", "0", "Assign"]) await pad.getByRole("button", { name: key }).click();
  await expect(pad).toBeHidden();
  await expect(available(page)).toContainText("$640.00");

  // Collapsing its group saves an open field too.
  await envelope(page, "Fun")
    .getByRole("button", { name: /^Edit planned amount/ })
    .click();
  await envelope(page, "Fun").getByRole("textbox", { name: "Planned amount for Fun" }).fill("75");
  await toggle(page, "Everyday").click();
  await expect(group(page, "Everyday").locator(".group-total")).toHaveText("$360.00 remaining");
  await toggle(page, "Everyday").click();
  await expect(
    envelope(page, "Fun").getByRole("button", { name: /^Edit planned amount/ }),
  ).toContainText("$75.00");
});

test("rows show the envelope icon, and Remaining without a caption", async ({ page }) => {
  const icons = page.locator("div.envelope .envelope-icon");
  await expect(icons).toHaveCount(3);
  for (const icon of await icons.all()) await expect(icon).toHaveAttribute("aria-hidden", "true");

  const groceries = envelope(page, "Groceries");
  await expect(groceries.locator(".envelope-left")).toHaveText("$300.00 remaining");
  await expect(groceries.locator(".envelope-left .visually-hidden")).toHaveText(" remaining");
  await expect(envelope(page, "Rent").locator(".envelope-left")).toHaveClass(/zero/);
  await expect(envelope(page, "Rent").locator(".envelope-remaining")).toHaveCSS(
    "color",
    "rgb(154, 144, 166)",
  );
});
