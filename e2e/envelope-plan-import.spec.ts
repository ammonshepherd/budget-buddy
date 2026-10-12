import { expect, test } from "@playwright/test";
import { envelope, goTo, signInWithHousehold } from "./helpers";

const csv = (text: string) => ({
  name: "plan.csv",
  mimeType: "text/csv",
  buffer: Buffer.from(text),
});

test("import an envelope plan CSV for a month from Settings", async ({ page }) => {
  await signInWithHousehold(page);
  await goTo(page, "Settings");
  const card = page.getByRole("region", { name: "Import envelope plan" });

  await card.getByLabel("Month").fill("2030-01");
  await card
    .getByLabel("CSV file")
    .setInputFiles(
      csv(
        [
          "category,group,planned amount",
          "Rent,Bills,1200",
          '"Food, groceries",Everyday,$450.50',
          "Broken,Everyday,abc",
        ].join("\n"),
      ),
    );

  await expect(card.getByRole("status")).toContainText(
    "2 rows ready for January 2030: 2 new groups, 2 new envelopes. 1 invalid row will be skipped.",
  );
  await expect(card.getByRole("list", { name: "Invalid rows" })).toContainText(
    'Line 4Planned amount "abc" is not an amount like 12.34',
  );
  await card.getByRole("button", { name: "Import 2 rows" }).click();
  await expect(card.getByRole("status")).toContainText("Imported 2 envelopes for January 2030");

  // The plan is on that month's budget.
  await card.getByRole("link", { name: "Open that budget" }).click();
  await expect(page).toHaveURL(/#budget\/2030-01$/);
  await expect(envelope(page, "Rent")).toContainText("Plan $1,200.00");
  await expect(envelope(page, "Food, groceries")).toContainText("Plan $450.50");

  // Importing again updates Planned for existing envelopes instead of duplicating them.
  await goTo(page, "Settings");
  await card.getByLabel("Month").fill("2030-01");
  await card.getByLabel("CSV file").setInputFiles(csv("rent,BILLS,1300"));
  await expect(card.getByRole("status")).toContainText("0 new groups, 0 new envelopes");
  await expect(card.getByRole("list", { name: "Rows to import" })).toContainText(
    "Planned was $1,200.00",
  );
  await card.getByRole("button", { name: "Import 1 row" }).click();
  await expect(card.getByRole("status")).toContainText("Imported 1 envelope");

  await page.goto("./#budget/2030-01");
  await expect(page.locator("details.envelope")).toHaveCount(2);
  await expect(envelope(page, "Rent")).toContainText("Plan $1,300.00");
});

test("an unusable file shows why", async ({ page }) => {
  await signInWithHousehold(page);
  await goTo(page, "Settings");
  const card = page.getByRole("region", { name: "Import envelope plan" });
  await card.getByLabel("CSV file").setInputFiles(csv("category,group\nRent,Bills"));
  await expect(card.getByRole("alert")).toHaveText(
    "The header row needs three columns: category, group and planned amount.",
  );
  await expect(card.getByRole("button", { name: /Import/ })).toHaveCount(0);
});
