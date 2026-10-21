import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { addAccount, addTransaction, goTo, signInWithHousehold, accountRow } from "./helpers";

test("export everything, then restore it into a new empty household", async ({ page }) => {
  await signInWithHousehold(page);
  await addAccount(page, { name: "Checking", balance: "100", date: "2030-01-01" });
  await addTransaction(page, { amount: "12.34", payee: "Corner Shop" });

  await goTo(page, "Settings");
  const card = page.getByRole("region", { name: "Backup" });
  // This household has data: a file can be checked but not restored.
  await expect(card).toContainText("only be restored into an empty household");

  const downloading = page.waitForEvent("download");
  await card.getByRole("button", { name: "Export all data" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^budget-buddy-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await download.path();
  const file = JSON.parse(await readFile(path, "utf8")) as {
    format: string;
    transactions: { payee: string; amount: number }[];
  };
  expect(file.format).toBe("budget-buddy-backup");
  expect(file.transactions).toEqual([
    expect.objectContaining({ payee: "Corner Shop", amount: -1234 }),
  ]);
  await expect(card.getByRole("status")).toContainText("1 account");

  await card.getByLabel("Backup file").setInputFiles(path);
  await expect(card).toContainText("holds Test Home");
  await expect(card.getByRole("button", { name: "Restore this backup" })).toHaveCount(0);

  // A reload empties the in-memory store: a brand-new household.
  await page.reload();
  await page.getByLabel("Email").fill("new@example.com");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Household name").fill("Fresh");
  await page.getByRole("button", { name: "Create" }).click();
  await goTo(page, "Settings");
  const fresh = page.getByRole("region", { name: "Backup" });
  await expect(fresh).toContainText("This household is empty");
  await fresh.getByLabel("Backup file").setInputFiles(path);
  await fresh.getByRole("button", { name: "Restore this backup" }).click();
  await expect(fresh.getByRole("status")).toContainText("Restored Test Home: 1 account");

  await goTo(page, "Accounts");
  await expect(accountRow(page, "Checking")).toBeVisible();
  // Restored, the household is no longer empty.
  await goTo(page, "Settings");
  await expect(page.getByRole("region", { name: "Backup" })).toContainText(
    "only be restored into an empty household",
  );
});

test("a file that is not a backup is explained", async ({ page }) => {
  await signInWithHousehold(page);
  await goTo(page, "Settings");
  const card = page.getByRole("region", { name: "Backup" });
  await card
    .getByLabel("Backup file")
    .setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from("[1]") });
  await expect(card).toContainText("not a Budget Buddy backup file");
});
