import { useMemo } from "react";
import { isInflowToReview } from "../models/budgetMath";
import { inflowsMatchingRules } from "../models/incomeRules";
import { formatDay } from "../models/month";
import { transferPartner } from "../models/transfers";
import type { BudgetData, Transaction } from "../models/types";
import type { Budget } from "./useBudget";

/**
 * The Activity page: every transaction with its account and envelopes, the
 * inflows still to review, plus delete and "Mark as Income". Adding and
 * editing go through useTransactionEntry.
 */
export function useActivityPage(budget: Budget, data: BudgetData) {
  const accountNames = useMemo(() => new Map(data.accounts.map((a) => [a.id, a.name])), [data]);
  const envelopeNames = useMemo(() => new Map(data.envelopes.map((e) => [e.id, e.name])), [data]);
  const transferLabel = (tx: Transaction) => {
    const other = transferPartner(data, tx);
    const name = other ? (accountNames.get(other.accountId) ?? "another account") : "";
    return other ? `Transfer ${tx.amount < 0 ? "to" : "from"} ${name}` : "Transfer";
  };
  const category = (tx: Transaction) =>
    tx.isTransfer
      ? transferLabel(tx)
      : tx.isIncome
        ? "Income"
        : tx.allocations.length === 0
          ? "Uncategorized"
          : tx.allocations.map((a) => envelopeNames.get(a.envelopeId) ?? "Unknown").join(", ");
  const row = (tx: Transaction) => ({
    tx,
    accountName: accountNames.get(tx.accountId) ?? "Unknown account",
    category: category(tx),
    /** No envelope, not income and not a transfer: highlighted so it gets one. */
    uncategorized: !tx.isTransfer && !tx.isIncome && tx.allocations.length === 0,
  });
  const rows = data.transactions.map(row);
  // Transactions come newest first, so each date's group is contiguous.
  const days: { date: string; label: string; rows: typeof rows }[] = [];
  for (const r of rows) {
    const last = days.at(-1);
    if (last?.date === r.tx.date) last.rows.push(r);
    else days.push({ date: r.tx.date, label: formatDay(r.tx.date), rows: [r] });
  }
  const onBudget = new Set(data.accounts.filter((a) => a.onBudget).map((a) => a.id));
  const toReview = data.transactions.filter(
    (tx) => onBudget.has(tx.accountId) && isInflowToReview(tx),
  );

  return {
    rows,
    /** Transactions under date headings, newest date first. */
    days,
    /** Uncategorized inflows: not in Available to Assign until marked Income (or given an envelope). */
    toReview: toReview.map(row),
    toReviewTotal: toReview.reduce((sum, tx) => sum + tx.amount, 0),
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
