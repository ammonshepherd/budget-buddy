import type { CSSProperties } from "react";
import { useCardDebt } from "../controllers/useCardDebt";
import type { BudgetData } from "../models/types";
import { Money } from "./components";

/**
 * What the credit cards owe today, in a strip at the top of each page (under
 * the month on Budget and Activity), on one of 30 reds picked at each page
 * load. Hidden when nothing is owed.
 */
export function CardDebt({ data }: { data: BudgetData }) {
  const { owed, shade } = useCardDebt(data);
  if (owed <= 0) return null;
  const colors = { "--debt-bg": shade.background, "--debt-text": shade.text } as CSSProperties;
  return (
    <p className="card-debt" style={colors}>
      <span className="card-debt-label">Credit card debt</span>
      <Money cents={owed} />
    </p>
  );
}
