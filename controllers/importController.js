import { getState, changeState } from "../models/store.js";
import { parseCSV, mappedTransactions, matchTransaction } from "../models/csv.js";
import { $, $$, template, options, dialog, announce, formatMoney } from "./ui.js";
export function openImport(onSave) {
  const d = dialog("Upload transactions", "import-form");
  options(d.form.account_id, getState().accounts.filter((a) => !a.archived));
  d.submit(async (v) => {
    const file = d.form.file.files[0]; if (!file || file.size > 5_000_000) throw new Error("Choose a CSV smaller than 5 MB.");
    if (!v.account_id) throw new Error("Add a destination account first.");
    const csv = parseCSV(await file.text());
    // Close before opening the next dialog so focus stays with the current step.
    d.close(); mapColumns(csv, v.account_id, onSave);
  });
}
const fields = { date: "Transaction date", payee: "Payee / description", amount: "Signed amount", debit: "Money out (debit)", credit: "Money in (credit)", posted_date: "Posted date", external_id: "Bank transaction ID", note: "Note", check_number: "Check number", tags: "Tags" };
const guesses = { date: /^(date|transaction date)$/i, payee: /^(payee|description|merchant)$/i, amount: /^amount$/i, debit: /^(debit|withdrawal)$/i, credit: /^(credit|deposit)$/i, posted_date: /^(posted date|posted_date)$/i, external_id: /^(id|transaction id|external_id)$/i, note: /^(note|memo)$/i, check_number: /^(check|check number)$/i, tags: /^tags$/i };
function mapColumns(csv, accountId, onSave) {
  const d = dialog("Map CSV columns", "mapping-form");
  $(".mapping-account", d.form).textContent = `Importing ${csv.rows.length} rows into ${getState().accounts.find((a) => a.id === accountId).name}`;
  for (const [key, label] of Object.entries(fields)) {
    const node = template("mapping-field"), select = $("select", node); $("span", node).textContent = label; select.name = key;
    csv.headers.forEach((header, index) => select.add(new Option(header, String(index))));
    const guessed = csv.headers.findIndex((h) => guesses[key].test(h)); select.value = guessed >= 0 ? String(guessed) : "";
    if (["date", "payee"].includes(key)) select.required = true;
    $(".mapping-fields", d.form).append(node);
  }
  d.submit(async (v) => {
    if (v.amount === "" && v.debit === "" && v.credit === "") throw new Error("Map an amount column or debit/credit columns.");
    const chosen = Object.keys(fields).map((key) => v[key]).filter((value) => value !== "");
    if (new Set(chosen).size !== chosen.length) throw new Error("Map each CSV column to only one field.");
    const rows = mappedTransactions(csv, v, getState().accounts.find((a) => a.id === accountId), getState());
    d.close(); previewImport(rows, onSave);
  });
}
function previewImport(rows, onSave) {
  const d = dialog("Review CSV import", "import-preview");
  const invalid = rows.filter((r) => r.error).length;
  $(".preview-summary", d.form).textContent = `${rows.length} rows · ${invalid} invalid · ${rows.filter((r) => r.candidates?.length).length} potential duplicates. Invalid rows will be skipped.`;
  const decisions = new Map();
  // Same-file duplicate IDs and date/amount pairs are also highlighted; they are
  // never matched or removed silently based on a heuristic.
  const seen = new Set();
  for (const row of rows) {
    const node = template("preview-row"), select = $("select", node), t = row.transaction;
    if (row.error) { $("p", node).textContent = `Row ${row.row}: ${row.error}`; select.value = "skip"; select.disabled = true; }
    else {
      const key = `${t.account_id}/${t.external_id || `${t.date}/${t.amount}`}`;
      const duplicateInFile = seen.has(key); seen.add(key);
      $("p", node).textContent = `Row ${row.row}: ${t.date} · ${t.payee} · ${formatMoney(t.amount)}${t.funding === "needs_funding" ? " · Needs funding" : ""}${duplicateInFile ? " · potential duplicate in this file" : ""}`;
      if (row.candidates.length || duplicateInFile) {
        select.add(new Option("Choose a duplicate action", ""), 0); select.value = ""; select.required = true;
        for (const candidate of row.candidates) {
          if (candidate.amount === t.amount) select.add(new Option(`Match ${candidate.payee} (${candidate.date})`, `match:${candidate.id}`));
          if (t.external_id && t.external_id === candidate.external_id) select.options[1].disabled = true;
        }
      }
      select.setAttribute("aria-label", `Action for row ${row.row} ${t.payee}`);
    }
    decisions.set(row.row, select); $(".preview-rows", d.form).append(node);
  }
  d.submit(async () => {
    const selected = rows.filter((r) => !r.error && decisions.get(r.row).value !== "skip");
    if (!selected.length) throw new Error("Select at least one valid row to import.");
    await changeState((s) => {
      for (const row of selected) {
        const decision = decisions.get(row.row).value;
        if (decision.startsWith("match:")) matchTransaction(s, row.transaction, decision.slice(6));
        else {
          if (row.transaction.external_id && s.transactions.some((t) => t.status === "active" && t.account_id === row.transaction.account_id && t.external_id === row.transaction.external_id)) throw new Error(`Row ${row.row} has an existing bank ID. Match or skip it.`);
          s.transactions.push(row.transaction);
        }
      }
    }); announce(`${selected.length} bank record(s) imported. Resolve Needs funding entries in Activity.`); await onSave();
  });
}
