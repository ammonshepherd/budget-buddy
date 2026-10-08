import { id, categoryFigures, monthRow, inBudget, today } from "./budget.js";
export function moveMoney(state, { from, to, amount, month, saved = false }) {
  if (amount <= 0 || from === to && !saved) throw new Error("Choose different categories and a positive amount.");
  const figures = categoryFigures(state, from, month);
  if (amount > (saved ? figures.saved : figures.remaining)) throw new Error(`Only ${saved ? "Saved" : "Available"} funds can be moved.`);
  const source = monthRow(state, from, month), target = monthRow(state, to, month);
  if (saved) source.saved_used += amount;
  else {
    // Automatically reserved credit funds cannot be redirected to spending.
    if (source.assigned < amount) throw new Error("Card purchase reserves must stay available for the card payment.");
    source.assigned -= amount;
  }
  target.assigned += amount;
}
export function saveAccount(state, record) {
  const old = state.accounts.find((a) => a.id === record.id);
  if (old) Object.assign(old, record); else state.accounts.push(record);
  if (record.type === "credit" && record.on_budget && !state.categories.some((c) => c.card_account_id === record.id)) {
    let group = state.groups.find((g) => g.name === "Card payments" && !g.archived);
    if (!group) { group = { id: id(), name: "Card payments", position: state.groups.length, archived: false }; state.groups.push(group); }
    state.categories.push({ id: id(), name: `${record.name} payment`, group_id: group.id, kind: "card_payment", card_account_id: record.id, position: 0, archived: false });
  }
}
export function saveTransaction(state, record) {
  const t = { ...record, allocations: record.allocations || [] };
  const scoped = inBudget(state, { ...t, status: "active" });
  t.funding = ["expense", "refund"].includes(t.kind) && scoped ? "funded" : "not_required";
  if (!scoped || !["expense", "refund"].includes(t.kind)) t.allocations = [];
  const old = state.transactions.find((r) => r.id === t.id);
  if (old) Object.assign(old, t); else state.transactions.push(t);
}
export function saveTransfer(state, { from, to, amount, date = today(), existingId }) {
  if (from === to || amount <= 0) throw new Error("Choose different accounts and a positive amount.");
  const oldPair = existingId ? state.transactions.filter((t) => t.transfer_id === existingId && t.status === "active") : [];
  const transferId = existingId || id();
  const destination = state.accounts.find((a) => a.id === to);
  const source = state.accounts.find((a) => a.id === from);
  for (const [account, signed] of [[from, -amount], [to, amount]]) {
    const old = oldPair.find((t) => (t.amount < 0) === (signed < 0));
    const t = { id: old?.id || id(), account_id: account, amount: signed, date, posted_date: null,
      payee: `Transfer ${signed < 0 ? "to" : "from"} ${signed < 0 ? destination.name : source.name}`, note: "", tags: [], check_number: "",
      kind: "transfer", funding: "not_required", status: "active", transfer_id: transferId, merged_into_id: null, source: "manual", external_id: null, original_description: "", import_data: {}, allocations: [] };
    if (signed < 0 && destination.type === "credit" && destination.on_budget && inBudget(state, t)) {
      const category = state.categories.find((c) => c.card_account_id === to);
      t.allocations = [{ category_id: category.id, amount: signed }]; t.funding = "funded";
    }
    if (old) Object.assign(old, t); else state.transactions.push(t);
  }
}
export function voidTransaction(state, transactionId) {
  const record = state.transactions.find((t) => t.id === transactionId);
  for (const t of state.transactions) if (t.id === transactionId || record.transfer_id && t.transfer_id === record.transfer_id) t.status = "voided";
}
