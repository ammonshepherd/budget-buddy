/**
 * The Activity page's month: every transaction dated in it, across budget
 * accounts, grouped by day, plus the month's money in and out, today's
 * balance, and the total of the rows ticked for reconciling. These are
 * display figures for this page only; they are not Available to Assign.
 */
import { accountBalance, isCardCredit, isToReview } from "./budgetMath";
import type { Cents } from "./money";
import { monthOf, type Month } from "./month";
import { transferPartner } from "./transfers";
import type { BudgetData, IsoDate, Transaction } from "./types";

/** How a row's amount is shown: outflows with −, inflows green with +, transfers grey. */
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
  /** Signed for "out" and "in"; a transfer's amount is positive. */
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
 * The transactions Activity shows: not voided, in a budget account. A
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

/** An account Activity can be narrowed to. */
export interface ActivityAccount {
  id: string;
  name: string;
  closed: boolean;
}

/** The budget accounts to pick from: open ones first, then closed, each by name. */
export function activityAccounts(data: BudgetData): ActivityAccount[] {
  return data.accounts
    .filter((a) => a.onBudget)
    .map((a) => ({ id: a.id, name: a.name, closed: a.closedAt !== null }))
    .sort((a, b) => Number(a.closed) - Number(b.closed) || a.name.localeCompare(b.name));
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
      amount: Math.abs(tx.amount),
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
 * Activity for month M: rows by day (by transaction date) and the month's
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
