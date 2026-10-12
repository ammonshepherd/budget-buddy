/**
 * All envelope-budget math lives here. Pages and controllers call these
 * functions; they never recompute budget numbers themselves.
 *
 * Every amount is integer cents (see ./money.ts). Inputs named `spent` or
 * `uncategorizedSpent` are positive magnitudes of money going out; use
 * `spentFromAmounts` to turn signed transaction amounts into one.
 */
import { assertCents, type Cents } from "./money";

/** A calendar month as "YYYY-MM", e.g. "2026-10". Sorts correctly as a string. */
export type Month = string;

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonth(value: string): value is Month {
  return MONTH_PATTERN.test(value);
}

/** What the user did with one envelope in one month. */
export interface EnvelopeMonthInput {
  month: Month;
  /** Money assigned from Available to Assign this month. */
  assigned: Cents;
  /** Money moved from this envelope's Saved into Remaining this month. */
  released: Cents;
  /** Money spent from the envelope this month (positive = spent). */
  spent: Cents;
}

/** The numbers shown for one envelope in one month. */
export interface EnvelopeMonth {
  month: Month;
  assigned: Cents;
  released: Cents;
  spent: Cents;
  /** Saved(M): the reserve carried in from earlier months, before releases. */
  savedAtStart: Cents;
  /** The reserve still held this month: Saved(M) − Released(M). */
  saved: Cents;
  /** Remaining(M) = Assigned + Released − Spent. */
  remaining: Cents;
  /**
   * How far Remaining fell below zero (0 when it did not). Envelopes must
   * never go negative; a value here means a spend was recorded without the
   * shortfall being covered, and the UI should ask the user to cover it.
   */
  shortfall: Cents;
  /** Envelope money = Saved + Remaining. */
  envelopeMoney: Cents;
  /** Saved(M+1) = Saved(M) − Released(M) + Remaining(M). */
  savedNext: Cents;
}

/**
 * Computes one envelope month from the reserve carried in.
 *
 * Remaining is not clamped at zero: hiding an overspend would make the money
 * disappear from the books and break the Available to Assign identity.
 * Instead the overspend is reported as `shortfall` so it can be covered.
 */
export function computeEnvelopeMonth(
  input: EnvelopeMonthInput,
  savedAtStart: Cents,
): EnvelopeMonth {
  const { month, assigned, released, spent } = input;
  assertCents(assigned, "assigned");
  assertCents(released, "released");
  assertCents(spent, "spent");
  assertCents(savedAtStart, "savedAtStart");
  if (released < 0) {
    throw new RangeError(`released must not be negative (got ${released}) in ${month}`);
  }
  if (released > savedAtStart) {
    throw new RangeError(`released (${released}) is more than Saved (${savedAtStart}) in ${month}`);
  }

  const remaining = assigned + released - spent;
  const saved = savedAtStart - released;
  return {
    month,
    assigned,
    released,
    spent,
    savedAtStart,
    saved,
    remaining,
    shortfall: Math.max(0, -remaining),
    envelopeMoney: saved + remaining,
    savedNext: saved + remaining,
  };
}

/**
 * Runs an envelope forward month by month so Saved accumulates.
 * Months with no activity can be left out: they would change nothing.
 * Input order does not matter; the result is sorted by month.
 */
export function computeEnvelopeHistory(inputs: readonly EnvelopeMonthInput[]): EnvelopeMonth[] {
  const sorted = [...inputs].sort((a, b) => a.month.localeCompare(b.month));
  const result: EnvelopeMonth[] = [];
  let saved = 0;
  for (const input of sorted) {
    if (!isMonth(input.month)) {
      throw new RangeError(`"${input.month}" is not a YYYY-MM month`);
    }
    if (result.at(-1)?.month === input.month) {
      throw new RangeError(`${input.month} appears more than once`);
    }
    const month = computeEnvelopeMonth(input, saved);
    result.push(month);
    saved = month.savedNext;
  }
  return result;
}

/**
 * The envelope as of `month`: its own row if it has one, otherwise an empty
 * month that carries the latest earlier Saved forward.
 */
export function envelopeAsOf(history: readonly EnvelopeMonth[], month: Month): EnvelopeMonth {
  let savedAtStart = 0;
  for (const row of history) {
    if (row.month === month) return row;
    if (row.month > month) break;
    savedAtStart = row.savedNext;
  }
  return computeEnvelopeMonth({ month, assigned: 0, released: 0, spent: 0 }, savedAtStart);
}

/** Totals needed for Available to Assign, each counted through the end of a month. */
export interface AvailableToAssignInput {
  /** Opening balances of all budget accounts. */
  openingBalances: Cents;
  /** Income received through the end of the month. */
  income: Cents;
  /** Everything assigned to envelopes through the end of the month. */
  assigned: Cents;
  /** Outflows not yet categorized through the end of the month (positive = spent). */
  uncategorizedSpent: Cents;
}

/**
 * Available to Assign(M) = opening balances + income − all Assigned
 * − uncategorized outflows, each through the end of M.
 * Releasing Saved does not appear here: that money stays in its envelope.
 */
export function availableToAssign(input: AvailableToAssignInput): Cents {
  assertCents(input.openingBalances, "openingBalances");
  assertCents(input.income, "income");
  assertCents(input.assigned, "assigned");
  assertCents(input.uncategorizedSpent, "uncategorizedSpent");
  return input.openingBalances + input.income - input.assigned - input.uncategorizedSpent;
}

/** Over Assigned = max(0, −Available to Assign). */
export function overAssigned(available: Cents): Cents {
  return Math.max(0, -available);
}

/** Assigning is blocked when Available to Assign is insufficient. */
export function canAssign(available: Cents, amount: Cents): boolean {
  assertCents(amount, "amount");
  return amount <= available;
}

/**
 * Converts signed transaction amounts (outflow negative, refunds positive)
 * into a Spent figure (positive = money went out).
 */
export function spentFromAmounts(amounts: readonly Cents[]): Cents {
  let total = 0;
  for (const amount of amounts) {
    assertCents(amount, "amount");
    total += amount;
  }
  return total === 0 ? 0 : -total;
}

/** What it would take to record more spending in an envelope this month. */
export interface SpendCheck {
  /** Remaining after the spend, before any cover. */
  remainingAfter: Cents;
  /** How much must be covered to keep Remaining at or above zero. */
  shortfall: Cents;
  /** Step 1 of the cover prompt: the part this envelope's Saved can cover. */
  fromSaved: Cents;
  /** Left for step 2 (another envelope) or step 3 (Available to Assign). */
  stillShort: Cents;
}

/**
 * Checks a new spend before it is categorized. When `shortfall` is above
 * zero the UI prompts to cover it: first from this envelope's Saved
 * (`fromSaved`), then from another envelope or Available to Assign
 * (`stillShort`).
 */
export function checkSpend(current: EnvelopeMonth, additionalSpent: Cents): SpendCheck {
  assertCents(additionalSpent, "additionalSpent");
  const remainingAfter = current.remaining - additionalSpent;
  const shortfall = Math.max(0, -remainingAfter);
  const fromSaved = Math.min(shortfall, current.saved);
  return { remainingAfter, shortfall, fromSaved, stillShort: shortfall - fromSaved };
}
