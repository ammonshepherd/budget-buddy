import { useCardDebt } from "../controllers/useCardDebt";
import type { BudgetData } from "../models/types";
import { Money } from "./components";

/**
 * What the credit cards owe today, in a strip at the top of each page (under
 * the month on Budget and Activity). Hidden when nothing is owed.
 */
export function CardDebt({ data }: { data: BudgetData }) {
  const owed = useCardDebt(data);
  if (owed <= 0) return null;
  return (
    <p className="card-debt">
      <span className="card-debt-label">Credit card debt</span>
      <Money cents={owed} />
    </p>
  );
}
