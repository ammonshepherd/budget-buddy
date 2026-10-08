import { test, expect } from "playwright/test";
import { demoState } from "../../models/budget.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
test.use({ serviceWorkers: "block" });
test("real adapter signs in, creates household, saves, refreshes session, edits profile and signs out",async({page})=>{
  let state=null,refreshes=0; const requests=[];
  const user={id:"00000000-0000-4000-8000-000000000001",email:"person@example.test",user_metadata:{display_name:"Household user"}};
  const token=()=>({access_token:"verified-test-token",refresh_token:"refresh-test-token",expires_in:3600,user});
  await page.route("**/config.js",route=>route.fulfill({contentType:"text/javascript",body:'export const config={supabaseUrl:"https://supabase.example.test",supabaseKey:"sb_publishable_test"};'}));
  await page.route("https://supabase.example.test/**",async route=>{
    const req=route.request(),url=new URL(req.url()),body=req.postDataJSON(); requests.push({path:url.pathname,body,headers:req.headers()});
    const reply=(data,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(data)});
    if(url.pathname.endsWith("/token")){
      if(url.searchParams.get("grant_type")==="refresh_token")refreshes++;
      else { expect(body).toEqual({email:user.email,password:"unique-test-password"}); }
      return reply(token());
    }
    if(url.pathname.endsWith("/user")) {if(req.method()==="PUT") {user.user_metadata=body.data||user.user_metadata; user.email=body.email||user.email;}return reply(user);}
    if(url.pathname.endsWith("/logout")) return reply({});
    if(url.pathname.endsWith("/get_budget_state"))return reply(state);
    if(url.pathname.endsWith("/create_household")){state=demoState();state.household.name=body.p_name;return reply(state);}
    if(url.pathname.endsWith("/save_budget_state")){
      expect(req.headers().authorization).toBe("Bearer verified-test-token");expect(body.p_expected_revision).toBe(state.household.revision);state=body.p_state;state.household.revision++;return reply(state);
    }
    throw new Error(`Unexpected API call ${url.pathname}`);
  });
  await page.goto("/"); await page.getByLabel("Email",{exact:true}).fill(user.email); await page.getByLabel("Password",{exact:true}).fill("unique-test-password"); await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Set up your household"})).toBeVisible(); await page.getByLabel("Household name").fill("Shared budget"); await page.getByRole("button",{name:"Create household"}).click();
  await expect(page.getByRole("heading",{name:"Budget",exact:true})).toBeVisible(); await expect(page.locator("#demo-label")).toBeHidden();
  const grocery=page.getByRole("form",{name:"Groceries monthly amounts"}); await grocery.getByLabel("Planned",{exact:true}).fill("400.00"); await grocery.getByRole("button",{name:"Save",exact:true}).click();
  await expect(page.locator("#app-status")).toContainText("Groceries updated"); expect(state.months.find(r=>r.category_id===state.categories[0].id).planned).toBe(40000);
  const storage=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage))); expect(JSON.stringify(storage)).not.toContain("unique-test-password");expect(storage["budget-buddy-demo-v1"]).toBeUndefined();
  await page.evaluate(()=>{const key="budget-buddy-session-v1",data=JSON.parse(localStorage.getItem(key));data.expires_at=0;localStorage.setItem(key,JSON.stringify(data));});await page.reload(); await expect(page.getByRole("heading",{name:"Budget",exact:true})).toBeVisible(); expect(refreshes).toBe(1);
  await page.getByRole("navigation").getByRole("link",{name:"Settings"}).click();await page.getByRole("button",{name:"Edit profile"}).click();const d=page.getByRole("dialog"); await d.getByLabel("Name",{exact:true}).fill("Updated name"); await d.getByRole("button",{name:"Save profile"}).click();await expect(page.locator("#user-name")).toHaveText("Updated name");
  await page.addScriptTag({path:require.resolve("axe-core/axe.min.js")}); expect(await page.evaluate(async()=>(await axe.run()).violations.map(v=>v.id))).toEqual([]);
  await page.getByRole("button",{name:"Sign out",exact:true}).click(); await expect(page.getByRole("button",{name:"Sign in",exact:true})).toBeVisible();await expect(page.getByText("Shared budget",{exact:true})).toHaveCount(0);expect(await page.evaluate(()=>localStorage.getItem("budget-buddy-session-v1"))).toBeNull();
});
