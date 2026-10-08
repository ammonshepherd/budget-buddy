import test from "node:test";
import assert from "node:assert/strict";
import { demoState, clone, cents, categoryFigures, summary, monthRow, validateState, accountBalance, today, monthNow, id } from "../models/budget.js";
import { saveAccount, saveTransaction, saveTransfer, voidTransaction, moveMoney } from "../models/actions.js";
const purchase = (s, amount, category = s.categories[0].id, account = s.accounts[0].id) => ({ id: id(), account_id: account, date: today(), posted_date: null,
  amount: -amount, payee: "Store", kind: "expense", allocations: [{ category_id: category, amount: -amount }], funding: "funded", status: "active", note: "", tags: [], check_number: "", source: "manual", external_id: null, original_description: "", import_data: {}, transfer_id: null, merged_into_id: null });
test("decimal inputs are exact cents and invalid precision is rejected", () => {
  assert.equal(cents("1,234.56"),123456); assert.equal(cents("-0.01"),-1); assert.equal(cents("0.10"),10);
  for (const value of ["NaN","1.001","1e5", "", "--1"]) assert.throws(() => cents(value));
});
test("strict funded cash purchases reduce Remaining and cash without changing Assignable", () => {
  const s = demoState(), before = summary(s); saveTransaction(s, purchase(s,1200)); validateState(s);
  const f = categoryFigures(s, s.categories[0].id, monthNow()); assert.equal(f.remaining,28800); assert.equal(f.spent,1200);
  assert.equal(summary(s).assignable,before.assignable); assert.equal(summary(s).cash,before.cash-1200);
  saveTransaction(s,purchase(s,30000)); assert.throws(() => validateState(s), /Insufficient Available/);
});
test("Saved rolls over separately and an explicit move preserves reservations", () => {
  const s = demoState(); s.household.start_month = "2026-01"; s.months = [];
  monthRow(s,s.categories[0].id,"2026-01").assigned=5000;
  let f=categoryFigures(s,s.categories[0].id,"2026-03"); assert.equal(f.saved,5000); assert.equal(f.remaining,0);
  const before=summary(s).assignable;
  moveMoney(s,{from:s.categories[0].id,to:s.categories[0].id,amount:2000,month:"2026-03",saved:true});
  f=categoryFigures(s,s.categories[0].id,"2026-03"); assert.equal(f.saved,3000); assert.equal(f.remaining,2000); assert.equal(summary(s).assignable,before);
  assert.equal(categoryFigures(s,s.categories[0].id,"2026-04").saved,5000);
  assert.throws(() => moveMoney(s,{from:s.categories[0].id,to:s.categories[0].id,amount:5001,month:"2026-03",saved:true}));
});
test("reallocation is neutral and only Available can move", () => {
  const s=demoState(), before=summary(s).assignable;
  moveMoney(s,{from:s.categories[1].id,to:s.categories[0].id,amount:10000,month:monthNow()}); validateState(s);
  assert.equal(summary(s).assignable,before); assert.equal(categoryFigures(s,s.categories[0].id,monthNow()).assigned,40000);
  assert.throws(() => moveMoney(s,{from:s.categories[1].id,to:s.categories[0].id,amount:80000,month:monthNow()}));
});
test("splits spend each category but debit the account only once", () => {
  const s=demoState(), t=purchase(s,5000); t.allocations=[{category_id:s.categories[0].id,amount:-2000},{category_id:s.categories[1].id,amount:-3000}]; saveTransaction(s,t); validateState(s);
  assert.equal(accountBalance(s,s.accounts[0]),195000); assert.equal(categoryFigures(s,s.categories[0].id,monthNow()).spent,2000);
  t.allocations[0].amount=-1000; saveTransaction(s,t); assert.throws(()=>validateState(s),/Split amounts/);
});
test("funded card charges reserve real cash and payments are transfers", () => {
  const s=demoState(), card={id:id(),name:"Visa",type:"credit",on_budget:true,opening_balance:0,opening_date:`${monthNow()}-01`,archived:false}; saveAccount(s,card);
  const before=summary(s); saveTransaction(s,purchase(s,5000,s.categories[0].id,card.id)); validateState(s);
  const payment=s.categories.find(c=>c.card_account_id===card.id);
  assert.equal(summary(s).cash,before.cash); assert.equal(summary(s).assignable,before.assignable);
  assert.equal(categoryFigures(s,payment.id,monthNow()).remaining,5000); assert.equal(accountBalance(s,card),-5000);
  saveTransfer(s,{from:s.accounts[0].id,to:card.id,amount:5000}); validateState(s);
  assert.equal(accountBalance(s,card),0); assert.equal(categoryFigures(s,payment.id,monthNow()).remaining,0);
  assert.equal(summary(s).assignable,before.assignable); assert.equal(categoryFigures(s,s.categories[0].id,monthNow()).spent,5000);
});
test("unfunded imported charges stay in ledger without negative categories", () => {
  const s=demoState(), t=purchase(s,40000); t.source="csv"; t.funding="needs_funding"; t.allocations=[]; s.transactions.push(t); validateState(s);
  assert.equal(accountBalance(s,s.accounts[0]),160000); assert.equal(categoryFigures(s,s.categories[0].id,monthNow()).remaining,30000);
  assert.equal(summary(s).unresolved,1); assert.equal(summary(s).assignable,50000);
});
test("cash transfers do not create income or spend and delete both entries", () => {
  const s=demoState(), target={...s.accounts[0],id:id(),name:"Savings",opening_balance:0}; saveAccount(s,target); const before=summary(s);
  saveTransfer(s,{from:s.accounts[0].id,to:target.id,amount:50000}); validateState(s); assert.equal(summary(s).assignable,before.assignable);
  voidTransaction(s,s.transactions[0].id); validateState(s); assert.equal(s.transactions.filter(t=>t.status==="active").length,0);
});
test("opening cutoff uses posted date; prior history is never counted twice", () => {
  const s=demoState(), t=purchase(s,1000); t.date="2020-01-01"; t.posted_date=null; t.funding="not_required"; t.allocations=[]; s.transactions.push(t); validateState(s);
  assert.equal(accountBalance(s,s.accounts[0]),200000); assert.equal(summary(s).cash,200000);
  t.posted_date=today(); assert.equal(accountBalance(s,s.accounts[0]),199000);
});
test("editing history cannot leave a later month negative", () => {
  const s=demoState(); s.household.start_month="2026-01"; s.months=[];
  monthRow(s,s.categories[0].id,"2026-01").assigned=5000;
  moveMoney(s,{from:s.categories[0].id,to:s.categories[0].id,amount:5000,month:"2026-02",saved:true}); validateState(s);
  s.months[0].assigned=4000; assert.throws(()=>validateState(s),/Insufficient Available/);
});
test("group reassignment preserves amounts; account baseline is immutable after use", () => {
  const s=demoState(); saveTransaction(s,purchase(s,1000)); const previous=clone(s),group={id:id(),name:"New group",position:1,archived:false}; s.groups.push(group); s.categories[0].group_id=group.id;
  assert.equal(categoryFigures(s,s.categories[0].id,monthNow()).spent,1000); validateState(s,previous);
  s.accounts[0].opening_balance+=100; assert.throws(()=>validateState(s,previous),/baseline is locked/);
});
test("imported transfer conversion reuses both bank records without double counting", () => {
  const s=demoState(), other={...s.accounts[0],id:id(),name:"Savings",opening_balance:0};saveAccount(s,other);
  const outgoing={...purchase(s,1000),source:"csv",funding:"needs_funding",allocations:[],external_id:"out-1",posted_date:today(),import_data:{Bank:"original"}};
  const incoming={...outgoing,id:id(),account_id:other.id,amount:1000,kind:"income",funding:"not_required",external_id:"in-1"};s.transactions.push(outgoing,incoming);
  const before=summary(s);saveTransfer(s,{from:outgoing.account_id,to:incoming.account_id,amount:1000,date:today(),retainedId:outgoing.id,counterpartId:incoming.id});validateState(s);
  assert.equal(s.transactions.length,2);assert.equal(summary(s).assignable,before.assignable);assert.equal(summary(s).unresolved,0);assert.equal(s.transactions[0].external_id,"out-1");assert.equal(s.transactions[0].posted_date,today());assert.deepEqual(s.transactions[0].import_data,{Bank:"original"});
});
test("future account baselines cannot create Assignable money today", () => {
  const s=demoState();s.accounts[0].opening_date="2099-01-01";assert.throws(()=>validateState(s),/opening date no later than today/);
});
