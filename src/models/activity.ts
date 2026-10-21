/**
 * The Accounts page's transaction lists. All accounts: every transaction
 * dated in one month, across budget accounts, grouped by day, plus the
 * month's money in and out and today's balance. One account open: all its
 * transactions, any month, plus its info pane figures. Both are shown 100
 * rows at a time, and ticked rows add up for reconciling. These are display
 * figures for this page only; they are not Available to Assign.
 */
import { accountBalance, isCardCredit, isToReview } from "./budgetMath";
import type { Cents } from "./money";
import { monthOf, type Month } from "./month";
import { transferPartner } from "./transfers";
import type { BudgetData, IsoDate, Transaction } from "./types";

/** What a row is; its amount shows red with − when negative, green with + when positive. */
export type ActivityKind = "out" | "in" | "transfer";

/** One envelope's part of a split. */
export interface ActivityPortion {
  envelopeId: string;
  envelopeName: string;
  amount: Cents;
}

export interface ActivityRow {
  /** The transaction the row edits (a transfer's money-out side). */
  tx: Transaction;
  kind: ActivityKind;
  /**
   * Signed. A transfer's is its side in the account shown, or on "All
   * accounts" the side it is shown by (money out, so negative, unless the
   * other account is off budget).
   */
  amount: Cents;
  /** The account, or "From → To" for a transfer. */
  accountLine: string;
  /** Envelope name, "Income", "Transfer", "Card credit" or "Uncategorized"; empty for a split. */
  category: string;
  /** Still to review: it counts toward nothing until it is decided. */
  toReview: boolean;
  /** A split's parts (two or more); empty otherwise. */
  portions: ActivityPortion[];
  /**
   * The transactions the row stands for when it is ticked: the transaction
   * itself, or for a transfer the side in the account shown (both sides on
   * "All accounts").
   */
  sideIds: string[];
  /** Those sides' amounts added up, signed (a transfer on "All accounts": $0.00). */
  sideAmount: Cents;
  /** Every side is marked reconciled with the bank. */
  reconciled: boolean;
}

export interface ActivityDay {
  date: IsoDate;
  /** The day's amounts added up, signed; transfers only count in one account's view. */
  net: Cents;
  rows: ActivityRow[];
}

/**
 * Money in and out (both positive). On "All accounts" transfers are left out
 * (their sides cancel); in one account's view they count like the bank
 * statement shows them, so In − Out is the change in that account's balance.
 */
export interface ActivityTotals {
  /** Inflows: income, refunds, card credits (and transfers in, for one account). */
  moneyIn: Cents;
  /** Outflows: spending, card purchases (and transfers out, for one account). */
  moneyOut: Cents;
}

export interface ActivityMonth {
  totals: ActivityTotals;
  /** Newest day first; within a day, in the order the data lists them (newest first). */
  days: ActivityDay[];
}

/**
 * The transactions All accounts shows: not voided, in a budget account. A
 * transfer is shown once, by its money-out side (its money-in side when the
 * other account is off budget).
 */
function shownTransactions(data: BudgetData): Transaction[] {
  const onBudget = new Set(data.accounts.filter((a) => a.onBudget).map((a) => a.id));
  return data.transactions.filter((tx) => {
    if (tx.voided || !onBudget.has(tx.accountId)) return false;
    if (!tx.isTransfer || tx.amount < 0) return true;
    const partner = transferPartner(data, tx);
    return !partner || partner.voided || !onBudget.has(partner.accountId);
  });
}

/** Whether a shown transaction belongs to the account (a transfer: either side). */
function inAccount(data: BudgetData, tx: Transaction, accountId: string): boolean {
  if (tx.accountId === accountId) return true;
  return tx.isTransfer && transferPartner(data, tx)?.accountId === accountId;
}

/**
 * What ticking a row means: the transaction, or a transfer's side in the
 * account shown (both shown sides on "All accounts").
 */
function rowSides(data: BudgetData, tx: Transaction, accountId: string | null) {
  const partner = tx.isTransfer ? transferPartner(data, tx) : undefined;
  const onBudget = (t: Transaction) =>
    !t.voided && data.accounts.some((a) => a.id === t.accountId && a.onBudget);
  const all = partner && onBudget(partner) ? [tx, partner] : [tx];
  const sides = accountId === null ? all : all.filter((t) => t.accountId === accountId);
  return {
    sideIds: sides.map((t) => t.id),
    sideAmount: sides.reduce((sum, t) => sum + t.amount, 0),
    reconciled: sides.every((t) => t.reconciled),
  };
}

function activityRow(data: BudgetData, tx: Transaction, accountId: string | null): ActivityRow {
  const account = (id: string) => data.accounts.find((a) => a.id === id);
  const accountName = account(tx.accountId)?.name ?? "Unknown account";
  const envelopeName = (id: string) =>
    data.envelopes.find((e) => e.id === id)?.name ?? "Unknown envelope";
  const onCard = account(tx.accountId)?.type === "credit_card";
  const base = {
    tx,
    toReview: false,
    portions: [] as ActivityPortion[],
    ...rowSides(data, tx, accountId),
  };

  if (tx.isTransfer) {
    const partner = transferPartner(data, tx);
    const other = partner ? (account(partner.accountId)?.name ?? "Unknown account") : null;
    const [from, to] = tx.amount < 0 ? [accountName, other] : [other, accountName];
    return {
      ...base,
      kind: "transfer",
      amount: accountId === null ? tx.amount : base.sideAmount,
      accountLine: other ? `${from} → ${to}` : accountName,
      category: "Transfer",
    };
  }

  const portions =
    tx.allocations.length > 1
      ? tx.allocations.map((a) => ({
          envelopeId: a.envelopeId,
          envelopeName: envelopeName(a.envelopeId),
          amount: a.amount,
        }))
      : [];
  const category = tx.isIncome
    ? "Income"
    : isCardCredit(tx, onCard)
      ? "Card credit"
      : tx.allocations.length === 0
        ? "Uncategorized"
        : portions.length > 0
          ? ""
          : envelopeName(tx.allocations[0]!.envelopeId);
  return {
    ...base,
    kind: tx.amount > 0 ? "in" : "out",
    amount: tx.amount,
    accountLine: accountName,
    category,
    toReview: isToReview(tx, onCard),
    portions,
  };
}

/**
 * All accounts for month M: rows by day (by transaction date) and the month's
 * totals; with `accountId`, only that account's transactions (and transfers
 * to or from it, which then count in the totals and day nets).
 */
export function activityMonth(
  data: BudgetData,
  month: Month,
  accountId: string | null = null,
): ActivityMonth {
  const totals: ActivityTotals = { moneyIn: 0, moneyOut: 0 };
  const days: ActivityDay[] = [];
  const byDate = new Map<IsoDate, ActivityDay>();

  for (const tx of shownTransactions(data)) {
    if (monthOf(tx.date) !== month) continue;
    if (accountId !== null && !inAccount(data, tx, accountId)) continue;
    const row = activityRow(data, tx, accountId);
    let day = byDate.get(tx.date);
    if (!day) {
      day = { date: tx.date, net: 0, rows: [] };
      byDate.set(tx.date, day);
      days.push(day);
    }
    day.rows.push(row);
    // On "All accounts" a transfer's sides cancel: sideAmount is 0.
    const amount = row.kind === "transfer" ? row.sideAmount : row.amount;
    day.net += amount;
    if (amount > 0) totals.moneyIn += amount;
    else totals.moneyOut -= amount;
  }

  days.sort((a, b) => b.date.localeCompare(a.date));
  return { totals, days };
}

/** The total of the ticked rows (by transaction id), signed. */
export function selectionTotal(rows: ActivityRow[], selected: ReadonlySet<string>): Cents {
  return rows.reduce((sum, row) => (selected.has(row.tx.id) ? sum + row.sideAmount : sum), 0);
}

export interface ActivityBalance {
  /** Opening balances plus every transaction dated today or earlier. */
  today: Cents;
  /** Opening balances plus reconciled transactions only: what the bank should show. */
  reconciled: Cents;
  /** Today's balance of the accounts that are not credit cards. */
  cash: Cents;
  /** What the credit cards owe today (positive when owed). */
  cardsOwe: Cents;
  /** A credit card is among the accounts counted. */
  hasCards: boolean;
}

/**
 * Today's balance of one budget account, or of all of them (cards included,
 * so it is cash minus card debt and can be negative). Not tied to the month
 * shown: it is for checking the app against the bank.
 */
export function activityBalance(
  data: BudgetData,
  accountId: string | null,
  today: IsoDate,
): ActivityBalance {
  const accounts = data.accounts.filter(
    (a) => a.onBudget && (accountId === null || a.id === accountId),
  );
  const balance: ActivityBalance = {
    today: 0,
    reconciled: 0,
    cash: 0,
    cardsOwe: 0,
    hasCards: false,
  };
  for (const account of accounts) {
    const now = accountBalance(account.id, data, { through: today });
    balance.today += now;
    balance.reconciled += accountBalance(account.id, data, { reconciled: true });
    if (account.type === "credit_card") {
      balance.cardsOwe -= now;
      balance.hasCards = true;
    } else balance.cash += now;
  }
  return balance;
}

// ---------------------------------------------------------------------------
// The Accounts page: one account open, and lists shown 100 rows at a time.
// ---------------------------------------------------------------------------

/** The figures on an open account's info pane (display only). */
export interface AccountFigures {
  /** Opening balance plus every transaction, whatever its date (as the accounts list shows). */
  current: Cents;
  /** The balance at the start of the month: every transaction dated before its first day. */
  monthStart: Cents;
  /** The balance on the opening date, as entered (signed: a card owing $50 is −$50.00). */
  opening: Cents;
  /** Opening balance plus the transactions marked reconciled. */
  reconciled: Cents;
  /** The month's inflows, transfers left out: income, refunds, card credits, inflows to review. */
  moneyIn: Cents;
  /** The month's outflows, transfers left out: spending and card purchases (positive). */
  moneyOut: Cents;
}

/**
 * One account's figures for month M. Transfers (card payments too) are left
 * out of money in and out; a split counts once, at its full amount.
 */
export function accountFigures(data: BudgetData, accountId: string, month: Month): AccountFigures {
  const account = data.accounts.find((a) => a.id === accountId);
  if (!account) throw new RangeError(`Unknown account ${accountId}`);
  let moneyIn = 0;
  let moneyOut = 0;
  for (const tx of data.transactions) {
    if (tx.accountId !== accountId || tx.voided || tx.isTransfer) continue;
    if (monthOf(tx.date) !== month) continue;
    if (tx.amount > 0) moneyIn += tx.amount;
    else moneyOut -= tx.amount;
  }
  return {
    current: accountBalance(accountId, data),
    monthStart: accountBalance(accountId, data, { before: `${month}-01` }),
    opening: account.openingBalance,
    reconciled: accountBalance(accountId, data, { reconciled: true }),
    moneyIn,
    moneyOut,
  };
}

/**
 * Every transaction of one account, any month, by day (newest first). A
 * transfer shows once, by its money-out side, with its amount in this
 * account. Day nets leave transfers out, like the account's money in and out.
 */
export function accountHistory(data: BudgetData, accountId: string): ActivityDay[] {
  const days: ActivityDay[] = [];
  const byDate = new Map<IsoDate, ActivityDay>();
  for (const own of data.transactions) {
    if (own.accountId !== accountId || own.voided) continue;
    // A transfer's row edits its money-out side, as on All accounts.
    const partner = own.isTransfer && own.amount > 0 ? transferPartner(data, own) : undefined;
    const tx = partner && !partner.voided ? partner : own;
    const row = activityRow(data, tx, accountId);
    let day = byDate.get(own.date);
    if (!day) {
      day = { date: own.date, net: 0, rows: [] };
      byDate.set(own.date, day);
      days.push(day);
    }
    day.rows.push(row);
    if (row.kind !== "transfer") day.net += row.amount;
  }
  return days.sort((a, b) => b.date.localeCompare(a.date));
}

/** Some of a list's days: the first `limit` rows, a day cut short keeping its full net. */
export interface DaysPage {
  days: ActivityDay[];
  /** Rows shown. */
  shown: number;
  /** Rows in the whole list. */
  total: number;
}

/**
 * The first `limit` rows of a list of days, for showing 100 at a time. A
 * split is one row, so its parts always come with it; a day cut short keeps
 * its heading and full net, and the next page continues under it.
 */
export function firstRows(days: ActivityDay[], limit: number): DaysPage {
  const total = days.reduce((sum, day) => sum + day.rows.length, 0);
  const shownDays: ActivityDay[] = [];
  let shown = 0;
  for (const day of days) {
    if (shown >= limit) break;
    const rows = day.rows.slice(0, limit - shown);
    shownDays.push(rows.length === day.rows.length ? day : { ...day, rows });
    shown += rows.length;
  }
  return { days: shownDays, shown, total };
}

/** Days under their month, newest first: an open account's list crosses months. */
export function daysByMonth(days: ActivityDay[]): { month: Month; days: ActivityDay[] }[] {
  const months: { month: Month; days: ActivityDay[] }[] = [];
  for (const day of days) {
    const month = monthOf(day.date);
    const last = months[months.length - 1];
    if (last?.month === month) last.days.push(day);
    else months.push({ month, days: [day] });
  }
  return months;
}
