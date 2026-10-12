import { expect, type Page } from "@playwright/test";

/** Signs in (the in-memory store accepts any password) and creates a household. */
export async function signInWithHousehold(page: Page) {
  await page.goto("./");
  await page.getByLabel("Email").fill("test@example.com");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Household name").fill("Test Home");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Budget" })).toBeVisible();
}

export const available = (page: Page) => page.getByRole("region", { name: "Available to Assign" });

export const envelope = (page: Page, name: string) =>
  page
    .locator("details.envelope")
    .filter({ has: page.locator(".envelope-name", { hasText: name }) });

/** Opens an envelope row and submits one of its forms. */
export async function envelopeAction(page: Page, name: string, field: string, value: string) {
  const row = envelope(page, name);
  if (!(await row.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await row.locator("summary").click();
  }
  const form = row.locator("form").filter({ has: page.getByLabel(field) });
  await form.getByLabel(field).fill(value);
  await form.getByRole("button").click();
}

export async function addTransaction(
  page: Page,
  tx: { amount: string; payee: string; envelope?: string; direction?: "Outflow" | "Inflow" },
) {
  await goTo(page, "Activity");
  await page.getByRole("radio", { name: tx.direction ?? "Outflow" }).check();
  await page.getByLabel("Amount").fill(tx.amount);
  await page.getByLabel("Payee").fill(tx.payee);
  await page.getByLabel("Envelope").selectOption({ label: tx.envelope ?? "Uncategorized" });
  await page.getByRole("button", { name: "Add transaction" }).click();
}

/** Clicks a page in the bottom navigation. */
export const goTo = (page: Page, name: "Budget" | "Accounts" | "Activity" | "Settings") =>
  page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name }).click();
