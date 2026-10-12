/**
 * All envelope-budget math lives here. Pages and controllers call these
 * functions; they never recompute budget numbers themselves.
 *
 * Every amount is integer cents (see ./money.ts). Inputs named `spent` or
 * `uncategorizedSpent` are positive magnitudes of money going out; use
 * `spentFromAmounts` to turn signed transaction amounts into one.
 */
import { assertCents, type Cents } from "./money";
import { addMonths, isMonth, monthOf, type Month } from "./month";
import type { BudgetData, Envelope, Transaction } from "./types";

export { isMonth, type Month };

/** What the user did with one envelope in one month. */
export interface EnvelopeMonthInput {
  month: Month;
  /** Money assigned from Available to Assign this month. */
  assigned: Cents;
  /** Money moved from this envelope's Saved into Remaining this month. */
  released: Cents;
  /** Money spent from the envelope this month (positive = spent). */
  spent: Cents;
}

/** The numbers shown for one envelope in one month. */
export interface EnvelopeMonth {
  month: Month;
  assigned: Cents;
  released: Cents;
  spent: Cents;
  /** Saved(M): the reserve carried in from earlier months, before releases. */
  savedAtStart: Cents;
  /**
   * The reserve still held this month: Saved(M) − Released(M). Negative only
   * if earlier spending was categorized after this month's release; shown
   * as-is (like `shortfall`) rather than thrown, so the page still renders.
   */
  saved: Cents;
  /** Remaining(M) = Assigned + Released − Spent. */
  remaining: Cents;
  /**
   * How far Remaining fell below zero (0 when it did not). Envelopes must
   * never go negative; a value here means a spend was recorded without the
   * shortfall being covered, and the UI should ask the user to cover it.
   */
  shortfall: Cents;
  /** Envelope money = Saved + Remaining. */
  envelopeMoney: Cents;
  /** Saved(M+1) = Saved(M) − Released(M) + Remaining(M). */
  savedNext: Cents;
}

/**
 * Computes one envelope month from the reserve carried in.
 *
 * Remaining is not clamped at zero: hiding an overspend would make the money
 * disappear from the books and break the Available to Assign identity.
 * Instead the overspend is reported as `shortfall` so it can be covered.
 */
export function computeEnvelopeMonth(
  input: EnvelopeMonthInput,
  savedAtStart: Cents,
): EnvelopeMonth {
  const { month, assigned, released, spent } = input;
  assertCents(assigned, "assigned");
  assertCents(released, "released");
  assertCents(spent, "spent");
  assertCents(savedAtStart, "savedAtStart");
  if (released < 0) {
    throw new RangeError(`released must not be negative (got ${released}) in ${month}`);
  }

  const remaining = assigned + released - spent;
  const saved = savedAtStart - released;
  return {
    month,
    assigned,
    released,
    spent,
    savedAtStart,
    saved,
    remaining,
    shortfall: Math.max(0, -remaining),
    envelopeMoney: saved + remaining,
    savedNext: saved + remaining,
  };
}

/**
 * Runs an envelope forward month by month so Saved accumulates.
 * Months with no activity can be left out: they would change nothing.
 * Input order does not matter; the result is sorted by month.
 */
export function computeEnvelopeHistory(inputs: readonly EnvelopeMonthInput[]): EnvelopeMonth[] {
  const sorted = [...inputs].sort((a, b) => a.month.localeCompare(b.month));
  const result: EnvelopeMonth[] = [];
  let saved = 0;
  for (const input of sorted) {
    if (!isMonth(input.month)) {
      throw new RangeError(`"${input.month}" is not a YYYY-MM month`);
    }
    if (result.at(-1)?.month === input.month) {
      throw new RangeError(`${input.month} appears more than once`);
    }
    const month = computeEnvelopeMonth(input, saved);
    result.push(month);
    saved = month.savedNext;
  }
  return result;
}

/**
 * The envelope as of `month`: its own row if it has one, otherwise an empty
 * month that carries the latest earlier Saved forward.
 */
export function envelopeAsOf(history: readonly EnvelopeMonth[], month: Month): EnvelopeMonth {
  let savedAtStart = 0;
  for (const row of history) {
    if (row.month === month) return row;
    if (row.month > month) break;
    savedAtStart = row.savedNext;
  }
  return computeEnvelopeMonth({ month, assigned: 0, released: 0, spent: 0 }, savedAtStart);
}

/** Totals needed for Available to Assign, each counted through the end of a month. */
export interface AvailableToAssignInput {
  /** Opening balances of all budget accounts. */
  openingBalances: Cents;
  /** Income received through the end of the month. */
  income: Cents;
  /** Everything assigned to envelopes through the end of the month. */
  assigned: Cents;
  /** Outflows not yet categorized through the end of the month (positive = spent). */
  uncategorizedSpent: Cents;
}

/**
 * Available to Assign(M) = opening balances + income − all Assigned
 * − uncategorized outflows, each through the end of M.
 * Releasing Saved does not appear here: that money stays in its envelope.
 */
export function availableToAssign(input: AvailableToAssignInput): Cents {
  assertCents(input.openingBalances, "openingBalances");
  assertCents(input.income, "income");
  assertCents(input.assigned, "assigned");
  assertCents(input.uncategorizedSpent, "uncategorizedSpent");
  return input.openingBalances + input.income - input.assigned - input.uncategorizedSpent;
}

/** Over Assigned = max(0, −Available to Assign). */
export function overAssigned(available: Cents): Cents {
  return Math.max(0, -available);
}

/** Assigning is blocked when Available to Assign is insufficient. */
export function canAssign(available: Cents, amount: Cents): boolean {
  assertCents(amount, "amount");
  return amount <= available;
}

/**
 * Converts signed transaction amounts (outflow negative, refunds positive)
 * into a Spent figure (positive = money went out).
 */
export function spentFromAmounts(amounts: readonly Cents[]): Cents {
  let total = 0;
  for (const amount of amounts) {
    assertCents(amount, "amount");
    total += amount;
  }
  return total === 0 ? 0 : -total;
}

/** What it would take to record more spending in an envelope this month. */
export interface SpendCheck {
  /** Remaining after the spend, before any cover. */
  remainingAfter: Cents;
  /** How much must be covered to keep Remaining at or above zero. */
  shortfall: Cents;
  /** Step 1 of the cover prompt: the part this envelope's Saved can cover. */
  fromSaved: Cents;
  /** Left for step 2 (another envelope) or step 3 (Available to Assign). */
  stillShort: Cents;
}

/**
 * Checks a new spend before it is categorized. When `shortfall` is above
 * zero the UI prompts to cover it: first from this envelope's Saved
 * (`fromSaved`), then from another envelope or Available to Assign
 * (`stillShort`).
 */
export function checkSpend(current: EnvelopeMonth, additionalSpent: Cents): SpendCheck {
  assertCents(additionalSpent, "additionalSpent");
  const remainingAfter = current.remaining - additionalSpent;
  const shortfall = Math.max(0, -remainingAfter);
  const fromSaved = Math.min(shortfall, Math.max(0, current.saved));
  return { remainingAfter, shortfall, fromSaved, stillShort: shortfall - fromSaved };
}

// ---------------------------------------------------------------------------
// Household-level math: turns loaded BudgetData into the numbers pages show.
// ---------------------------------------------------------------------------

/** Account balance = opening balance + every non-voided transaction. Never stored. */
export function accountBalance(
  accountId: string,
  data: Pick<BudgetData, "accounts" | "transactions">,
): Cents {
  const account = data.accounts.find((a) => a.id === accountId);
  if (!account) throw new RangeError(`Unknown account ${accountId}`);
  let balance = account.openingBalance;
  for (const tx of data.transactions) {
    if (tx.accountId === accountId && !tx.voided) balance += tx.amount;
  }
  return balance;
}

/** Transactions that move budget money: non-voided, in an on-budget account. */
function budgetTransactions(data: BudgetData): Transaction[] {
  const onBudget = new Set(data.accounts.filter((a) => a.onBudget).map((a) => a.id));
  return data.transactions.filter((tx) => !tx.voided && onBudget.has(tx.accountId));
}

/** Each envelope's month-by-month history, built from stored months and spending. */
export function envelopeHistories(data: BudgetData): Map<string, EnvelopeMonth[]> {
  const inputs = new Map<string, Map<Month, EnvelopeMonthInput>>();
  const row = (envelopeId: string, month: Month) => {
    let months = inputs.get(envelopeId);
    if (!months) inputs.set(envelopeId, (months = new Map()));
    let input = months.get(month);
    if (!input) months.set(month, (input = { month, assigned: 0, released: 0, spent: 0 }));
    return input;
  };

  for (const record of data.envelopeMonths) {
    const input = row(record.envelopeId, record.month);
    input.assigned += record.assigned;
    input.released += record.released;
  }
  for (const tx of budgetTransactions(data)) {
    for (const allocation of tx.allocations) {
      row(allocation.envelopeId, monthOf(tx.date)).spent -= allocation.amount;
    }
  }

  const histories = new Map<string, EnvelopeMonth[]>();
  for (const envelope of data.envelopes) {
    histories.set(
      envelope.id,
      computeEnvelopeHistory([...(inputs.get(envelope.id)?.values() ?? [])]),
    );
  }
  return histories;
}

/**
 * Available to Assign for a month, from loaded data.
 * Income = uncategorized inflows; uncategorized outflows reduce it.
 * Transfers count as neither. Accounts count from their opening month.
 */
export function availableToAssignFor(data: BudgetData, month: Month): Cents {
  let openingBalances = 0;
  for (const account of data.accounts) {
    if (account.onBudget && monthOf(account.openingDate) <= month) {
      openingBalances += account.openingBalance;
    }
  }
  let income = 0;
  let uncategorizedSpent = 0;
  for (const tx of budgetTransactions(data)) {
    if (tx.isTransfer || tx.allocations.length > 0 || monthOf(tx.date) > month) continue;
    if (tx.amount > 0) income += tx.amount;
    else uncategorizedSpent -= tx.amount;
  }
  let assigned = 0;
  for (const record of data.envelopeMonths) {
    if (record.month <= month) assigned += record.assigned;
  }
  return availableToAssign({ openingBalances, income, assigned, uncategorizedSpent });
}

/** The latest month that has any data, or `atLeast` if that is later. */
function lastMonthWithData(data: BudgetData, atLeast: Month): Month {
  let last = atLeast;
  const consider = (month: Month) => {
    if (month > last) last = month;
  };
  data.envelopeMonths.forEach((r) => consider(r.month));
  data.transactions.forEach((tx) => consider(monthOf(tx.date)));
  data.accounts.forEach((a) => consider(monthOf(a.openingDate)));
  return last;
}

/**
 * How much can still be assigned in `month`. Assigning in a month lowers
 * Available to Assign for that month and every later one, so this is the
 * smallest of them (never below zero).
 */
export function assignableIn(data: BudgetData, month: Month): Cents {
  const last = lastMonthWithData(data, month);
  let lowest = availableToAssignFor(data, month);
  for (let m = addMonths(month, 1); m <= last; m = addMonths(m, 1)) {
    lowest = Math.min(lowest, availableToAssignFor(data, m));
  }
  return Math.max(0, lowest);
}

export interface EnvelopeRow extends EnvelopeMonth {
  id: string;
  name: string;
  planned: Cents;
  /** Whether the envelope belongs on this month's page (see envelopeInUse). */
  inUse: boolean;
}

export interface GroupRows {
  id: string;
  name: string;
  envelopes: EnvelopeRow[];
}

export interface BudgetMonthView {
  month: Month;
  availableToAssign: Cents;
  overAssigned: Cents;
  /** What the Assign action may add this month (see assignableIn). */
  assignable: Cents;
  totals: { planned: Cents; assigned: Cents; spent: Cents; remaining: Cents; saved: Cents };
  /** Every group and envelope; use visibleGroups for what to show. */
  groups: GroupRows[];
  /** Envelopes not in use this month. */
  unusedCount: number;
}

/**
 * Each month shows only the envelopes it uses, so months can have different
 * sets. An envelope is in use in a month when any of these is true:
 * - it has a stored record for the month (planned, assigned, released, or a
 *   plan import, even of $0);
 * - money was spent from it that month;
 * - it holds money (Saved or Remaining is not zero), so money is never hidden;
 * - it has never been used in any month (a new envelope stays visible).
 */
export function envelopeInUse(
  state: EnvelopeMonth,
  facts: { hasRecordThisMonth: boolean; everUsed: boolean },
): boolean {
  return (
    facts.hasRecordThisMonth ||
    !facts.everUsed ||
    state.spent !== 0 ||
    state.savedAtStart !== 0 ||
    state.saved !== 0 ||
    state.remaining !== 0
  );
}

/**
 * The groups to show: envelopes not in use are left out unless `showAll`.
 * A group stays when it has an envelope to show or has no envelopes yet.
 */
export function visibleGroups(view: BudgetMonthView, showAll: boolean): GroupRows[] {
  if (showAll) return view.groups;
  return view.groups
    .map((group) => ({ ...group, envelopes: group.envelopes.filter((e) => e.inUse) }))
    .filter((group, i) => group.envelopes.length > 0 || view.groups[i]!.envelopes.length === 0);
}

const byPosition = <T extends { position: number; name: string }>(a: T, b: T) =>
  a.position - b.position || a.name.localeCompare(b.name);

/** Everything the Budget page shows for one month. */
export function buildBudgetMonth(data: BudgetData, month: Month): BudgetMonthView {
  const histories = envelopeHistories(data);
  const planned = new Map(
    data.envelopeMonths.filter((r) => r.month === month).map((r) => [r.envelopeId, r.planned]),
  );
  const used = new Set(data.envelopeMonths.map((r) => r.envelopeId));
  for (const tx of data.transactions) tx.allocations.forEach((a) => used.add(a.envelopeId));
  const totals = { planned: 0, assigned: 0, spent: 0, remaining: 0, saved: 0 };
  let unusedCount = 0;

  const rowFor = (envelope: Envelope): EnvelopeRow => {
    const state = envelopeAsOf(histories.get(envelope.id) ?? [], month);
    const inUse = envelopeInUse(state, {
      hasRecordThisMonth: planned.has(envelope.id),
      everUsed: used.has(envelope.id),
    });
    if (!inUse) unusedCount++;
    const row = {
      ...state,
      id: envelope.id,
      name: envelope.name,
      planned: planned.get(envelope.id) ?? 0,
      inUse,
    };
    totals.planned += row.planned;
    totals.assigned += row.assigned;
    totals.spent += row.spent;
    totals.remaining += row.remaining;
    totals.saved += row.saved;
    return row;
  };

  const groups = [...data.groups].sort(byPosition).map((group) => ({
    id: group.id,
    name: group.name,
    envelopes: data.envelopes
      .filter((e) => e.groupId === group.id)
      .sort(byPosition)
      .map(rowFor),
  }));

  const available = availableToAssignFor(data, month);
  return {
    month,
    availableToAssign: available,
    overAssigned: overAssigned(available),
    assignable: assignableIn(data, month),
    totals,
    groups,
    unusedCount,
  };
}

/** A transaction about to be saved, as the shortfall check needs it. */
export interface PendingTransaction {
  /** Set when editing, so the old version is not counted twice. */
  id?: string;
  date: string;
  amount: Cents;
  envelopeId: string | null;
}

/**
 * Checks whether saving a transaction into an envelope would push that
 * envelope's Remaining below zero in the transaction's month. Returns null
 * for an uncategorized transaction.
 */
export function checkTransactionSpend(
  data: BudgetData,
  pending: PendingTransaction,
): SpendCheck | null {
  if (!pending.envelopeId) return null;
  const without = { ...data, transactions: data.transactions.filter((tx) => tx.id !== pending.id) };
  const history = envelopeHistories(without).get(pending.envelopeId) ?? [];
  return checkSpend(envelopeAsOf(history, monthOf(pending.date)), -pending.amount);
}

/** Envelopes that could give `amount` in `month` without going negative (cover step 2). */
export function coverSources(
  view: BudgetMonthView,
  excludeId: string,
  amount: Cents,
): EnvelopeRow[] {
  return view.groups
    .flatMap((g) => g.envelopes)
    .filter((e) => e.id !== excludeId && e.remaining >= amount);
}
