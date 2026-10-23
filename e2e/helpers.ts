import { expect, test, type Locator, type Page } from "@playwright/test";

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
  page.locator("div.envelope").filter({ has: page.locator(".envelope-name", { hasText: name }) });

/** True in the phone-width test project (where Assigned uses the number pad). */
export const onPhone = () => test.info().project.name.startsWith("mobile");

/**
 * Types a new amount into an envelope's Planned or Assigned cell and presses
 * Enter. On a phone Assigned opens the number pad, which takes typed keys too.
 */
export async function editCell(
  page: Page,
  name: string,
  cell: "planned" | "assigned",
  value: string,
) {
  const row = envelope(page, name);
  await row.getByRole("button", { name: new RegExp(`^Edit ${cell} amount`) }).click();
  if (cell === "assigned" && onPhone()) {
    const pad = page.getByRole("dialog", { name: `Assigned for ${name}` });
    await pad.waitFor();
    await page.keyboard.type(value);
    await page.keyboard.press("Enter");
    return;
  }
  const input = row.getByRole("textbox", { name: new RegExp(`^${cell} amount`, "i") });
  await input.fill(value);
  await input.press("Enter");
}

/**
 * Checks the error after editCell(…, "assigned", …): on a phone it shows in
 * the number pad, which stays open until cancelled (closed here); on a
 * desktop it shows in the row.
 */
export async function expectAssignedError(page: Page, name: string, message: string | RegExp) {
  if (!onPhone()) {
    await expect(envelope(page, name).getByRole("alert")).toHaveText(message);
    return;
  }
  const pad = page.getByRole("dialog", { name: `Assigned for ${name}` });
  await expect(pad.getByRole("alert")).toHaveText(message);
  await pad.getByRole("button", { name: "Cancel" }).click();
  await expect(pad).toBeHidden();
}

/** Opens an envelope's sheet (tap the top line of its row). */
export async function openEnvelope(page: Page, name: string) {
  await envelope(page, name).locator(".envelope-top").click();
  const sheet = page.getByRole("dialog", { name: `${name} envelope` });
  await sheet.waitFor();
  return sheet;
}

/**
 * Adds an account on Accounts: + Add account opens the form in a sheet on a
 * phone; on a desktop it is in the panel. A card takes the amount `owed`.
 */
export async function addAccount(
  page: Page,
  account: { name: string; balance?: string; owed?: string; date?: string; tracking?: boolean },
) {
  await goTo(page, "Accounts");
  const form = page.getByRole("form", { name: "Add an account" });
  if (!(await form.isVisible())) {
    await page.getByRole("button", { name: "Add account", exact: true }).click();
  }
  if (account.tracking) await form.getByRole("radio", { name: "Tracking" }).check();
  if (account.owed !== undefined) {
    await form.getByRole("radio", { name: "Credit card" }).check();
    await form.getByLabel("Amount owed on the opening date").fill(account.owed);
  } else if (account.balance !== undefined) {
    await form.getByLabel("Opening balance").fill(account.balance);
  }
  await form.getByLabel("Account name").fill(account.name);
  if (account.date) await form.getByLabel("Opening date", { exact: true }).fill(account.date);
  await form.getByRole("button", { name: "Add account" }).click();
  await expect(accountRow(page, account.name)).toBeVisible();
}

/** An account's row in the Accounts list (opens it). */
export const accountRow = (page: Page, name: string) =>
  page.locator("a.account-row").filter({
    has: page.locator(".account-row-name", { hasText: new RegExp(`^${name}$`) }),
  });

/** Opens an account from the Accounts list. */
export async function openAccount(page: Page, name: string) {
  await goTo(page, "Accounts");
  await accountRow(page, name).click();
  await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
}

/** Opens an account and its edit form (a sheet on a phone, the panel on a desktop). */
export async function editAccount(page: Page, name: string) {
  await openAccount(page, name);
  await page.getByRole("button", { name: `Edit ${name}` }).click();
  const form = page.getByRole("form", { name: `Edit ${name}` });
  await expect(form).toBeVisible();
  return form;
}

/** Opens All accounts (the old Activity page) for the month shown. */
export async function openAllAccounts(page: Page) {
  await goTo(page, "Accounts");
  await page.getByRole("link", { name: /^Open All accounts/ }).click();
  await expect(page.getByRole("region", { name: "Transactions" })).toBeVisible();
}

export async function addTransaction(
  page: Page,
  tx: { amount: string; payee: string; envelope?: string; direction?: "Outflow" | "Inflow" },
) {
  await openAllAccounts(page);
  const form = await openAddTransaction(page);
  await form.getByRole("radio", { name: tx.direction ?? "Outflow" }).check();
  await form.getByLabel("Amount").fill(tx.amount);
  await form.getByLabel("Payee").fill(tx.payee);
  await chooseEnvelope(form.getByLabel("Envelope"), tx.envelope ?? "Uncategorized");
  await form.getByRole("button", { name: "Save", exact: true }).click();
}

/**
 * Picks an envelope (or a fixed choice like "Uncategorized") in an envelope
 * picker by typing its full name and pressing Enter.
 */
export async function chooseEnvelope(field: Locator, name: string) {
  await field.click();
  await field.fill(name);
  await field.press("Enter");
  await expect(field).toHaveValue(name);
}

/** Opens an envelope picker's list and returns its choices (each "Name has $X"). */
export async function pickerChoices(field: Locator) {
  await field.click();
  const list = field.page().getByRole("listbox", { name: "Matches" });
  await expect(list).toBeVisible();
  return list.getByRole("option");
}

/** Clicks the floating + button and returns the dialog it opens. */
export async function openAddTransaction(page: Page) {
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a transaction" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Shows a month ("2030-01") on All accounts, without reloading (the test store lives in memory). */
export async function openActivityMonth(page: Page, month: string) {
  await page.evaluate((m) => (location.hash = `#accounts/all/${m}`), month);
  await expect(page.getByRole("region", { name: "Transactions" })).toBeVisible();
}

/** The transaction row (with any split parts) whose payee is exactly `payee` (ignoring case). */
export const activityRow = (page: Page, payee: string) =>
  page
    .getByRole("region", { name: "Transactions" })
    .locator(".activity-item")
    .filter({ has: page.locator(".activity-payee", { hasText: new RegExp(`^${payee}$`, "i") }) });

/** Taps a transaction row's payee, which opens the edit dialog. */
export const editActivityRow = (page: Page, payee: string) =>
  activityRow(page, payee).locator(".activity-who").click();

/** Clicks a page in the bottom navigation. */
export const goTo = (page: Page, name: "Budget" | "Accounts" | "Settings") =>
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
