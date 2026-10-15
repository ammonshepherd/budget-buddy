import { useMemo } from "react";
import { activityMonth } from "../models/activity";
import { isToReview, transactionsToReview } from "../models/budgetMath";
import { inflowsMatchingRules } from "../models/incomeRules";
import { addMonths, formatMonth, type Month } from "../models/month";
import { activityHref } from "../models/routes";
import type { BudgetData, Transaction } from "../models/types";
import type { Budget } from "./useBudget";

/**
 * The Activity page for one month: its transactions by day with the month's
 * totals, the transactions still to review (from any month), plus delete and
 * "Mark as Income". Adding and editing go through useTransactionEntry.
 */
export function useActivityPage(budget: Budget, data: BudgetData, month: Month) {
  const accountNames = useMemo(() => new Map(data.accounts.map((a) => [a.id, a.name])), [data]);
  const cards = new Set(data.accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  const reviewRow = (tx: Transaction) => ({
    tx,
    accountName: accountNames.get(tx.accountId) ?? "Unknown account",
    /** An inflow outside a credit card: one tap can mark it Income. */
    canBeIncome: tx.amount > 0 && !cards.has(tx.accountId) && isToReview(tx, false),
  });
  const activity = useMemo(() => activityMonth(data, month), [data, month]);
  const review = transactionsToReview(data);

  return {
    monthLabel: formatMonth(month),
    previousHref: activityHref(addMonths(month, -1)),
    nextHref: activityHref(addMonths(month, 1)),
    /** Money in, out and transferred this month (display only). */
    totals: activity.totals,
    /** This month's transactions by day, newest day first. */
    days: activity.days,
    /** Uncategorized transactions from any month: they count toward nothing until decided. */
    toReview: review.list.map(reviewRow),
    toReviewIn: review.inflow,
    toReviewOut: review.outflow,
    /** Inflows to review that an income rule matches (see Settings → Income rules). */
    ruleMatches: inflowsMatchingRules(data).map((tx) => tx.id),
    hasOpenAccounts: data.accounts.some((a) => !a.closedAt),

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
