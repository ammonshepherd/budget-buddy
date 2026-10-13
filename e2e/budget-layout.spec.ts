import { expect, test } from "@playwright/test";
import { addGroupWithEnvelopes, available, envelope, goTo, signInWithHousehold } from "./helpers";

test("the Budget page is envelopes under an always-visible Available to Assign", async ({
  page,
}) => {
  await signInWithHousehold(page);
  await expect(page.getByRole("region", { name: "Budget summary" })).toHaveCount(0);
  await expect(page.getByText("Give every dollar a job")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Add an envelope group in Settings" })).toBeVisible();

  const names = Array.from({ length: 15 }, (_, i) => `Envelope ${i + 1}`);
  await addGroupWithEnvelopes(page, "Everyday", names);
  await expect(available(page)).toContainText("$0.00"); // still shown with nothing to assign

  // Scroll to the last envelope: the bar stays at the top of the screen.
  await envelope(page, "Envelope 15").scrollIntoViewIfNeeded();
  const box = await available(page).boundingBox();
  expect(box!.y).toBeLessThan(5);
  await expect(available(page)).toBeInViewport();
});

test("the + button adds envelopes, and groups are managed in Settings", async ({ page }) => {
  await signInWithHousehold(page);
  await goTo(page, "Settings");
  const groups = page.getByRole("region", { name: "Envelope groups" });
  for (const name of ["Bills", "Spare"]) {
    await groups.getByLabel("Group name").fill(name);
    await groups.getByRole("button", { name: "Add group" }).click();
  }

  await goTo(page, "Budget");
  const bills = page.getByRole("region", { name: "Bills", exact: true });
  await expect(bills.getByLabel("New envelope")).toHaveCount(0); // hidden until +
  await bills.getByRole("button", { name: "Add envelope to Bills" }).click();
  await bills.getByLabel("New envelope").fill("Rent");
  await bills.getByRole("button", { name: "Add envelope" }).click();
  await expect(envelope(page, "Rent")).toBeVisible();

  // Only an empty group can be deleted.
  await goTo(page, "Settings");
  const list = groups.getByRole("list", { name: "Envelope groups" });
  await expect(list.getByRole("listitem").filter({ hasText: "Bills" })).toContainText("1 envelope");
  await expect(
    list.getByRole("listitem").filter({ hasText: "Bills" }).getByRole("button", { name: "Delete" }),
  ).toHaveCount(0);
  await list
    .getByRole("listitem")
    .filter({ hasText: "Spare" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(list.getByRole("listitem")).toHaveCount(1);
});
