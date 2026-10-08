import { cents, id, today, inBudget } from "../models/budget.js";
import { saveTransaction, saveTransfer, voidTransaction } from "../models/actions.js";
import { getState, changeState } from "../models/store.js";
import { $, $$, dialog, fill, options, decimal, template, formatMoney, handle, announce, confirm } from "./ui.js";
import { openMove } from "./budgetController.js";
export function editTransaction(record, onSave, accountId) {
  if (record?.kind === "transfer") return editTransfer(record, onSave);
  const state = getState(), d = dialog(record ? "Edit transaction" : "Add transaction", "transaction-form");
  const form = d.form;
  options(form.account_id, state.accounts.filter((a) => !a.archived || a.id === record?.account_id), { selected: record?.account_id || accountId });
  if (!form.account_id.options.length) { d.error("Add an account first."); $("button[type=submit]", form).disabled = true; return; }
  fill(form, record ? { ...record, amount: decimal(record.kind === "adjustment" ? record.amount : Math.abs(record.amount)), tags: record.tags.join("; ") } : { date: today() });
  form.date.max = today(); form.posted_date.max = today();
  const addSplit = (allocation = {}) => {
    const node = template("split-row");
    const categories = getState().categories.filter((c) => c.kind === "spending" && (!c.archived || c.id === allocation.category_id));
    options($("select", node), categories, { selected: allocation.category_id, placeholder: "Choose category" });
    $("input", node).value = allocation.amount ? decimal(Math.abs(allocation.amount)) : "";
    $("button", node).addEventListener("click", () => { node.remove(); update(); });
    $(".split-rows", form).append(node);
  };
  (record?.allocations.length ? record.allocations : [{}]).forEach(addSplit);
  const update = () => {
    const account = getState().accounts.find((a) => a.id === form.account_id.value);
    const scoped = inBudget(getState(), { account_id: account?.id, date: form.date.value, posted_date: form.posted_date.value || null, status: "active" });
    const split = ["expense", "refund"].includes(form.kind.value) && scoped;
    $(".split-fieldset", form).hidden = !split;
    $$(".split-rows select,.split-rows input", form).forEach((f) => f.disabled = !split);
    $(".fund-transaction", form).hidden = !split;
    $(".transaction-status", form).textContent = record?.funding === "needs_funding" ? "Needs funding: assign categories and cover this charge before saving." : !scoped ? "This entry is outside category budgeting (tracking or before the cutoff)." : "Category purchases must be fully funded before saving.";
    try {
      const total = $$(".split-rows input", form).reduce((sum, field) => sum + (field.value ? cents(field.value) : 0), 0);
      $(".split-summary", form).textContent = `Split total ${formatMoney(total)} / transaction ${formatMoney(form.amount.value ? cents(form.amount.value) : 0)}`;
    } catch { $(".split-summary", form).textContent = "Enter amounts with up to two decimals."; }
  };
  form.addEventListener("input", update); form.addEventListener("change", update);
  $(".add-split", form).addEventListener("click", () => { addSplit(); update(); });
  $(".fund-transaction", form).addEventListener("click", () => {
    const target = $(".split-rows select", form)?.value;
    openMove(form.date.value.slice(0, 7), () => { update(); }, target);
  });
  const deleteButton = $(".void-transaction", form); deleteButton.hidden = !record;
  deleteButton.addEventListener("click", () => confirm("Delete transaction", "Void this transaction? It will leave the active ledger; the original record stays in history. Budget funding will be rechecked.", async () => { await changeState((s) => voidTransaction(s, record.id)); d.close(); announce("Transaction deleted."); await onSave(); }));
  update();
  d.submit(async (v) => {
    let amount = cents(v.amount);
    if (v.kind !== "adjustment" && amount <= 0) throw new Error("Enter a positive amount.");
    const sign = v.kind === "expense" ? -1 : 1; if (v.kind === "expense") amount = -amount;
    const allocations = $(".split-fieldset", form).hidden ? [] : $$(".split-row", form).map((row) => {
      const value = cents($("input", row).value); if (value <= 0) throw new Error("Split amounts must be positive.");
      return { category_id: $("select", row).value, amount: value * sign };
    });
    await changeState((s) => saveTransaction(s, { ...(record || { id: id(), status: "active", transfer_id: null, merged_into_id: null, source: "manual", external_id: null, original_description: "", import_data: {} }),
      account_id: v.account_id, date: v.date, posted_date: v.posted_date || null, kind: v.kind, payee: v.payee.trim(), amount, note: v.note, check_number: v.check_number, tags: v.tags.split(";").map((t) => t.trim()).filter(Boolean), allocations }));
    announce("Transaction saved."); await onSave();
  });
}
export function editTransfer(record, onSave, accountId) {
  const s = getState(), d = dialog(record ? "Edit transfer" : "Transfer money", "transfer-form");
  const pair = record ? s.transactions.filter((t) => t.transfer_id === record.transfer_id && t.status === "active") : [];
  const accounts = s.accounts.filter((a) => !a.archived || pair.some((t) => t.account_id === a.id));
  options(d.form.from, accounts, { selected: pair.find((t) => t.amount < 0)?.account_id || accountId });
  options(d.form.to, accounts, { selected: pair.find((t) => t.amount > 0)?.account_id });
  fill(d.form, { date: record?.date || today(), amount: record ? decimal(Math.abs(record.amount)) : "" }); d.form.date.max = today();
  d.submit(async (v) => { await changeState((draft) => saveTransfer(draft, { ...v, amount: cents(v.amount), existingId: record?.transfer_id })); announce("Transfer saved."); await onSave(); });
  if (record) {
    const button = document.createElement("button"); button.type = "button"; button.className = "danger secondary"; button.textContent = "Delete transfer";
    button.addEventListener("click", () => confirm("Delete transfer", "Void both linked entries?", async () => { await changeState((draft) => voidTransaction(draft, record.id)); d.close(); await onSave(); })); d.form.append(button);
  }
}
export function renderLedger(container, transactions, onSave) {
  container.replaceChildren(); const s = getState();
  if (!transactions.length) { const p = document.createElement("p"); p.className = "empty"; p.textContent = "No transactions match."; container.append(p); return; }
  for (const t of transactions) {
    const node = template("transaction"); $(".payee", node).textContent = t.payee; $(".amount", node).textContent = formatMoney(t.amount);
    const account = s.accounts.find((a) => a.id === t.account_id);
    $(".meta", node).textContent = `${t.date} · ${account.name} · ${t.kind}${!inBudget(s, t) ? " · outside budget cutoff" : ""}`;
    $(".funding-status", node).textContent = t.funding === "needs_funding" ? "Needs funding" : "";
    for (const allocation of t.allocations) { const item = document.createElement("li"); item.textContent = `${s.categories.find((c) => c.id === allocation.category_id)?.name}: ${formatMoney(allocation.amount)}`; $(".allocations", node).append(item); }
    $(".note", node).textContent = [t.note, t.check_number && `Check ${t.check_number}`, t.tags.length && `Tags: ${t.tags.join(", ")}`].filter(Boolean).join(" · ");
    const merged = s.transactions.filter((r) => r.merged_into_id === t.id);
    $(".bank-data", node).textContent = [t.posted_date && `Posted ${t.posted_date}`, t.original_description && `Bank: ${t.original_description}`, t.external_id && `Bank ID: ${t.external_id}`, merged.length && `${merged.length} matched bank record(s) retained`, Object.keys(t.import_data).length && `Imported fields: ${JSON.stringify(t.import_data)}`].filter(Boolean).join(" · ");
    const button = $(".edit-transaction", node); button.textContent = t.funding === "needs_funding" ? "Fund / edit" : "Edit"; button.setAttribute("aria-label", `${button.textContent} ${t.payee} ${t.date}`); button.addEventListener("click", () => editTransaction(t, onSave));
    container.append(node);
  }
}
