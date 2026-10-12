import { expect, test } from "@playwright/test";

test("opens on the Budget page with the app version", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Budget" })).toBeVisible();
  await expect(page.getByText("Available to Assign", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Application version")).toHaveText(/^v\d+\.\d+\.\d+$/);
});

test("bottom navigation switches pages and updates the URL hash", async ({ page }) => {
  await page.goto("./");
  const nav = page.getByRole("navigation", { name: "Primary navigation" });

  for (const name of ["Accounts", "Activity", "Settings", "Budget"]) {
    await nav.getByRole("link", { name }).click();
    await expect(page).toHaveURL(new RegExp(`#${name.toLowerCase()}$`));
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(nav.getByRole("link", { name })).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveTitle(`${name} | Budget Buddy`);
  }
});

test("a deep link opens the right page", async ({ page }) => {
  await page.goto("./#activity");
  await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
});

test("assets and manifest are served from the GitHub Pages base path", async ({ page }) => {
  await page.goto("./");
  const logo = page.locator(".brand img");
  await expect(logo).toHaveAttribute("src", "/budget-buddy/icons/logo-icon.svg");
  expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestHref).toBe("/budget-buddy/manifest.webmanifest");
  const manifest = await (await page.request.get(manifestHref!)).json();
  expect(manifest).toMatchObject({ start_url: "/budget-buddy/", scope: "/budget-buddy/" });
});
