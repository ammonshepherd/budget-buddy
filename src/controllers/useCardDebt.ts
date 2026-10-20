import { useMemo } from "react";
import { cardDebt } from "../models/accounts";
import { todayIso } from "../models/month";
import type { BudgetData } from "../models/types";

/** What the credit cards owe today, shown at the top of every page. */
export function useCardDebt(data: BudgetData) {
  return useMemo(() => cardDebt(data, todayIso()), [data]);
}
