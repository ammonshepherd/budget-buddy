import { expect, test } from "@playwright/test";
import { goTo, signInWithHousehold } from "./helpers";

test("shows sign-in first, with the app version", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Application version")).toHaveText(/^v\d+\.\d+\.\d+$/);
  // Public sign-up is off: no way to create an account here.
  await expect(page.getByText(/create an account|create account/i)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toHaveCount(0);
});

test("bottom navigation switches pages and updates the URL hash", async ({ page }) => {
  await signInWithHousehold(page);
  const nav = page.getByRole("navigation", { name: "Primary navigation" });

  for (const name of ["Accounts", "Activity", "Settings", "Budget"]) {
    await nav.getByRole("link", { name }).click();
    await expect(page).toHaveURL(new RegExp(`#${name.toLowerCase()}$`));
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(nav.getByRole("link", { name })).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveTitle(`${name} | Budget Buddy`);
  }
});

test("signing out returns to the sign-in page", async ({ page }) => {
  await signInWithHousehold(page);
  await goTo(page, "Settings");
  await expect(page.getByText("Signed in as test@example.com")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("assets and manifest are served from the GitHub Pages base path", async ({ page }) => {
  await page.goto("./");
  const logo = page.locator(".brand img");
  await expect(logo).toHaveAttribute("src", "/budget-buddy/icons/icon.svg");
  expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestHref).toBe("/budget-buddy/manifest.webmanifest");
  const manifest = await (await page.request.get(manifestHref!)).json();
  expect(manifest).toMatchObject({ start_url: "/budget-buddy/", scope: "/budget-buddy/" });

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
    "/budget-buddy/icons/favicon.svg",
    "/budget-buddy/icons/favicon-32.png",
    "/budget-buddy/icons/favicon.ico",
    "/budget-buddy/icons/apple-touch-icon.png",
  ]);
  for (const href of [
    ...headIcons,
    ...manifest.icons.map((i: { src: string }) => `/budget-buddy/${i.src}`),
  ]) {
    expect((await page.request.get(href)).status(), href).toBe(200);
  }
});
