import { expect, test } from "@playwright/test";
import { missingForTests, readTestEnv } from "../scripts/testEnv";

// Signs in to the real app against the test database as test user A and
// checks the seeded data shows up (data written by scripts/seed-test-db.ts).
const env = readTestEnv();
const skipReason = missingForTests(env);

test.skip(!!skipReason, skipReason ?? "");

test("user A sees Test Household A's budget, accounts and transactions", async ({ page }) => {
  await page.goto("./");
  await page.getByLabel("Email").fill(env.users.a.email);
  await page.getByLabel("Password").fill(env.users.a.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Budget" })).toBeVisible();
  for (const name of ["Rent", "Groceries", "Dining Out", "Test Visa payment"]) {
    await expect(page.locator(".envelope-name", { hasText: name })).toBeVisible();
  }
  // Household B's envelope is never visible to A.
  await expect(page.getByText("B Groceries")).toHaveCount(0);

  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await nav.getByRole("link", { name: "Accounts" }).click();
  await expect(page.getByText("Test Checking")).toBeVisible();
  await expect(page.getByText("Test Visa", { exact: true })).toBeVisible();
  await expect(page.getByText("B Checking")).toHaveCount(0);

  await page.getByRole("link", { name: /^Open All accounts/ }).click();
  const review = page.getByRole("region", { name: "To review" });
  await expect(review.getByText("Mystery Charge")).toBeVisible();
});
