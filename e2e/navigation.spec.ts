import { expect, test } from "@playwright/test";
import { choosePageMenu, goTo, signInWithHousehold, openAllAccounts } from "./helpers";

test("shows sign-in first, with no version or menu in the header", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  // The version is on Settings; signed out there is no page menu either.
  await expect(page.getByLabel("Application version")).toHaveCount(0);
  await expect(page.locator(".app-header").getByRole("button", { name: / menu$/ })).toHaveCount(0);
  // Public sign-up is off: no way to create an account here.
  await expect(page.getByText(/create an account|create account/i)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toHaveCount(0);
});

test("bottom navigation switches pages and updates the URL hash", async ({ page }) => {
  await signInWithHousehold(page);
  const nav = page.getByRole("navigation", { name: "Primary navigation" });

  await expect(nav.getByRole("link")).toHaveText(["Budget", "Accounts", "Settings"]);
  // The tabs share the bar's width equally, centred.
  const bar = (await nav.boundingBox())!;
  const tabs = await Promise.all((await nav.getByRole("link").all()).map((l) => l.boundingBox()));
  const [left, middle, right] = tabs.map((t) => t!.x + t!.width / 2 - bar.x) as [
    number,
    number,
    number,
  ];
  expect(Math.abs(middle - bar.width / 2)).toBeLessThan(2);
  expect(Math.abs(middle - left - (right - middle))).toBeLessThan(2);
  for (const name of ["Accounts", "Settings", "Budget"]) {
    await nav.getByRole("link", { name }).click();
    // Budget and Accounts carry the month, so it stays the same between them.
    await expect(page).toHaveURL(new RegExp(`#${name.toLowerCase()}(/\\d{4}-\\d{2})?$`));
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(nav.getByRole("link", { name })).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveTitle(`${name} | Enough Money`);
  }
});

test("Budget and Accounts keep the chosen month in the URL and between them", async ({ page }) => {
  await signInWithHousehold(page);
  await page.evaluate(() => (location.hash = "#budget/2030-01"));
  await expect(page.locator(".budget-month")).toContainText("January 2030");
  await openAllAccounts(page);
  await expect(page).toHaveURL(/#accounts\/all\/2030-01$/);
  await expect(page.locator(".budget-month")).toContainText("January 2030");
  await page.getByRole("link", { name: "Next month" }).click();
  await expect(page).toHaveURL(/#accounts\/all\/2030-02$/);
  await expect(page.locator(".budget-month")).toContainText("February 2030");
  await goTo(page, "Settings");
  await goTo(page, "Budget");
  await expect(page).toHaveURL(/#budget\/2030-02$/);
  await expect(page.locator(".budget-month")).toContainText("February 2030");
});

test("the old Activity link opens All accounts, and Back closes what is open", async ({ page }) => {
  await signInWithHousehold(page);
  await page.evaluate(() => (location.hash = "#activity/2030-01"));
  await expect(page).toHaveURL(/#accounts\/all\/2030-01$/);
  await expect(page.getByRole("heading", { level: 2, name: "All accounts" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav.getByRole("link", { name: "Accounts" })).toHaveAttribute("aria-current", "page");

  // The back arrow returns to the list; so does the browser's Back button.
  await page.getByRole("link", { name: "Back to accounts" }).click();
  await expect(page).toHaveURL(/#accounts\/2030-01$/);
  await page.getByRole("link", { name: /^Open All accounts/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: "All accounts" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#accounts\/2030-01$/);
  await expect(page.getByRole("link", { name: /^Open All accounts/ })).toBeVisible();
});

test("signing out returns to the sign-in page", async ({ page }) => {
  await signInWithHousehold(page);
  await goTo(page, "Settings");
  await expect(page.getByText("Signed in as test@example.com")).toBeVisible();
  await expect(page.getByText(/^Version \d+\.\d+\.\d+$/)).toBeVisible();
  // Sign out is in the page menu, not on the page.
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  await choosePageMenu(page, "Sign out");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("assets and manifest are served from the site root", async ({ page }) => {
  await page.goto("./");
  const logo = page.locator(".brand img");
  await expect(logo).toHaveAttribute("src", "/icons/icon.svg");
  expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestHref).toBe("/manifest.webmanifest");
  const manifest = await (await page.request.get(manifestHref!)).json();
  expect(manifest).toMatchObject({ start_url: "/", scope: "/" });

  // Every app icon, in the manifest and in <head>, loads from the base path.
  expect(manifest.icons.map((icon: { src: string }) => icon.src)).toEqual([
    "icons/icon-192.png",
    "icons/icon-512.png",
    "icons/icon-maskable-512.png",
    "icons/icon.svg",
  ]);
  expect(manifest.icons.find((i: { purpose: string }) => i.purpose === "maskable")).toBeTruthy();
  const headIcons = await page
    .locator('link[rel="icon"], link[rel="apple-touch-icon"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")!));
  expect(headIcons).toEqual([
    "/icons/favicon.svg",
    "/icons/favicon-32.png",
    "/icons/favicon.ico",
    "/icons/apple-touch-icon.png",
  ]);
  for (const href of [...headIcons, ...manifest.icons.map((i: { src: string }) => `/${i.src}`)]) {
    expect((await page.request.get(href)).status(), href).toBe(200);
  }
});
