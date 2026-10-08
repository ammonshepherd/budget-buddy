import test from "node:test";
import assert from "node:assert/strict";
import { parseCSV, parseDate, mappedTransactions, matchTransaction } from "../models/csv.js";
import { demoState, today, id } from "../models/budget.js";
test("CSV handles commas, escaped quotes, CRLF, BOM and multiline cells",()=>{
  const csv=parseCSV('\uFEFFDate,Description,Amount\r\n2026-01-01,"Store, \"\"Bob\"\"\nOutlet",-1.20\r\n');
  assert.deepEqual(csv.headers,["Date","Description","Amount"]); assert.equal(csv.rows[0][1],'Store, "Bob"\nOutlet');
  assert.throws(()=>parseCSV('A,A\n1,2')); assert.throws(()=>parseCSV('A,B\n"unfinished,2')); assert.throws(()=>parseCSV('A,B\n1,2,3'));
});
test("dates have explicit formats and reject impossible and ambiguous inputs",()=>{
  assert.equal(parseDate("03/04/2026","mdy"),"2026-03-04"); assert.equal(parseDate("03/04/2026","dmy"),"2026-04-03");
  assert.throws(()=>parseDate("2026-02-30")); assert.throws(()=>parseDate("03/04/2026","iso"));
});
test("imports preserve all raw fields and flag actual unfunded purchases",()=>{
  const s=demoState(),csv=parseCSV(`Date,Description,Amount,ID\n${today()},Coffee,-4.50,BANK1\nnot-a-date,Bad,4,BANK2`);
  const rows=mappedTransactions(csv,{date:"0",payee:"1",amount:"2",external_id:"3",dateFormat:"iso",reverse:"no"},s.accounts[0],s);
  assert.equal(rows[0].transaction.amount,-450); assert.equal(rows[0].transaction.funding,"needs_funding"); assert.equal(rows[0].transaction.import_data.ID,"BANK1"); assert.ok(rows[1].error);
});
test("matching retains the categorized parent and a merged bank audit record",()=>{
  const s=demoState(),t={id:id(),account_id:s.accounts[0].id,date:today(),amount:-1000,payee:"Manual",status:"active",tags:["manual"],external_id:null,posted_date:null,original_description:"",import_data:{},check_number:"",allocations:[{category_id:s.categories[0].id,amount:-1000}]}; s.transactions.push(t);
  const bank={...t,id:id(),payee:"BANK PAYEE",external_id:"bank-1",tags:["bank"],original_description:"BANK PAYEE",allocations:[],import_data:{Amount:"-10.00"}};
  matchTransaction(s,bank,t.id); assert.equal(s.transactions[0].payee,"Manual"); assert.equal(s.transactions[0].allocations.length,1); assert.equal(s.transactions[1].status,"merged"); assert.equal(s.transactions[1].merged_into_id,t.id); assert.deepEqual(s.transactions[0].tags,["manual","bank"]);
  assert.throws(()=>matchTransaction(s,{...bank,amount:-2000},t.id));
});
