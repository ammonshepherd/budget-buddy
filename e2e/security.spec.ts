import { expect, test } from "@playwright/test";
import { watchCsp } from "./cspWatch";
import { accountRow, addAccount, signInWithHousehold } from "./helpers";

test("the built page sets a strict Content Security Policy", async ({ page }) => {
  await page.goto("./");
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  expect(policy).toContain("script-src 'self'");
  expect(policy).toContain("object-src 'none'");
  // The memory-store build talks to nothing but itself.
  expect(policy).toContain("connect-src 'self';");
});

test("Cloudflare gets the same policy as a header, with framing blocked", async ({ page }) => {
  await page.goto("./");
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  // vite preview serves _headers as a plain file; Cloudflare reads it instead.
  const headers = await (await page.request.get("/_headers")).text();
  expect(headers).toContain(`Content-Security-Policy: ${policy}; frame-ancestors 'none'`);
  expect(headers).toContain("X-Content-Type-Options: nosniff");
});

test("the policy blocks nothing the app itself does", async ({ page }) => {
  const violations = await watchCsp(page);
  await signInWithHousehold(page);
  const nav = page.getByRole("navigation", { name: "Primary navigation" });

  // Budget: the transaction dialog.
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  // Accounts: add one and open it (sheets, sticky panes, search).
  await addAccount(page, { name: "Checking", balance: "100" });
  await accountRow(page, "Checking").click();
  await expect(page.getByLabel("Search transactions")).toBeVisible();

  // Settings: drag-and-drop lists set inline styles.
  await nav.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

  expect(await violations()).toEqual([]);
});

test("the policy stops injected code", async ({ page }) => {
  const violations = await watchCsp(page);
  await page.goto("./");
  // An inline script, as an injection would add, never runs.
  await page
    .evaluate(() => {
      const script = document.createElement("script");
      script.textContent = "window.injected = true";
      document.head.append(script);
    })
    .catch(() => undefined);
  expect(await page.evaluate(() => "injected" in window)).toBe(false);
  // Nor can the page send data to another site.
  await page.evaluate(() => fetch("https://example.com/").catch(() => undefined));
  await expect
    .poll(violations)
    .toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^script-src/),
        expect.stringMatching(/^connect-src blocked https:\/\/example\.com/),
      ]),
    );
});
