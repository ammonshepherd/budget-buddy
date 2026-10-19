import { describe, expect, it } from "vitest";
import { buildBudgetMonth, type BudgetMonthView, type EnvelopeRow } from "./budgetMath";
import { envelopeActivity, monthWatchList, planCheck, remainingParts } from "./envelopeDetail";
import type { BudgetData, Transaction } from "./types";

const row = (partial: Partial<EnvelopeRow>): EnvelopeRow =>
  ({ assigned: 0, released: 0, refunded: 0, outflow: 0, planned: 0, ...partial }) as EnvelopeRow;

describe("planCheck", () => {
  it("says how far Spent is under or over Planned", () => {
    expect(planCheck(row({ outflow: 18_706, planned: 30_000 }))).toEqual({
      status: "under",
      spent: 18_706,
      planned: 30_000,
      difference: 11_294,
    });
    expect(planCheck(row({ outflow: 30_000, planned: 30_000 }))).toMatchObject({
      status: "on",
      difference: 0,
    });
    expect(planCheck(row({ outflow: 30_001, planned: 30_000 }))).toMatchObject({
      status: "over",
      difference: 1,
    });
  });

  it("has nothing to compare when nothing is planned", () => {
    expect(planCheck(row({ outflow: 5_000 }))).toMatchObject({ status: "none", difference: 0 });
  });
});

describe("remainingParts", () => {
  it("always shows Assigned and Spent; Released and Refunded only when used", () => {
    expect(remainingParts(row({ assigned: 30_000, outflow: 18_706 }))).toEqual([
      { label: "assigned", amount: 30_000, subtract: false },
      { label: "spent", amount: 18_706, subtract: true },
    ]);
    expect(
      remainingParts(row({ assigned: 1_000, released: 2_000, refunded: 500 })).map((p) => p.label),
    ).toEqual(["assigned", "released", "refunded", "spent"]);
  });

  it("adds up to Remaining", () => {
    const data: BudgetData = {
      household: { id: "h", name: "Home" },
      incomeRules: [],
      accounts: [
        {
          id: "checking",
          name: "Checking",
          type: "checking",
          openingBalance: 100_000,
          openingDate: "2026-09-01",
          onBudget: true,
          closedAt: null,
          importFormat: null,
        },
      ],
      groups: [{ id: "g", name: "Everyday", position: 0 }],
      envelopes: [{ id: "food", groupId: "g", name: "Food", position: 0, cardAccountId: null }],
      envelopeMonths: [
        { envelopeId: "food", month: "2026-09", assigned: 10_000, released: 0, planned: 0 },
        { envelopeId: "food", month: "2026-10", assigned: 3_000, released: 4_000, planned: 0 },
      ],
      transactions: [tx("a", "2026-10-02", -2_500), tx("b", "2026-10-03", 1_000)],
    };
    const food = buildBudgetMonth(data, "2026-10").groups[0]!.envelopes[0]!;
    const sum = remainingParts(food).reduce((s, p) => s + (p.subtract ? -p.amount : p.amount), 0);
    expect(sum).toBe(food.remaining);
  });
});

function tx(id: string, date: string, amount: number, partial: Partial<Transaction> = {}) {
  return {
    id,
    accountId: "checking",
    date,
    amount,
    payee: id,
    memo: "",
    isTransfer: false,
    isIncome: false,
    transferId: null,
    voided: false,
    allocations: [{ envelopeId: "food", amount }],
    importKey: null,
    ...partial,
  } satisfies Transaction;
}

describe("envelopeActivity", () => {
  it("lists this envelope's part of the month's transactions, newest first", () => {
    const data = {
      accounts: [{ id: "checking", name: "Checking" }],
      transactions: [
        tx("sept", "2026-09-30", -100),
        tx("first", "2026-10-02", -200),
        tx("split", "2026-10-09", -5_000, {
          allocations: [
            { envelopeId: "food", amount: -1_500 },
            { envelopeId: "fun", amount: -3_500 },
          ],
        }),
        tx("void", "2026-10-10", -999, { voided: true }),
        tx("other", "2026-10-11", -300, { allocations: [{ envelopeId: "fun", amount: -300 }] }),
      ],
    } as unknown as BudgetData;
    expect(envelopeActivity(data, "food", "2026-10")).toEqual([
      {
        id: "split",
        date: "2026-10-09",
        payee: "split",
        accountName: "Checking",
        amount: -1_500,
        splitTotal: -5_000,
      },
      {
        id: "first",
        date: "2026-10-02",
        payee: "first",
        accountName: "Checking",
        amount: -200,
        splitTotal: null,
      },
    ]);
  });
});

describe("monthWatchList", () => {
  const view = (envelopes: Partial<EnvelopeRow>[]) =>
    ({
      groups: [
        {
          id: "g",
          name: "G",
          envelopes: envelopes.map((e, i) =>
            row({ id: `e${i}`, name: `E${i}`, shortfall: 0, card: null, ...e }),
          ),
        },
      ],
    }) as unknown as BudgetMonthView;

  it("lists envelopes over Planned, Short, and cards with debt not covered", () => {
    const list = monthWatchList(
      view([
        { outflow: 12_000, planned: 10_000 },
        { outflow: 9_000, planned: 10_000 },
        { outflow: 500, shortfall: 500 },
        {
          outflow: 40_000,
          planned: 0,
          card: { accountId: "c", open: true, owed: 50_000, uncovered: 10_000 },
        },
      ]),
    );
    expect(list.overPlan).toEqual([{ id: "e0", name: "E0", amount: 2_000 }]);
    expect(list.short).toEqual([{ id: "e2", name: "E2", amount: 500 }]);
    expect(list.uncoveredDebt).toEqual([{ id: "e3", name: "E3", amount: 10_000 }]);
  });

  it("is empty when everything is on track", () => {
    expect(monthWatchList(view([{ outflow: 0, planned: 100 }]))).toEqual({
      overPlan: [],
      short: [],
      uncoveredDebt: [],
    });
  });
});
