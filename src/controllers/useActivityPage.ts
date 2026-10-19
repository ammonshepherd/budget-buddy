import { useMemo, useState } from "react";
import {
  activityAccounts,
  activityBalance,
  activityMonth,
  selectionTotal,
} from "../models/activity";
import { isToReview, transactionsToReview } from "../models/budgetMath";
import { inflowsMatchingRules } from "../models/incomeRules";
import { addMonths, formatMonth, todayIso, type Month } from "../models/month";
import { activityHref } from "../models/routes";
import type { BudgetData, Transaction } from "../models/types";
import type { Budget } from "./useBudget";

const NOTHING: ReadonlySet<string> = new Set();

/**
 * The Activity page for one month: its transactions by day with the month's
 * totals and today's balance, the transactions still to review (from any
 * month), plus delete, "Mark as Income", and ticking rows to mark them
 * reconciled with the bank. With `selectedAccountId`, all of it is narrowed
 * to that account. Adding and editing go through useTransactionEntry.
 */
export function useActivityPage(
  budget: Budget,
  data: BudgetData,
  month: Month,
  selectedAccountId: string | null,
) {
  const accounts = useMemo(() => activityAccounts(data), [data]);
  // An account no longer offered (say, taken off budget) means all accounts.
  const accountId = accounts.some((a) => a.id === selectedAccountId) ? selectedAccountId : null;
  const accountNames = useMemo(() => new Map(data.accounts.map((a) => [a.id, a.name])), [data]);
  const cards = new Set(data.accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  const reviewRow = (tx: Transaction) => ({
    tx,
    accountName: accountNames.get(tx.accountId) ?? "Unknown account",
    /** An inflow outside a credit card: one tap can mark it Income. */
    canBeIncome: tx.amount > 0 && !cards.has(tx.accountId) && isToReview(tx, false),
  });
  const activity = useMemo(() => activityMonth(data, month, accountId), [data, month, accountId]);
  const balance = useMemo(() => activityBalance(data, accountId, todayIso()), [data, accountId]);
  const review = transactionsToReview(data, accountId);

  // Ticked rows, by transaction id. They belong to one month and account:
  // changing either starts empty, so nothing ticked is ever out of sight.
  const view = `${month}|${accountId ?? ""}`;
  const [ticked, setTicked] = useState({ view, ids: NOTHING });
  const rows = activity.days.flatMap((day) => day.rows);
  const selected = new Set(
    ticked.view === view ? rows.filter((r) => ticked.ids.has(r.tx.id)).map((r) => r.tx.id) : [],
  );
  const selectedRows = rows.filter((r) => selected.has(r.tx.id));
  const clearSelection = () => setTicked({ view, ids: NOTHING });

  return {
    monthLabel: formatMonth(month),
    /** Budget accounts to narrow the page to, and the one chosen (null: all). */
    accounts,
    accountId,
    accountName: accounts.find((a) => a.id === accountId)?.name ?? null,
    previousHref: activityHref(addMonths(month, -1)),
    nextHref: activityHref(addMonths(month, 1)),
    /** Money in and out this month (display only). */
    totals: activity.totals,
    /** Today's balance (whatever month is shown), reconciled balance, cash and card debt. */
    balance,
    /** This month's transactions by day, newest day first. */
    days: activity.days,
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
