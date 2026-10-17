import { expect, test, type Page } from "@playwright/test";
import { goTo, signInWithHousehold } from "./helpers";

// Accounts and Settings in the desktop layout (this project runs at 1280×800).

const panel = (page: Page) => page.locator("aside.side-panel");

test("Accounts adds in the panel, and edits and closes the chosen account there", async ({
  page,
}) => {
  await signInWithHousehold(page);
  await goTo(page, "Accounts");
  await expect(panel(page)).toHaveAccessibleName("Add an account");
  await expect(
    page.getByText("No accounts yet. Add your checking account on the right."),
  ).toBeVisible();

  for (const [name, balance] of [
    ["Checking", "250"],
    ["Old Savings", "0"],
  ]) {
    await panel(page).getByLabel("Account name").fill(name);
    await panel(page).getByLabel("Opening balance").fill(balance);
    await panel(page).getByRole("button", { name: "Add account" }).click();
  }
  const list = page.locator(".accounts-work .list-card").first();
  await expect(list).toContainText("Checking");
  await expect(list).toContainText("$250.00");

  // The chosen account edits in the panel, not in a sheet.
  await list.getByRole("button", { name: /^Checking/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(panel(page)).toHaveAccessibleName("Edit Checking");
  await panel(page).getByLabel("Account name").fill("Everyday Checking");
  await panel(page).getByRole("button", { name: "Save changes" }).click();
  await expect(panel(page)).toHaveAccessibleName("Add an account");
  await expect(list).toContainText("Everyday Checking");

  // Close account from the panel; it moves to Closed accounts.
  await list.getByRole("button", { name: /^Old Savings/ }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await panel(page).getByRole("button", { name: "Close account" }).click();
  await expect(page.getByRole("heading", { name: "Closed accounts" })).toBeVisible();
  await expect(panel(page)).toHaveAccessibleName("Add an account");
});

test("Settings shows its sections in two columns", async ({ page }) => {
  await signInWithHousehold(page);
  await goTo(page, "Settings");
  const groups = page.getByRole("region", { name: "Envelope groups" });
  const rules = page.getByRole("region", { name: "Income rules" });
  const plan = page.getByRole("region", { name: "Import envelope plan" });
  const imports = page.getByRole("region", { name: "Import transactions" });
  const [g, r, p, i] = await Promise.all(
    [groups, rules, plan, imports].map(async (l) => (await l.boundingBox())!),
  );
  // Income rules and the plan import sit side by side; the bank import spans both.
  expect(Math.abs(r.y - p.y)).toBeLessThan(4);
  expect(p.x).toBeGreaterThan(r.x + r.width - 1);
  expect(i.width).toBeGreaterThan(g.width * 1.8);
});
