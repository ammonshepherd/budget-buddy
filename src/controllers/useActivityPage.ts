import { useMemo } from "react";
import type { BudgetData } from "../models/types";
import type { Budget } from "./useBudget";

/**
 * The Activity page: every transaction with its account and envelopes, plus
 * delete. Adding and editing go through useTransactionEntry.
 */
export function useActivityPage(budget: Budget, data: BudgetData) {
  const accountNames = useMemo(() => new Map(data.accounts.map((a) => [a.id, a.name])), [data]);
  const envelopeNames = useMemo(() => new Map(data.envelopes.map((e) => [e.id, e.name])), [data]);

  return {
    rows: data.transactions.map((tx) => ({
      tx,
      accountName: accountNames.get(tx.accountId) ?? "Unknown account",
      category: tx.isTransfer
        ? "Transfer"
        : tx.allocations.length === 0
          ? "Uncategorized"
          : tx.allocations.map((a) => envelopeNames.get(a.envelopeId) ?? "Unknown").join(", "),
    })),
    hasOpenAccounts: data.accounts.some((a) => !a.closedAt),

    deleteTransaction: async (id: string) => {
      await budget.change((store) => store.deleteTransaction(id));
    },
  };
}
