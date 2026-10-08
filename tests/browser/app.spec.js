import { test, expect } from "playwright/test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");
async function audit(page) {
  await page.addScriptTag({ path: axePath });
  const result = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } })).violations);
  expect(result.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
test.beforeEach(async ({ page }) => { await page.goto("/"); await page.getByRole("button", { name: "Try the demo" }).click(); });
test("all pages are accessible, compact, and keep the header version", async ({ page }) => {
  const errors=[]; page.on("pageerror", (e)=>errors.push(e.message));
  for (const name of ["Budget","Accounts","Activity","Settings"]) {
    await page.getByRole("navigation").getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("heading", {name,exact:true})).toBeVisible(); await audit(page);
    await expect(page.locator("#app-version")).toHaveText("v0.1.0");
  }
  expect(errors).toEqual([]); await page.screenshot({path:`test-results/${test.info().project.name}-settings.png`,fullPage:true});
});
test("split purchase displays once; strict funding requires reallocation",async({page})=>{
  await page.getByRole("navigation").getByRole("link",{name:"Activity"}).click();
  await page.getByRole("button",{name:"Add transaction",exact:true}).click(); const d=page.getByRole("dialog");
  await d.getByLabel("Payee / description").fill("Grocery store"); await d.getByLabel("Amount",{exact:true}).fill("400.00");
  await d.getByRole("combobox", { name: "Category", exact: true }).selectOption({label:"Groceries"}); await d.getByLabel("Split amount").fill("400.00");
  await audit(page); await d.getByRole("button",{name:"Save transaction"}).click();
  await expect(d.locator(".dialog-error")).toContainText("Insufficient Available"); await d.getByRole("button",{name:"Reallocate funds"}).click();
  const move=page.getByRole("dialog",{name:"Reallocate Available"}); await move.getByRole("combobox", { name: "From", exact: true }).selectOption({label:"Bills: $800.00 Available"}); await move.getByRole("combobox", { name: "To", exact: true }).selectOption({label:"Groceries"}); await move.getByLabel("Amount",{exact:true}).fill("200.00"); await move.getByRole("button",{name:"Move money"}).click();
  await expect(move).toHaveCount(0); await d.getByRole("button",{name:"Save transaction"}).click(); await expect(d).toHaveCount(0);
  await expect(page.locator(".transaction-card")).toHaveCount(1); await expect(page.locator(".transaction-card .amount")).toHaveText("-$400.00");
  await page.getByRole("button",{name:"Add transaction",exact:true}).click(); const split=page.getByRole("dialog");
  await split.getByLabel("Payee / description").fill("Split shop"); await split.getByLabel("Amount",{exact:true}).fill("50.00"); await split.getByRole("combobox", { name: "Category", exact: true }).selectOption({label:"Groceries"}); await split.getByLabel("Split amount").fill("20.00"); await split.getByRole("button",{name:"Add split"}).click(); await split.getByRole("combobox", { name: "Category", exact: true }).nth(1).selectOption({label:"Bills"}); await split.getByLabel("Split amount").nth(1).fill("30.00"); await split.getByRole("button",{name:"Save transaction"}).click();
  await expect(page.locator(".transaction-card")).toHaveCount(2); await page.getByLabel("Search category").fill("Bills"); await expect(page.locator(".transaction-card")).toHaveCount(1); await page.reload(); await expect(page.getByLabel("Search category")).toHaveValue("Bills");
});
test("accounts create/edit, categories regroup, CSV previews and unfunded resolution",async({page})=>{
  await page.getByRole("navigation").getByRole("link",{name:"Accounts"}).click(); await page.getByRole("button",{name:"Add account",exact:true}).click();
  let d=page.getByRole("dialog"); await d.getByLabel("Account name").fill("Visa"); await d.getByRole("combobox", { name: "Type", exact: true }).selectOption("credit"); await d.getByRole("button",{name:"Save account"}).click(); await expect(page.getByRole("link",{name:/Visa/})).toBeVisible();
  await page.getByRole("navigation").getByRole("link",{name:"Budget"}).click(); await expect(page.getByRole("button",{name:"Visa payment",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Groceries",exact:true}).click(); d=page.getByRole("dialog"); await d.getByRole("combobox", { name: "Group", exact: true }).selectOption({label:"Card payments"}); await audit(page); await d.getByRole("button",{name:"Save category"}).click();
  await page.getByRole("navigation").getByRole("link",{name:"Settings"}).click(); await page.getByRole("button",{name:"Upload CSV"}).click(); d=page.getByRole("dialog");
  const now=new Date().toISOString().slice(0,10); await d.getByLabel("CSV file").setInputFiles({name:"bank.csv",mimeType:"text/csv",buffer:Buffer.from(`Date,Description,Amount,ID\n${now},Imported shop,-10.00,bank1`)}); await d.getByRole("button",{name:"Read CSV"}).click();
  d=page.getByRole("dialog",{name:"Map CSV columns"}); await d.getByRole("button",{name:"Preview import"}).click(); d=page.getByRole("dialog",{name:"Review CSV import"}); await audit(page); await d.getByRole("button",{name:"Import selected rows"}).click();
  await page.getByRole("navigation").getByRole("link",{name:"Activity"}).click(); await expect(page.getByText("Needs funding",{exact:true})).toBeVisible(); await page.getByRole("button",{name:/Fund \/ edit Imported shop/}).click(); d=page.getByRole("dialog"); await d.getByRole("combobox", { name: "Category", exact: true }).selectOption({label:"Groceries"}); await d.getByLabel("Split amount").fill("10.00"); await d.getByRole("button",{name:"Save transaction"}).click(); await expect(page.getByText("Needs funding",{exact:true})).toHaveCount(0);
});
test("service worker caches only shell assets and survives an offline shell reload",async({page,context})=>{
  await page.evaluate(async()=>{await navigator.serviceWorker.ready; await new Promise(resolve=>{if(navigator.serviceWorker.controller)resolve();else navigator.serviceWorker.addEventListener("controllerchange",resolve,{once:true});});});
  await page.evaluate(async()=>{const response=await fetch("./rest/v1/private-test");if(response.status!==404)throw new Error("API test should receive its real 404 response.");});
  const keys=await page.evaluate(async()=>{const result=[];for(const name of await caches.keys())for(const req of await(await caches.open(name)).keys())result.push(req.url);return result;});
  expect(keys.some((url)=>url.includes("/auth/")||url.includes("/rest/"))).toBe(false);
  await context.setOffline(true); await page.reload(); await expect(page.getByRole("heading",{name:"Budget",exact:true})).toBeVisible();
  expect(await page.evaluate(async()=>{try{await fetch("./rest/v1/private-test");return false;}catch{return true;}})).toBe(true);
  await context.setOffline(false);
});
test("Saved requires an explicit move, month persists, and dialogs support keyboard focus",async({page})=>{
  const before=await page.locator("#assignable").textContent(); const date=new Date();date.setUTCMonth(date.getUTCMonth()+1,1); const next=date.toISOString().slice(0,7);
  await page.getByLabel("Month",{exact:true}).fill(next); await page.getByLabel("Month",{exact:true}).dispatchEvent("change");
  await expect(page.getByLabel("Month",{exact:true})).toHaveValue(next);const row=page.locator(".category-card").filter({has:page.getByRole("button",{name:"Groceries",exact:true})});
  await expect(row.locator(".remaining")).toHaveText("$0.00");await expect(row.locator(".saved")).toHaveText("$300.00");
  const opener=row.getByRole("button",{name:"Move Saved to Assigned"});await opener.click();const d=page.getByRole("dialog",{name:"Move Saved to Assigned"});await audit(page);
  await page.keyboard.press("Tab");expect(await page.evaluate(()=>document.activeElement.closest("dialog")!==null)).toBe(true);await page.keyboard.press("Escape");await expect(d).toHaveCount(0);await expect(opener).toBeFocused();
  await opener.click();await d.getByLabel("Amount",{exact:true}).fill("50.00");await d.getByRole("button",{name:"Move money"}).click();
  await expect(row.locator(".remaining")).toHaveText("$50.00");await expect(row.locator(".saved")).toHaveText("$250.00");await expect(page.locator("#assignable")).toHaveText(before);await page.reload();await expect(page.getByLabel("Month",{exact:true})).toHaveValue(next);
});
