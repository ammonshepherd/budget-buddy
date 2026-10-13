import { expect, test, type Page } from "@playwright/test";
import { available, goTo, signInWithHousehold } from "./helpers";

const file = (name: string, text: string) => ({
  name,
  mimeType: "text/csv",
  buffer: Buffer.from(text),
});

// Made-up rows in the bank's layout: a paycheck, a refund and a purchase.
const CHECKING = [
  "Date,Description,Amount",
  "01/02/2030,Deposit ACH ACME PAYROLL,1500.00",
  "01/03/2030,Refund HARDWARE STORE,20.00",
  "01/04/2030,Withdrawal GROCERY,-100.00",
].join("\n");

async function setUp(page: Page) {
  await signInWithHousehold(page);
  await goTo(page, "Accounts");
  await page.getByLabel("Account name").fill("Checking");
  await page.getByLabel("Opening balance").fill("100");
  await page.getByLabel("Opening date").fill("2030-01-01");
  await page.getByRole("button", { name: "Add account" }).click();
  await goTo(page, "Settings");
}

const rules = (page: Page) => page.getByRole("region", { name: "Income rules" });

async function addRule(page: Page, text: string, account = "Any account") {
  const form = rules(page).getByRole("form", { name: "Add an income rule" });
  await form.getByLabel("Description contains").fill(text);
  await form.getByLabel("In account").selectOption({ label: account });
  await form.getByRole("button", { name: "Add rule" }).click();
  const rule = rules(page)
    .getByRole("list", { name: "Income rules" })
    .getByRole("listitem")
    .filter({ hasText: `Contains “${text}”` });
  await expect(rule).toContainText(account);
}

async function importChecking(page: Page) {
  const card = page.getByRole("region", { name: "Import transactions" });
  await card.getByLabel("Bank CSV file").setInputFiles(file("checking.csv", CHECKING));
  return card;
}

test("a rule marks payroll deposits as Income when importing", async ({ page }) => {
  await setUp(page);
  await addRule(page, "payroll", "Checking");

  const card = await importChecking(page);
  await expect(card.getByRole("status")).toContainText(
    "1 inflow will be marked Income by your rules.",
  );
  await card.getByRole("button", { name: "Import 3 transactions" }).click();

  // The paycheck is in Available to Assign; the refund still waits for review.
  await page.goto("./#budget/2030-01");
  await expect(available(page)).toContainText("$1,600.00"); // 100 + 1,500 (the rest waits)
  await expect(available(page)).toContainText("Income this month $1,500.00");
  await expect(
    page.getByText(
      "2 transactions to review ($20.00 in, $100.00 out) are not in Available to Assign yet.",
    ),
  ).toBeVisible();
});

test("a rule added later marks the inflows already waiting", async ({ page }) => {
  await setUp(page);
  const card = await importChecking(page);
  await card.getByRole("button", { name: "Import 3 transactions" }).click();
  await expect(card.getByRole("status")).toContainText("Imported 3 transactions");

  // A rule too short to be useful is refused.
  await rules(page).getByLabel("Description contains").fill("a");
  await rules(page).getByRole("button", { name: "Add rule" }).click();
  await expect(rules(page).getByRole("alert")).toHaveText(
    "Enter at least 2 characters of the deposit's description.",
  );

  await addRule(page, "ACME PAYROLL");
  const status = rules(page).getByRole("status");
  await expect(status).toContainText("1 inflow waiting for review matches your rules.");
  await status.getByRole("button", { name: "Mark it as Income" }).click();
  await expect(status).toHaveCount(0);

  await page.goto("./#budget/2030-01");
  await expect(available(page)).toContainText("$1,600.00");

  // Deleting the rule leaves what it marked alone.
  await goTo(page, "Settings");
  await rules(page).getByRole("button", { name: "Delete" }).click();
  await expect(rules(page).getByRole("list", { name: "Income rules" })).toHaveCount(0);
  await page.goto("./#budget/2030-01");
  await expect(available(page)).toContainText("$1,600.00");
});

test("Activity applies the rules to the review list", async ({ page }) => {
  await setUp(page);
  const card = await importChecking(page);
  await card.getByRole("button", { name: "Import 3 transactions" }).click();
  await expect(card.getByRole("status")).toContainText("Imported 3 transactions");
  await addRule(page, "refund");

  await goTo(page, "Activity");
  const review = page.getByRole("region", { name: "To review" });
  await expect(review.getByRole("listitem")).toHaveCount(3); // payroll, refund, grocery
  await review.getByRole("button", { name: "Apply income rules (1 match)" }).click();
  await expect(review.getByRole("listitem")).toHaveCount(2);
  await expect(review).toContainText("ACME PAYROLL");
});
