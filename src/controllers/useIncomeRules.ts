import { inflowsMatchingRules, readIncomeRule } from "../models/incomeRules";
import type { BudgetData } from "../models/types";
import type { Budget } from "./useBudget";

/** Settings → Income rules: list, add and delete rules, and apply them to inflows to review. */
export function useIncomeRules(budget: Budget, data: BudgetData) {
  const accountNames = new Map(data.accounts.map((a) => [a.id, a.name]));
  const matching = inflowsMatchingRules(data);

  return {
    rules: data.incomeRules.map((rule) => ({
      ...rule,
      accountName: rule.accountId
        ? (accountNames.get(rule.accountId) ?? "Unknown account")
        : "Any account",
    })),
    accounts: data.accounts.filter((a) => !a.closedAt),
    /** How many inflows waiting for review the rules would mark as Income. */
    matchingCount: matching.length,

    /** accountId "" = any account. */
    addRule: async (pattern: string, accountId: string) => {
      const rule = readIncomeRule(pattern, accountId || null);
      await budget.change((store) => store.addIncomeRule(data.household.id, rule));
    },

    deleteRule: async (ruleId: string) => {
      await budget.change((store) => store.deleteIncomeRule(ruleId));
    },

    /** Marks every inflow to review that a rule matches as Income. */
    applyRules: async () => {
      const ids = matching.map((tx) => tx.id);
      if (ids.length === 0) return;
      await budget.change(async (store) => {
        await store.markIncome(ids);
      });
    },
  };
}
