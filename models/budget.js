// Money is stored as integer minor units (cents); floating point is never summed.
export const today = () => new Date().toISOString().slice(0, 10);
export const monthNow = () => today().slice(0, 7);
export const id = () => crypto.randomUUID();
export const clone = (value) => structuredClone(value);
export const money = (cents, currency = "USD") => new Intl.NumberFormat(undefined, {
  style: "currency", currency
}).format(cents / 100);
export function cents(value) {
  const raw = String(value).trim().replace(/[$\s]/g, "");
  if (!/^-?(\d+|\d{1,3}(,\d{3})+)(\.\d{1,2})?$/.test(raw)) throw new Error("Use a dot for decimals (up to two places) and commas only for thousands.");
  const text = raw.replace(/,/g, "");
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace("-", "").split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result > 999999999999) throw new Error("Amount is too large.");
  return negative ? -result : result;
}
export function monthsBetween(start, end) {
  const result = [];
  for (let cursor = start; cursor <= end;) {
    result.push(cursor);
    const [y, m] = cursor.split("-").map(Number);
    cursor = `${y + (m === 12 ? 1 : 0)}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
    if (result.length > 1200) throw new Error("Budget history exceeds 100 years.");
  }
  return result;
}
export const active = (t) => t.status === "active";
export function countsForAccount(t, account, asOf = today()) {
  const date = t.posted_date || t.date;
  return active(t) && date >= account.opening_date && date <= asOf;
}
export function inBudget(state, t) {
  const account = state.accounts.find((a) => a.id === t.account_id);
  return !!account && account.on_budget && account.type !== "tracking" &&
    countsForAccount(t, account) && t.date.slice(0, 7) >= state.household.start_month;
}
export function accountBalance(state, account) {
  return account.opening_balance + state.transactions.filter((t) => t.account_id === account.id &&
    countsForAccount(t, account)).reduce((sum, t) => sum + t.amount, 0);
}
export function categoryFigures(state, categoryId, month) {
  let saved = 0;
  let result = { assigned: 0, planned: 0, spent: 0, remaining: 0, saved: 0 };
  const category = state.categories.find((c) => c.id === categoryId);
  for (const period of monthsBetween(state.household.start_month, month)) {
    const row = state.months.find((r) => r.category_id === categoryId && r.month === period);
    let autoAssigned = 0;
    let spent = 0;
    for (const t of state.transactions) {
      if (!inBudget(state, t) || t.date.slice(0, 7) !== period || t.funding !== "funded") continue;
      const account = state.accounts.find((a) => a.id === t.account_id);
      if (category?.kind === "card_payment" && account.id === category.card_account_id && t.kind !== "transfer") {
        autoAssigned -= t.allocations.reduce((sum, a) => sum + a.amount, 0);
      }
      spent -= t.allocations.filter((a) => a.category_id === categoryId).reduce((sum, a) => sum + a.amount, 0);
    }
    const assigned = (row?.assigned || 0) + autoAssigned;
    saved -= row?.saved_used || 0;
    result = { assigned, planned: row?.planned || 0, spent, remaining: assigned - spent, saved };
    saved += result.remaining;
  }
  return result;
}
export function summary(state, month = monthNow()) {
  const cash = state.accounts.filter((a) => a.on_budget && a.type === "cash")
    .reduce((sum, a) => sum + accountBalance(state, a), 0);
  const lastMonth = [month, ...state.months.map((r) => r.month), ...state.transactions.map((t) => t.date.slice(0, 7))].sort().at(-1);
  const reserved = state.categories.reduce((sum, c) => {
    const f = categoryFigures(state, c.id, lastMonth);
    return sum + f.saved + f.remaining;
  }, 0);
  return { cash, reserved, assignable: cash - reserved,
    unresolved: state.transactions.filter((t) => active(t) && t.funding === "needs_funding").length };
}
export function monthRow(state, categoryId, month) {
  let row = state.months.find((r) => r.category_id === categoryId && r.month === month);
  if (!row) { row = { category_id: categoryId, month, assigned: 0, planned: 0, saved_used: 0 }; state.months.push(row); }
  return row;
}
export function validateState(state, previous) {
  const fail = (message) => { throw new Error(message); };
  const amount = (n) => Number.isSafeInteger(n) && Math.abs(n) <= 999999999999;
  const exists = (list, value) => list.some((row) => row.id === value);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(state.household.start_month)) fail("Choose a budget starting month.");
  for (const list of [state.accounts, state.groups, state.categories, state.transactions]) {
    if (new Set(list.map((r) => r.id)).size !== list.length) fail("Duplicate record IDs.");
  }
  for (const a of state.accounts) {
    if (!a.name.trim() || !amount(a.opening_balance) || !["cash", "credit", "tracking"].includes(a.type)) fail("Invalid account.");
    if (a.type === "tracking" && a.on_budget) fail("Tracking accounts cannot fund the budget.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.opening_date) || a.opening_date > today()) fail("Choose an opening date no later than today.");
    if (a.type === "credit" && a.on_budget && !state.categories.some((c) => c.card_account_id === a.id)) fail("Credit accounts need a payment category.");
  }
  for (const c of state.categories) {
    if (!c.name.trim() || !exists(state.groups, c.group_id)) fail("Every category needs a name and group.");
    if (!["spending", "card_payment"].includes(c.kind)) fail("Invalid category type.");
    if (c.kind === "card_payment" && !state.accounts.some((a) => a.id === c.card_account_id && a.type === "credit" && a.on_budget)) fail("Invalid card payment category.");
  }
  if (state.groups.some((g) => !g.name.trim())) fail("A group needs a name.");
  const seen = new Set();
  for (const r of state.months) {
    const key = `${r.category_id}/${r.month}`;
    if (seen.has(key) || !exists(state.categories, r.category_id) || r.month < state.household.start_month ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month) || ![r.assigned, r.planned, r.saved_used].every((n) => amount(n) && n >= 0)) fail("Invalid monthly budget amounts.");
    seen.add(key);
  }
  for (const t of state.transactions) {
    if (!exists(state.accounts, t.account_id) || !amount(t.amount) || t.amount === 0 || !t.payee.trim()) fail("A transaction needs an account, payee and nonzero amount.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date) || t.date > today() || (t.posted_date && (!/^\d{4}-\d{2}-\d{2}$/.test(t.posted_date) || t.posted_date > today()))) fail("Transactions need a valid date no later than today.");
    if (!["active", "voided", "merged"].includes(t.status) || !["funded", "needs_funding", "not_required"].includes(t.funding)) fail("Invalid transaction status.");
    if (t.status === "merged" && (!exists(state.transactions, t.merged_into_id) || t.merged_into_id === t.id)) fail("A matched transaction must refer to its retained record.");
    if (t.allocations.some((a) => !exists(state.categories, a.category_id) || !amount(a.amount) || a.amount === 0 || Math.sign(a.amount) !== Math.sign(t.amount))) fail("Splits must have categories, nonzero amounts and the same sign.");
    const allocationSum = t.allocations.reduce((sum, a) => sum + a.amount, 0);
    if (t.kind === "expense" || t.kind === "refund") {
      if (t.kind === "expense" && t.amount > 0 || t.kind === "refund" && t.amount < 0) fail("Invalid transaction direction.");
      if (t.allocations.length && allocationSum !== t.amount) fail("Split amounts must equal the transaction total.");
      if (inBudget(state, t) && active(t) && (t.funding === "not_required" || t.funding === "funded" && !t.allocations.length)) fail("Budget purchases require funded categories or a Needs funding flag.");
      if (t.allocations.some((a) => state.categories.find((c) => c.id === a.category_id)?.kind !== "spending")) fail("Purchases use spending categories.");
    } else if (t.kind === "transfer") {
      if (!active(t)) continue;
      const pair = state.transactions.filter((p) => active(p) && p.transfer_id === t.transfer_id);
      if (active(t) && (!t.transfer_id || pair.length !== 2 || pair[0].account_id === pair[1].account_id || pair[0].amount + pair[1].amount !== 0 || pair[0].date !== pair[1].date)) fail("Transfers need two equal, opposite entries on the same date.");
      const destination = pair.find((p) => p.amount > 0);
      const card = state.accounts.find((a) => a.id === destination?.account_id);
      const payment = t.amount < 0 && card?.type === "credit" && card.on_budget && inBudget(state, t);
      if (payment && (t.funding !== "funded" || allocationSum !== t.amount || t.allocations.length !== 1 ||
        state.categories.find((c) => c.id === t.allocations[0]?.category_id)?.card_account_id !== card.id)) fail("Card payments must use the matching payment category.");
      if (!payment && t.allocations.length) fail("Regular transfers do not spend categories.");
    } else if (!["income", "adjustment"].includes(t.kind) || t.allocations.length || t.funding !== "not_required" || (t.kind === "income" && t.amount < 0)) fail("Invalid income or balance adjustment.");
  }
  const end = [monthNow(), ...state.months.map((r) => r.month), ...state.transactions.map((t) => t.date.slice(0, 7))].sort().at(-1);
  for (const c of state.categories) for (const month of monthsBetween(state.household.start_month, end)) {
    const f = categoryFigures(state, c.id, month);
    if (!Object.values(f).every(Number.isSafeInteger)) fail("Budget totals exceed the supported exact-cent range.");
    if (f.assigned < 0 || f.saved < 0 || f.remaining < 0) fail(`Insufficient Available in ${c.name} (${month}). Reallocate money before saving.`);
  }
  if (!Object.values(summary(state)).every(Number.isSafeInteger)) fail("Budget totals exceed the supported exact-cent range.");
  if (previous) {
    if (state.household.start_month !== previous.household.start_month || state.household.currency !== previous.household.currency) fail("Starting month and currency cannot be changed after setup.");
    for (const a of state.accounts) {
      const old = previous.accounts.find((r) => r.id === a.id);
      if (old && previous.transactions.some((t) => t.account_id === a.id) && ["type", "on_budget", "opening_balance", "opening_date"].some((key) => old[key] !== a[key])) fail("Account baseline is locked after transactions exist. Use a balance adjustment.");
    }
    if (state.categories.some((c) => !c.archived && state.groups.find((g) => g.id === c.group_id)?.archived)) fail("Move or archive categories before archiving their group.");
    const oldSummary = summary(previous); const newSummary = summary(state);
    if (newSummary.assignable < 0 && newSummary.reserved > oldSummary.reserved) fail("There is not enough Assignable money. Resolve unfunded charges or release assignments first.");
  }
  return state;
}
export function demoState() {
  const group = id(), cash = id(), groceries = id(), bills = id(), reserve = id();
  return { household: { id: id(), name: "Demo household", currency: "USD", start_month: monthNow(), revision: 0 },
    accounts: [{ id: cash, name: "Checking", type: "cash", on_budget: true, opening_balance: 200000, opening_date: `${monthNow()}-01`, archived: false }],
    groups: [{ id: group, name: "Everyday", position: 0, archived: false }],
    categories: [{ id: groceries, name: "Groceries", group_id: group, kind: "spending", card_account_id: null, position: 0, archived: false },
      { id: bills, name: "Bills", group_id: group, kind: "spending", card_account_id: null, position: 1, archived: false },
      { id: reserve, name: "Savings", group_id: group, kind: "spending", card_account_id: null, position: 2, archived: false }],
    months: [{ category_id: groceries, month: monthNow(), assigned: 30000, planned: 35000, saved_used: 0 },
      { category_id: bills, month: monthNow(), assigned: 80000, planned: 80000, saved_used: 0 }], transactions: [] };
}
