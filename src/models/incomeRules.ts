/**
 * Income rules mark matching inflows as Income automatically: an inflow whose
 * description contains the rule's text (ignoring case and extra spaces),
 * optionally only in one account. Rules run when a CSV is imported, and on
 * request over the inflows waiting for review. Only inflows that are still
 * to review (not in an envelope, not a transfer) are ever marked.
 */
import { isToReview } from "./budgetMath";
import { UserFacingError } from "./dataStore";
import type { Cents } from "./money";
import type { BudgetData, Transaction } from "./types";

export interface IncomeRule {
  id: string;
  /** Text the description must contain, e.g. "PAYROLL". */
  pattern: string;
  /** Only this account; null = any account. */
  accountId: string | null;
}

export type NewIncomeRule = Omit<IncomeRule, "id">;

const normalize = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

/** Checks a rule as typed and returns what to save. */
export function readIncomeRule(pattern: string, accountId: string | null): NewIncomeRule {
  const text = pattern.trim().replace(/\s+/g, " ");
  if (text.length < 2) {
    throw new UserFacingError("Enter at least 2 characters of the deposit's description.");
  }
  if (text.length > 100) throw new UserFacingError("Keep the text to 100 characters or fewer.");
  return { pattern: text, accountId };
}

/** Whether an inflow (account, amount, description) matches the rule. */
export function matchesIncomeRule(
  rule: IncomeRule,
  inflow: { accountId: string; amount: Cents; payee: string },
): boolean {
  return (
    inflow.amount > 0 &&
    (rule.accountId === null || rule.accountId === inflow.accountId) &&
    normalize(inflow.payee).includes(normalize(rule.pattern))
  );
}

/** The first rule the inflow matches, or null. */
export function incomeRuleFor(
  rules: readonly IncomeRule[],
  inflow: { accountId: string; amount: Cents; payee: string },
): IncomeRule | null {
  return rules.find((rule) => matchesIncomeRule(rule, inflow)) ?? null;
}

/**
 * Inflows waiting for review that a rule would mark as Income. Never on a
 * card (those are card credits) or in a tracking account.
 */
export function inflowsMatchingRules(data: BudgetData, rules = data.incomeRules): Transaction[] {
  // Cards and tracking accounts never have Income.
  const neverIncome = new Set(
    data.accounts.filter((a) => a.type === "credit_card" || !a.onBudget).map((a) => a.id),
  );
  return data.transactions.filter(
    (tx) =>
      !neverIncome.has(tx.accountId) &&
      tx.amount > 0 &&
      isToReview(tx, false) &&
      incomeRuleFor(rules, tx) !== null,
  );
}
