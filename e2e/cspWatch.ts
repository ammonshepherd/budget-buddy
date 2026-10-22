import type { Page } from "@playwright/test";

/**
 * Records everything the page's Content Security Policy blocks, from the
 * first page load on. Call before page.goto; read with the returned function.
 */
export async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { cspViolations: string[] }).cspViolations = seen;
    document.addEventListener("securitypolicyviolation", (e) =>
      seen.push(`${e.violatedDirective} blocked ${e.blockedURI || "inline"}`),
    );
  });
  return () =>
    page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations);
}
