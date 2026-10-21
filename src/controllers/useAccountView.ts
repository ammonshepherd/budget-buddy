import { useMemo, useState } from "react";
import {
  accountFigures,
  accountHistory,
  activityBalance,
  activityMonth,
  daysByMonth,
  firstRows,
  selectionTotal,
} from "../models/activity";
import { isToReview, transactionsToReview } from "../models/budgetMath";
import { inflowsMatchingRules } from "../models/incomeRules";
import { addMonths, formatMonth, todayIso, type Month } from "../models/month";
import { accountsHref } from "../models/routes";
import type { BudgetData, Transaction } from "../models/types";
import type { Budget } from "./useBudget";

const NOTHING: ReadonlySet<string> = new Set();

/** Rows shown at first, and added by each "Show more". */
export const ROWS_PER_PAGE = 100;

/**
 * What the Accounts page shows with something open. All accounts (the old
 * Activity page): one month's transactions by day, its totals and today's
 * balance. One account: all its transactions, any month, under month
 * dividers, plus its info pane figures for the month. Either way: the
 * transactions still to review (from any month), "Mark as Income", rows
 * shown 100 at a time, and ticking rows to mark them reconciled with the
 * bank. Adding and editing go through useTransactionEntry.
 */
export function useAccountView(
  budget: Budget,
  data: BudgetData,
  month: Month,
  /** The open account's id; null for All accounts. */
  accountId: string | null,
) {
  const account = data.accounts.find((a) => a.id === accountId) ?? null;
  const accountNames = useMemo(() => new Map(data.accounts.map((a) => [a.id, a.name])), [data]);
  const cards = new Set(data.accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  const reviewRow = (tx: Transaction) => ({
    tx,
    accountName: accountNames.get(tx.accountId) ?? "Unknown account",
    /** An inflow outside a credit card: one tap can mark it Income. */
    canBeIncome: tx.amount > 0 && !cards.has(tx.accountId) && isToReview(tx, false),
  });

  // All accounts follows the month; an open account lists every month.
  const allDays = useMemo(
    () => (accountId === null ? activityMonth(data, month).days : accountHistory(data, accountId)),
    [data, month, accountId],
  );
  const monthTotals = useMemo(() => activityMonth(data, month).totals, [data, month]);
  const balance = useMemo(() => activityBalance(data, null, todayIso()), [data]);
  const figures = useMemo(
    () => (account ? accountFigures(data, account.id, month) : null),
    [data, account, month],
  );
  const review = transactionsToReview(data, accountId);

  // Rows shown: 100, then 100 more each time. Edits keep what is loaded.
  const [limit, setLimit] = useState(ROWS_PER_PAGE);
  const page = useMemo(() => firstRows(allDays, limit), [allDays, limit]);

  // Ticked rows, by transaction id. They belong to what is open (and on All
  // accounts to the month): changing it starts empty, so nothing ticked is
  // ever out of sight.
  const view = accountId ?? `all|${month}`;
  const [ticked, setTicked] = useState({ view, ids: NOTHING });
  const rows = page.days.flatMap((day) => day.rows);
  const selected = new Set(
    ticked.view === view ? rows.filter((r) => ticked.ids.has(r.tx.id)).map((r) => r.tx.id) : [],
  );
  const selectedRows = rows.filter((r) => selected.has(r.tx.id));
  const clearSelection = () => setTicked({ view, ids: NOTHING });

  return {
    monthLabel: formatMonth(month),
    previousHref: accountsHref(accountId ?? "all", addMonths(month, -1)),
    nextHref: accountsHref(accountId ?? "all", addMonths(month, 1)),
    /** The open account (null: All accounts). */
    account,
    /** All accounts: the month's money in and out, and today's balance (display only). */
    totals: monthTotals,
    balance,
    /** An open account's info pane figures; the month ones follow the month picked. */
    figures,
    /** The rows shown so far, by day (and by month for an open account), newest first. */
    days: page.days,
    months: daysByMonth(page.days),
    shownCount: page.shown,
    /** Rows not shown yet. */
    leftCount: page.total - page.shown,
    showMore: () => setLimit((n) => n + ROWS_PER_PAGE),
    /** Uncategorized transactions from any month: they count toward nothing until decided. */
    toReview: review.list.map(reviewRow),
    toReviewIn: review.inflow,
    toReviewOut: review.outflow,
    /** Inflows to review that an income rule matches (see Settings → Income rules). */
    ruleMatches: inflowsMatchingRules(data)
      .filter((tx) => accountId === null || tx.accountId === accountId)
      .map((tx) => tx.id),
    hasOpenAccounts: data.accounts.some((a) => !a.closedAt),

    /** Ticked rows (by transaction id), their count and their total, signed. */
    selected: selected as ReadonlySet<string>,
    selectedCount: selectedRows.length,
    selectedTotal: selectionTotal(rows, selected),
    /** Whether some ticked row is not reconciled yet / already is. */
    canReconcile: selectedRows.some((r) => !r.reconciled),
    canUnreconcile: selectedRows.some((r) => r.reconciled),
    toggleSelected: (id: string) => {
      const ids = new Set(selected);
      if (!ids.delete(id)) ids.add(id);
      setTicked({ view, ids });
    },
    clearSelection,
    /** Marks the ticked rows reconciled with the bank (or not), then unticks them. */
    setReconciled: async (reconciled: boolean) => {
      const ids = selectedRows.flatMap((r) => r.sideIds);
      const marked = new Set(ids);
      await budget.change(
        async (store) => {
          await store.setReconciled(ids, reconciled);
        },
        (d) => ({
          ...d,
          transactions: d.transactions.map((t) => (marked.has(t.id) ? { ...t, reconciled } : t)),
        }),
      );
      clearSelection();
    },

    deleteTransaction: async (id: string) => {
      await budget.change((store) => store.deleteTransaction(id));
    },

    /** Marks these inflows as Income, so they count toward Available to Assign. */
    markIncome: async (ids: string[]) => {
      await budget.change(async (store) => {
        await store.markIncome(ids);
      });
    },
  };
}
