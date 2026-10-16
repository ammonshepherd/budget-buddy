/**
 * The Activity page's month: every transaction dated in it, across budget
 * accounts, grouped by day, plus the month's money in, out and transferred.
 * These are display figures for this page only; they are not Available to
 * Assign or account balances.
 */
import { isCardCredit, isToReview } from "./budgetMath";
import type { Cents } from "./money";
import { monthOf, type Month } from "./month";
import { transferPartner } from "./transfers";
import type { BudgetData, IsoDate, Transaction } from "./types";

/** How a row's amount is shown: outflows with −, inflows green with +, transfers grey. */
export type ActivityKind = "out" | "in" | "transfer";

/**
 * Whether the bank has seen it. There is no stored status yet: imported rows
 * came from the bank (cleared), typed ones have not (uncleared). Reconciled
 * waits for reconciliation.
 */
export type ClearedStatus = "uncleared" | "cleared" | "reconciled";

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
  status: ClearedStatus;
}

export interface ActivityDay {
  date: IsoDate;
  /** The day's non-transfer amounts added up, signed. */
  net: Cents;
  rows: ActivityRow[];
}

export interface ActivityTotals {
  /** Non-transfer inflows: income, refunds and card credits (positive). */
  moneyIn: Cents;
  /** Non-transfer outflows: spending and card purchases (positive). */
  moneyOut: Cents;
  /** Transfers (card payments included), each counted once (positive). */
  transfers: Cents;
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

function activityRow(data: BudgetData, tx: Transaction): ActivityRow {
  const account = (id: string) => data.accounts.find((a) => a.id === id);
  const accountName = account(tx.accountId)?.name ?? "Unknown account";
  const envelopeName = (id: string) =>
    data.envelopes.find((e) => e.id === id)?.name ?? "Unknown envelope";
  const onCard = account(tx.accountId)?.type === "credit_card";
  const status: ClearedStatus = tx.importKey ? "cleared" : "uncleared";
  const base = { tx, status, toReview: false, portions: [] as ActivityPortion[] };

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
 * to or from it), totals included.
 */
export function activityMonth(
  data: BudgetData,
  month: Month,
  accountId: string | null = null,
): ActivityMonth {
  const totals: ActivityTotals = { moneyIn: 0, moneyOut: 0, transfers: 0 };
  const days: ActivityDay[] = [];
  const byDate = new Map<IsoDate, ActivityDay>();

  for (const tx of shownTransactions(data)) {
    if (monthOf(tx.date) !== month) continue;
    if (accountId !== null && !inAccount(data, tx, accountId)) continue;
    const row = activityRow(data, tx);
    let day = byDate.get(tx.date);
    if (!day) {
      day = { date: tx.date, net: 0, rows: [] };
      byDate.set(tx.date, day);
      days.push(day);
    }
    day.rows.push(row);
    if (row.kind === "transfer") totals.transfers += row.amount;
    else {
      day.net += row.amount;
      if (row.amount > 0) totals.moneyIn += row.amount;
      else totals.moneyOut -= row.amount;
    }
  }

  days.sort((a, b) => b.date.localeCompare(a.date));
  return { totals, days };
}
