import { availableToAssign } from "../models/budgetMath";
import { formatCents } from "../models/money";

export interface BudgetSummary {
  monthLabel: string;
  availableToAssign: string;
  assigned: string;
  remaining: string;
}

/**
 * Supplies the Budget page header numbers, already formatted, so the view
 * does no math. Until Supabase data access lands, every total is zero.
 */
export function useBudgetSummary(today = new Date()): BudgetSummary {
  const totals = { openingBalances: 0, income: 0, assigned: 0, uncategorizedSpent: 0 };
  return {
    monthLabel: today.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    availableToAssign: formatCents(availableToAssign(totals)),
    assigned: formatCents(totals.assigned),
    remaining: formatCents(0),
  };
}
