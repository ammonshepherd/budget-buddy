/**
 * Splitting one transaction across several envelopes. The form holds each
 * line as typed (a positive amount); these functions turn the lines into
 * allocations with the transaction's sign, and say how much is left to split.
 *
 * Rules (also enforced by the stores and the database): every line has an
 * envelope and an amount above zero, an envelope appears once, there are at
 * most MAX_SPLIT_LINES lines, and the lines add up to the transaction amount.
 */
import { UserFacingError } from "./dataStore";
import { formatCents, parseCents, type Cents } from "./money";
import type { Allocation } from "./types";

/** The database accepts at most this many lines on one transaction. */
export const MAX_SPLIT_LINES = 50;

/** One split line as typed in the form. */
export interface SplitLine {
  /** "" until an envelope is chosen. */
  envelopeId: string;
  /** A positive amount, as typed ("" = not yet). */
  amount: string;
}

/** Cents a typed line amount stands for; 0 while it is blank or not a number yet. */
const lineCents = (line: SplitLine): Cents => Math.max(0, parseCents(line.amount) ?? 0);

/**
 * How much of `total` (a positive magnitude) the lines do not cover yet:
 * positive = still to split, negative = the lines are over by that much.
 */
export function leftToSplit(total: Cents, lines: readonly SplitLine[]): Cents {
  return lines.reduce((left, line) => left - lineCents(line), total);
}

/**
 * Turns split lines into allocations for a transaction of `amount` (signed:
 * every line takes its sign), or explains what is wrong with them.
 */
export function splitAllocations(amount: Cents, lines: readonly SplitLine[]): Allocation[] {
  if (lines.length > MAX_SPLIT_LINES) {
    throw new UserFacingError(`Split into at most ${MAX_SPLIT_LINES} envelopes`);
  }
  const sign = amount < 0 ? -1 : 1;
  const seen = new Set<string>();
  const allocations = lines.map((line) => {
    if (!line.envelopeId) throw new UserFacingError("Choose an envelope for each split line");
    if (seen.has(line.envelopeId)) {
      throw new UserFacingError("Each envelope can appear only once in a split");
    }
    seen.add(line.envelopeId);
    // A blank amount is not filled in yet: what is left says how much it needs.
    const cents = line.amount.trim() === "" ? 0 : parseCents(line.amount);
    if (cents === null) throw new UserFacingError("Split line: enter an amount like 12.34");
    if (cents < 0) throw new UserFacingError("Each split line needs an amount above zero");
    return { envelopeId: line.envelopeId, amount: sign * cents };
  });
  const left = leftToSplit(Math.abs(amount), lines);
  if (left > 0)
    throw new UserFacingError(`Split the rest: ${formatCents(left)} is not in an envelope yet`);
  if (left < 0)
    throw new UserFacingError(`The split is ${formatCents(-left)} more than the amount`);
  if (allocations.some((a) => a.amount * sign <= 0)) {
    throw new UserFacingError("Each split line needs an amount above zero");
  }
  return allocations;
}

/** A positive amount as a line shows it, e.g. 1250 → "12.50". */
const lineText = (cents: Cents): string => (cents / 100).toFixed(2);

/** The lines with what is left to split added to line `index` (unchanged if nothing is left). */
export function fillRest(total: Cents, lines: readonly SplitLine[], index: number): SplitLine[] {
  const left = leftToSplit(total, lines);
  return lines.map((line, i) =>
    i === index && left > 0 ? { ...line, amount: lineText(lineCents(line) + left) } : line,
  );
}

/** Split lines for a transaction's allocations (amounts as positive text). */
export function linesFromAllocations(allocations: readonly Allocation[]): SplitLine[] {
  return allocations.map((a) => ({
    envelopeId: a.envelopeId,
    amount: lineText(Math.abs(a.amount)),
  }));
}
