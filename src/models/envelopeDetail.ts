import type { EnvelopeRow } from "./budgetMath";
import type { Cents } from "./money";
import { monthOf, type Month } from "./month";
import type { BudgetData, IsoDate } from "./types";

/**
 * Spent (as shown) against Planned, for the envelope sheet's plan line.
 * "none" when nothing is planned; otherwise under, on or over plan by
 * `difference` (never negative). A hint only, like `overPlan`.
 */
export interface PlanCheck {
  status: "none" | "under" | "on" | "over";
  spent: Cents;
  planned: Cents;
  difference: Cents;
}

export function planCheck(row: EnvelopeRow): PlanCheck {
  const { outflow: spent, planned } = row;
  if (planned <= 0) return { status: "none", spent, planned, difference: 0 };
  const status = spent < planned ? "under" : spent > planned ? "over" : "on";
  return { status, spent, planned, difference: Math.abs(planned - spent) };
}

/**
 * The amounts that make up Remaining, in order, as the sheet spells it out
 * ("$300.00 assigned + $20.00 released − $187.06 spent"). Assigned and Spent
 * always show; Released and Refunded only when used.
 * Their signed sum is Remaining: Assigned + Released + Refunded − Spent.
 */
export interface RemainingPart {
  label: "assigned" | "released" | "refunded" | "spent";
  amount: Cents;
  /** Whether the part takes away from Remaining. */
  subtract: boolean;
}

export function remainingParts(row: EnvelopeRow): RemainingPart[] {
  const parts: RemainingPart[] = [{ label: "assigned", amount: row.assigned, subtract: false }];
  if (row.released > 0) parts.push({ label: "released", amount: row.released, subtract: false });
  if (row.refunded > 0) parts.push({ label: "refunded", amount: row.refunded, subtract: false });
  parts.push({ label: "spent", amount: row.outflow, subtract: true });
  return parts;
}

/** One transaction line in an envelope's sheet: only this envelope's part of a split. */
export interface EnvelopeActivity {
  id: string;
  date: IsoDate;
  payee: string;
  accountName: string;
  /** This envelope's allocation (signed: spending is negative). */
  amount: Cents;
  /** Total of the whole transaction, when it is a split. */
  splitTotal: Cents | null;
}

/** The envelope's transactions in `month`, newest first. */
export function envelopeActivity(
  data: BudgetData,
  envelopeId: string,
  month: Month,
): EnvelopeActivity[] {
  const accountNames = new Map(data.accounts.map((a) => [a.id, a.name]));
  const rows: EnvelopeActivity[] = [];
  for (const tx of data.transactions) {
    if (tx.voided || monthOf(tx.date) !== month) continue;
    const line = tx.allocations.find((a) => a.envelopeId === envelopeId);
    if (!line) continue;
    rows.push({
      id: tx.id,
      date: tx.date,
      payee: tx.payee,
      accountName: accountNames.get(tx.accountId) ?? "Unknown account",
      amount: line.amount,
      splitTotal: tx.allocations.length > 1 ? tx.amount : null,
    });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
