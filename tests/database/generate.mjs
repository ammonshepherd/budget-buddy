// Compare the independent SQL calculations against the JS model using real
// normalized writes. This is not a SQL mock; CI executes it against PostgreSQL.
import { demoState, id, monthNow, today, categoryFigures, summary, monthRow, clone, validateState } from "../../models/budget.js";
import { moveMoney, saveAccount, saveTransaction, saveTransfer } from "../../models/actions.js";
const user = id(), state = demoState();
state.household.start_month = "2026-01"; state.months = []; state.accounts[0].opening_date = "2026-01-01";
const sql = [`reset role; insert into auth.users values('${user}','golden@example.test');`, "set role authenticated;",
  `select set_config('request.jwt.claim.sub','${user}',false);`, "select public.create_household('Golden checks','2026-01','USD');"];
let revision = 0;
function checkpoint(label) {
  validateState(state);
  const json = JSON.stringify(state).replace(/'/g, "''");
  const expected = state.categories.map(c => ({ id: c.id, ...categoryFigures(state,c.id,monthNow()) }));
  const totals = summary(state);
  sql.push(`do $check$ declare s jsonb; h uuid; f record; begin
    s:=public.get_budget_state(); h:=(s->'household'->>'id')::uuid;
    s:='${json}'::jsonb||jsonb_build_object('household',s->'household');
    perform public.save_budget_state(${revision++},s);
    end; $check$; reset role;`);
  for (const e of expected) sql.push(`do $check$ declare h uuid; f record; begin
    select household_id into h from public.household_members where user_id='${user}';
    select * into f from public.budget_figures(h) where category_id='${e.id}' and month='${monthNow()}';
    if f.assigned<>${e.assigned} or f.planned<>${e.planned} or f.spent<>${e.spent} or f.remaining<>${e.remaining} or f.saved<>${e.saved} then raise exception '${label}: SQL/JS category mismatch'; end if;
    end; $check$;`);
  sql.push(`do $check$ declare h uuid; begin select household_id into h from public.household_members where user_id='${user}';
    if public.budget_cash(h)<>${totals.cash} or public.budget_reserved(h)<>${totals.reserved} then raise exception '${label}: SQL/JS cash mismatch'; end if;
    end; $check$; set role authenticated;`);
}
monthRow(state,state.categories[0].id,"2026-01").assigned=5000;
checkpoint("untouched Saved accumulates");
moveMoney(state,{from:state.categories[0].id,to:state.categories[0].id,amount:3000,month:monthNow(),saved:true});
monthRow(state,state.categories[1].id,monthNow()).assigned=1000;
checkpoint("explicit Saved move");
const card={id:id(),name:"Golden card",type:"credit",on_budget:true,opening_balance:0,opening_date:"2026-01-01",archived:false}; saveAccount(state,card);
const txn={id:id(),account_id:card.id,date:today(),posted_date:null,amount:-1000,payee:"Card shop",kind:"expense",status:"active",source:"manual",tags:[],note:"",check_number:"",external_id:null,import_data:{},original_description:"",transfer_id:null,merged_into_id:null,allocations:[{category_id:state.categories[0].id,amount:-1000}]};
saveTransaction(state,txn); checkpoint("card reserve");
saveTransfer(state,{from:state.accounts[0].id,to:card.id,amount:1000}); checkpoint("card payment");
saveTransaction(state,{...txn,id:id(),account_id:state.accounts[0].id,amount:-500,payee:"Split cash",allocations:[{category_id:state.categories[0].id,amount:-300},{category_id:state.categories[1].id,amount:-200}]}); checkpoint("split cash purchase");
saveTransaction(state,{...txn,id:id(),amount:100,payee:"Card credit after payment",kind:"adjustment",allocations:[]}); checkpoint("unreserved card credit invents no cash");
state.transactions.push({...txn,id:id(),account_id:state.accounts[0].id,source:"csv",funding:"needs_funding",amount:-2000,allocations:[]}); checkpoint("pending import");
sql.push("reset role;", "\\echo 'SQL and JavaScript calculation parity checks passed'");
sql.push(`delete from auth.users where id='${user}'; do $check$ begin
  if exists(select 1 from public.households where name='Golden checks') or exists(select 1 from public.accounts where id='${state.accounts[0].id}') then raise exception 'Sole-owner deletion did not clean up data'; end if;
  end; $check$;`);
console.log(sql.join("\n"));
