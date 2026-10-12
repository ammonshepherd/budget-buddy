import { describe, expect, it } from "vitest";
import {
  availableToAssign,
  canAssign,
  checkSpend,
  computeEnvelopeHistory,
  computeEnvelopeMonth,
  envelopeAsOf,
  isMonth,
  overAssigned,
  spentFromAmounts,
  type EnvelopeMonthInput,
} from "./budgetMath";

describe("computeEnvelopeMonth", () => {
  it("computes Remaining = Assigned + Released − Spent", () => {
    const m = computeEnvelopeMonth(
      { month: "2026-10", assigned: 50_000, released: 2_000, spent: 30_000 },
      10_000,
    );
    expect(m.remaining).toBe(22_000);
    expect(m.shortfall).toBe(0);
  });

  it("moves released money out of Saved without changing envelope money", () => {
    const before = computeEnvelopeMonth(
      { month: "2026-10", assigned: 0, released: 0, spent: 0 },
      10_000,
    );
    const after = computeEnvelopeMonth(
      { month: "2026-10", assigned: 0, released: 4_000, spent: 0 },
      10_000,
    );
    expect(after.saved).toBe(6_000);
    expect(after.remaining).toBe(4_000);
    expect(after.envelopeMoney).toBe(before.envelopeMoney);
  });

  it("computes Saved(M+1) = Saved(M) − Released(M) + Remaining(M)", () => {
    const m = computeEnvelopeMonth(
      { month: "2026-10", assigned: 50_000, released: 2_000, spent: 30_000 },
      10_000,
    );
    expect(m.savedNext).toBe(10_000 - 2_000 + 22_000);
    expect(m.envelopeMoney).toBe(m.saved + m.remaining);
  });

  it("reports an overspend as a shortfall instead of hiding it", () => {
    const m = computeEnvelopeMonth(
      { month: "2026-10", assigned: 10_000, released: 0, spent: 12_500 },
      0,
    );
    expect(m.remaining).toBe(-2_500);
    expect(m.shortfall).toBe(2_500);
  });

  it("rejects releasing more than is Saved", () => {
    expect(() =>
      computeEnvelopeMonth({ month: "2026-10", assigned: 0, released: 101, spent: 0 }, 100),
    ).toThrow(RangeError);
  });

  it("rejects a negative release", () => {
    expect(() =>
      computeEnvelopeMonth({ month: "2026-10", assigned: 0, released: -1, spent: 0 }, 100),
    ).toThrow(RangeError);
  });

  it("rejects amounts that are not whole cents", () => {
    expect(() =>
      computeEnvelopeMonth({ month: "2026-10", assigned: 10.5, released: 0, spent: 0 }, 0),
    ).toThrow(TypeError);
  });
});

describe("computeEnvelopeHistory", () => {
  const groceries: EnvelopeMonthInput[] = [
    // Deliberately out of order: the function sorts by month.
    { month: "2026-10", assigned: 40_000, released: 5_000, spent: 45_000 },
    { month: "2026-08", assigned: 40_000, released: 0, spent: 35_000 },
    { month: "2026-09", assigned: 40_000, released: 0, spent: 38_000 },
  ];

  it("accumulates leftover Remaining into Saved every month", () => {
    const [aug, sep, oct] = computeEnvelopeHistory(groceries);
    expect(aug).toMatchObject({ savedAtStart: 0, remaining: 5_000, savedNext: 5_000 });
    expect(sep).toMatchObject({ savedAtStart: 5_000, remaining: 2_000, savedNext: 7_000 });
    expect(oct).toMatchObject({
      savedAtStart: 7_000,
      saved: 2_000,
      remaining: 0,
      envelopeMoney: 2_000,
      savedNext: 2_000,
    });
  });

  it("keeps envelope money equal to everything assigned minus everything spent", () => {
    const history = computeEnvelopeHistory(groceries);
    const assigned = groceries.reduce((sum, g) => sum + g.assigned, 0);
    const spent = groceries.reduce((sum, g) => sum + g.spent, 0);
    expect(history.at(-1)?.envelopeMoney).toBe(assigned - spent);
  });

  it("rejects duplicate and malformed months", () => {
    const row = { assigned: 0, released: 0, spent: 0 };
    expect(() =>
      computeEnvelopeHistory([
        { month: "2026-10", ...row },
        { month: "2026-10", ...row },
      ]),
    ).toThrow(/more than once/);
    expect(() => computeEnvelopeHistory([{ month: "2026-13", ...row }])).toThrow(/YYYY-MM/);
  });
});

describe("envelopeAsOf", () => {
  const history = computeEnvelopeHistory([
    { month: "2026-08", assigned: 10_000, released: 0, spent: 4_000 },
    { month: "2026-10", assigned: 1_000, released: 0, spent: 0 },
  ]);

  it("returns the month's own row when there is one", () => {
    expect(envelopeAsOf(history, "2026-10")).toBe(history[1]);
  });

  it("carries Saved forward through a month with no activity", () => {
    expect(envelopeAsOf(history, "2026-09")).toMatchObject({
      savedAtStart: 6_000,
      remaining: 0,
      envelopeMoney: 6_000,
    });
  });

  it("starts empty before the first month and stays put after the last", () => {
    expect(envelopeAsOf(history, "2026-01").envelopeMoney).toBe(0);
    expect(envelopeAsOf(history, "2027-01").savedAtStart).toBe(7_000);
  });
});

describe("availableToAssign", () => {
  it("is opening balances + income − assigned − uncategorized outflows", () => {
    expect(
      availableToAssign({
        openingBalances: 100_000,
        income: 300_000,
        assigned: 250_000,
        uncategorizedSpent: 20_000,
      }),
    ).toBe(130_000);
  });

  it("equals budget account balances minus all envelope money", () => {
    // Two envelopes over two months, plus one uncategorized purchase.
    const rent = computeEnvelopeHistory([
      { month: "2026-09", assigned: 120_000, released: 0, spent: 120_000 },
      { month: "2026-10", assigned: 120_000, released: 0, spent: 120_000 },
    ]);
    const fun = computeEnvelopeHistory([
      { month: "2026-09", assigned: 10_000, released: 0, spent: 3_000 },
      { month: "2026-10", assigned: 5_000, released: 7_000, spent: 9_000 },
    ]);
    const opening = 50_000;
    const income = 400_000;
    const uncategorized = 1_500;
    const categorizedSpent = 120_000 + 120_000 + 3_000 + 9_000;
    const accountBalance = opening + income - categorizedSpent - uncategorized;
    const envelopeMoney =
      envelopeAsOf(rent, "2026-10").envelopeMoney + envelopeAsOf(fun, "2026-10").envelopeMoney;

    const available = availableToAssign({
      openingBalances: opening,
      income,
      assigned: 120_000 + 120_000 + 10_000 + 5_000,
      uncategorizedSpent: uncategorized,
    });
    expect(available).toBe(accountBalance - envelopeMoney);
  });
});

describe("overAssigned and canAssign", () => {
  it("is zero unless Available to Assign is negative", () => {
    expect(overAssigned(500)).toBe(0);
    expect(overAssigned(0)).toBe(0);
    expect(overAssigned(-750)).toBe(750);
  });

  it("blocks assigning more than is available", () => {
    expect(canAssign(1_000, 1_000)).toBe(true);
    expect(canAssign(1_000, 1_001)).toBe(false);
    expect(canAssign(-50, 1)).toBe(false);
  });
});

describe("spentFromAmounts", () => {
  it("turns signed outflows and refunds into a positive Spent", () => {
    expect(spentFromAmounts([-4_000, -1_250, 500])).toBe(4_750);
  });

  it("is zero for no transactions", () => {
    expect(spentFromAmounts([])).toBe(0);
  });
});

describe("checkSpend", () => {
  const current = computeEnvelopeMonth(
    { month: "2026-10", assigned: 5_000, released: 0, spent: 3_000 },
    4_000,
  );

  it("needs no cover when Remaining stays at or above zero", () => {
    expect(checkSpend(current, 2_000)).toEqual({
      remainingAfter: 0,
      shortfall: 0,
      fromSaved: 0,
      stillShort: 0,
    });
  });

  it("covers a shortfall from this envelope's Saved first", () => {
    expect(checkSpend(current, 5_000)).toEqual({
      remainingAfter: -3_000,
      shortfall: 3_000,
      fromSaved: 3_000,
      stillShort: 0,
    });
  });

  it("leaves the rest for another envelope or Available to Assign", () => {
    expect(checkSpend(current, 9_000)).toMatchObject({
      shortfall: 7_000,
      fromSaved: 4_000,
      stillShort: 3_000,
    });
  });
});

describe("isMonth", () => {
  it("accepts YYYY-MM only", () => {
    expect(isMonth("2026-10")).toBe(true);
    expect(isMonth("2026-00")).toBe(false);
    expect(isMonth("2026-1")).toBe(false);
  });
});
