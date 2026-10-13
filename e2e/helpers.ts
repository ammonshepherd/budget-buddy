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
  const form = await openAddTransaction(page);
  await form.getByRole("radio", { name: tx.direction ?? "Outflow" }).check();
  await form.getByLabel("Amount").fill(tx.amount);
  await form.getByLabel("Payee").fill(tx.payee);
  await form.getByLabel("Envelope").selectOption({ label: tx.envelope ?? "Uncategorized" });
  await form.getByRole("button", { name: "Add transaction" }).click();
}

/** Clicks the floating + button and returns the dialog it opens. */
export async function openAddTransaction(page: Page) {
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a transaction" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Clicks a page in the bottom navigation. */
export const goTo = (page: Page, name: "Budget" | "Accounts" | "Activity" | "Settings") =>
  page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name }).click();

/** Adds a group in Settings, then its envelopes with the group's + button on Budget. */
export async function addGroupWithEnvelopes(page: Page, group: string, envelopes: string[]) {
  await goTo(page, "Settings");
  const groups = page.getByRole("region", { name: "Envelope groups" });
  await groups.getByLabel("Group name").fill(group);
  await groups.getByRole("button", { name: "Add group" }).click();
  await expect(groups.getByRole("list", { name: "Envelope groups" })).toContainText(group);
  await goTo(page, "Budget");
  const card = page.getByRole("region", { name: group, exact: true });
  await card.getByRole("button", { name: `Add envelope to ${group}` }).click();
  for (const name of envelopes) {
    await card.getByLabel("New envelope").fill(name);
    await card.getByRole("button", { name: "Add envelope" }).click();
    await expect(envelope(page, name)).toBeVisible();
  }
  await card.getByRole("button", { name: `Stop adding to ${group}` }).click();
}
