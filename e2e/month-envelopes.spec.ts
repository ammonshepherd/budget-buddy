import { expect, test } from "@playwright/test";
import { addAccount, envelope, editCell, goTo, signInWithHousehold } from "./helpers";

test("each month shows only the envelopes it uses", async ({ page }) => {
  await signInWithHousehold(page);
  await page.getByRole("link", { name: "adding an account" }).click();
  await addAccount(page, { name: "Checking", balance: "1000", date: "2030-01-01" });

  // January's plan has Rent and Trip; February's has only Rent.
  await goTo(page, "Settings");
  const card = page.getByRole("region", { name: "Import envelope plan" });
  for (const [month, text] of [
    ["2030-01", "Rent,Bills,1200\nTrip,Fun,300"],
    ["2030-02", "Rent,Bills,1200"],
  ] as const) {
    await card.getByLabel("Month").fill(month);
    await card
      .getByLabel("CSV file")
      .setInputFiles({ name: "plan.csv", mimeType: "text/csv", buffer: Buffer.from(text) });
    await card.getByRole("button", { name: /^Import/ }).click();
    await expect(card.getByRole("status")).toContainText("Imported");
  }

  await page.goto("./#budget/2030-01");
  await expect(envelope(page, "Rent")).toBeVisible();
  await expect(envelope(page, "Trip")).toBeVisible();

  await page.goto("./#budget/2030-02");
  await expect(envelope(page, "Rent")).toBeVisible();
  await expect(envelope(page, "Trip")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Fun" })).toHaveCount(0);

  // A hidden envelope can still be shown and used; assigning keeps it in the month.
  await page.getByRole("button", { name: "Show 1 envelope not used this month" }).click();
  await expect(envelope(page, "Trip")).toContainText("not used this month");
  await editCell(page, "Trip", "assigned", "50");
  await expect(envelope(page, "Trip").locator(".envelope-remaining")).toHaveText("$50.00");
  await expect(envelope(page, "Trip")).not.toContainText("not used this month");
  await expect(page.getByRole("button", { name: /envelopes? not used this month/ })).toHaveCount(0);

  // Money is never hidden: Trip's unspent $50 is Saved in March, with no plan there.
  await page.goto("./#budget/2030-03");
  await expect(envelope(page, "Trip")).toContainText("Saved $50.00");
  await expect(envelope(page, "Rent")).toHaveCount(0);
});
