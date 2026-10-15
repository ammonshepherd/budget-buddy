import { expect, test, type Page } from "@playwright/test";
import { envelope, editCell, goTo, openAddTransaction, signInWithHousehold } from "./helpers";

const planStart = (page: Page) => page.getByRole("region", { name: /^No plan for/ });

/** A checking account and January 2030's plan: Rent $1,200 and Food $400. */
async function januaryPlan(page: Page) {
  await signInWithHousehold(page);
  await page.getByRole("link", { name: "adding an account" }).click();
  await page.getByLabel("Account name").fill("Checking");
  await page.getByLabel("Opening balance").fill("3000");
  await page.getByLabel("Opening date").fill("2030-01-01");
  await page.getByRole("button", { name: "Add account" }).click();

  // An empty month offers a CSV upload for that month (no month to choose).
  await page.goto("./#budget/2030-01");
  await expect(planStart(page)).toHaveAccessibleName("No plan for January 2030 yet");
  await expect(planStart(page).getByRole("button", { name: /^Copy/ })).toHaveCount(0);
  await planStart(page).getByRole("button", { name: "Upload a plan CSV" }).click();
  const sheet = page.getByRole("dialog", { name: "Upload a plan for January 2030" });
  await expect(sheet.getByLabel("Month")).toHaveCount(0);
  await sheet.getByLabel("CSV file").setInputFiles({
    name: "plan.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Rent,Bills,1200\nFood,Everyday,400"),
  });
  await expect(sheet.getByRole("status")).toContainText("2 rows ready for January 2030");
  await sheet.getByRole("button", { name: "Import 2 rows" }).click();
  await expect(sheet).toBeHidden();
  await expect(planStart(page)).toHaveCount(0);
  await expect(envelope(page, "Rent")).toContainText("Planned $1,200.00");
}

test("a new month copies last month's Planned", async ({ page }) => {
  await januaryPlan(page);

  await page.goto("./#budget/2030-02");
  await expect(planStart(page)).toBeVisible();
  // Nothing was spent in January, so only Planned can be copied.
  await expect(planStart(page).getByRole("button", { name: /Spent$/ })).toHaveCount(0);
  // Typing a Planned keeps the card (no jump); copying then fills only the rest.
  await page.getByRole("button", { name: /not used this month/ }).click();
  await editCell(page, "Food", "planned", "350");
  await expect(envelope(page, "Food")).toContainText("Planned $350.00");
  await expect(planStart(page)).toBeVisible();
  await planStart(page).getByRole("button", { name: "Copy January 2030’s Planned" }).click();
  await expect(planStart(page)).toHaveCount(0);
  await expect(envelope(page, "Rent")).toContainText("Planned $1,200.00");
  await expect(envelope(page, "Food")).toContainText("Planned $350.00");

  // Clearing every Planned brings the choices back the next time the month opens.
  await editCell(page, "Rent", "planned", "0");
  await editCell(page, "Food", "planned", "0");
  await expect(planStart(page)).toHaveCount(0);
  await page.getByRole("link", { name: "Next month" }).click();
  await page.getByRole("link", { name: "Previous month" }).click();
  await expect(planStart(page)).toHaveAccessibleName("No plan for February 2030 yet");
});

test("a new month copies last month's Spent", async ({ page }) => {
  await januaryPlan(page);
  await editCell(page, "Food", "assigned", "400");

  await goTo(page, "Activity");
  const form = await openAddTransaction(page);
  await form.getByLabel("Date").fill("2030-01-15");
  await form.getByLabel("Amount").fill("123.45");
  await form.getByLabel("Payee").fill("Market");
  await form.getByLabel("Envelope").selectOption({ label: "Food" });
  await form.getByRole("button", { name: "Add transaction" }).click();
  await expect(form).toBeHidden();

  await page.goto("./#budget/2030-02");
  await planStart(page).getByRole("button", { name: "Copy January 2030’s Spent" }).click();
  await expect(planStart(page)).toHaveCount(0);
  await expect(envelope(page, "Food")).toContainText("Planned $123.45");
  // Rent had nothing spent, so its Planned stays $0.00.
  await page.getByRole("button", { name: /not used this month/ }).click();
  await expect(envelope(page, "Rent")).toContainText("Planned $0.00");
});
