import { useMemo } from "react";
import { cardDebt } from "../models/accounts";
import { pickShade } from "../models/cardDebtShades";
import { todayIso } from "../models/month";
import type { BudgetData } from "../models/types";

/** Chosen once per page load, so the strip's red changes with every refresh. */
const shade = pickShade(Math.random());

/** What the credit cards owe today, and the red to show it on (every page). */
export function useCardDebt(data: BudgetData) {
  const owed = useMemo(() => cardDebt(data, todayIso()), [data]);
  return { owed, shade };
}
