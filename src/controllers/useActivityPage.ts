import { useMemo } from "react";
import { isCardCredit, isToReview, transactionsToReview } from "../models/budgetMath";
import { inflowsMatchingRules } from "../models/incomeRules";
import { formatDay } from "../models/month";
import { transferPartner } from "../models/transfers";
import type { BudgetData, Transaction } from "../models/types";
import type { Budget } from "./useBudget";

/**
 * The Activity page: every transaction with its account and envelopes, the
 * transactions still to review, plus delete and "Mark as Income". Adding and
 * editing go through useTransactionEntry.
 */
export function useActivityPage(budget: Budget, data: BudgetData) {
  const accountNames = useMemo(() => new Map(data.accounts.map((a) => [a.id, a.name])), [data]);
  const envelopeNames = useMemo(() => new Map(data.envelopes.map((e) => [e.id, e.name])), [data]);
  const cards = new Set(data.accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  const onCard = (tx: Transaction) => cards.has(tx.accountId);
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
        : isCardCredit(tx, onCard(tx))
          ? "Card credit"
          : tx.allocations.length === 0
            ? "Uncategorized"
            : tx.allocations.map((a) => envelopeNames.get(a.envelopeId) ?? "Unknown").join(", ");
  const row = (tx: Transaction) => ({
    tx,
    accountName: accountNames.get(tx.accountId) ?? "Unknown account",
    category: category(tx),
    /** Still to review: highlighted so it gets an envelope (or Income, or Transfer). */
    uncategorized: isToReview(tx, onCard(tx)),
    /** An inflow outside a credit card: one tap can mark it Income. */
    canBeIncome: tx.amount > 0 && !onCard(tx) && isToReview(tx, false),
  });
  const rows = data.transactions.map(row);
  // Transactions come newest first, so each date's group is contiguous.
  const days: { date: string; label: string; rows: typeof rows }[] = [];
  for (const r of rows) {
    const last = days.at(-1);
    if (last?.date === r.tx.date) last.rows.push(r);
    else days.push({ date: r.tx.date, label: formatDay(r.tx.date), rows: [r] });
  }
  const review = transactionsToReview(data);

  return {
    rows,
    /** Transactions under date headings, newest date first. */
    days,
    /** Uncategorized transactions: they count toward nothing until they are decided. */
    toReview: review.list.map(row),
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
