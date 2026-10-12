import { describe, expect, it } from "vitest";
import {
  accountBalance,
  assignableIn,
  availableToAssignFor,
  buildBudgetMonth,
  checkTransactionSpend,
  coverSources,
} from "./budgetMath";
import type { BudgetData, Transaction } from "./types";

function tx(
  partial: Partial<Transaction> & Pick<Transaction, "id" | "date" | "amount">,
): Transaction {
  return {
    accountId: "checking",
    payee: "",
    memo: "",
    isTransfer: false,
    voided: false,
    allocations: [],
    ...partial,
  };
}

/** A small household: $1,000 opening, $2,000 paycheck in October, two envelopes. */
function household(): BudgetData {
  return {
    household: { id: "h", name: "Home" },
    accounts: [
      {
        id: "checking",
        name: "Checking",
        openingBalance: 100_000,
        openingDate: "2026-09-15",
        onBudget: true,
        closedAt: null,
      },
      {
        id: "savings",
        name: "Savings",
        openingBalance: 50_000,
        openingDate: "2026-09-15",
        onBudget: true,
        closedAt: null,
      },
    ],
    groups: [{ id: "g", name: "Everyday", position: 0 }],
    envelopes: [
      { id: "food", groupId: "g", name: "Food", position: 0 },
      { id: "fun", groupId: "g", name: "Fun", position: 1 },
    ],
    envelopeMonths: [
      { envelopeId: "food", month: "2026-09", assigned: 40_000, released: 0, planned: 0 },
      { envelopeId: "food", month: "2026-10", assigned: 30_000, released: 5_000, planned: 45_000 },
      { envelopeId: "fun", month: "2026-10", assigned: 10_000, released: 0, planned: 0 },
    ],
    transactions: [
      tx({ id: "pay", date: "2026-10-01", amount: 200_000, payee: "Paycheck" }),
      tx({
        id: "g1",
        date: "2026-09-20",
        amount: -32_000,
        allocations: [{ envelopeId: "food", amount: -32_000 }],
      }),
      tx({
        id: "g2",
        date: "2026-10-03",
        amount: -35_000,
        allocations: [{ envelopeId: "food", amount: -35_000 }],
      }),
      tx({ id: "cash", date: "2026-10-04", amount: -2_000 }),
      tx({ id: "move-out", date: "2026-10-05", amount: -10_000, isTransfer: true }),
      tx({
        id: "move-in",
        date: "2026-10-05",
        amount: 10_000,
        isTransfer: true,
        accountId: "savings",
      }),
      tx({ id: "void", date: "2026-10-06", amount: -99_999, voided: true }),
    ],
  };
}

describe("accountBalance", () => {
  it("is opening balance plus non-voided transactions", () => {
    const data = household();
    expect(accountBalance("checking", data)).toBe(
      100_000 + 200_000 - 32_000 - 35_000 - 2_000 - 10_000,
    );
    expect(accountBalance("savings", data)).toBe(60_000);
  });
});

describe("availableToAssignFor", () => {
  it("counts opening balances, uncategorized income and outflows, ignoring transfers and voids", () => {
    const data = household();
    expect(availableToAssignFor(data, "2026-09")).toBe(150_000 - 40_000);
    expect(availableToAssignFor(data, "2026-10")).toBe(150_000 + 200_000 - 80_000 - 2_000);
  });

  it("ignores accounts before their opening month", () => {
    expect(availableToAssignFor(household(), "2026-08")).toBe(0);
  });

  it("equals on-budget balances minus all envelope money", () => {
    const data = household();
    const view = buildBudgetMonth(data, "2026-10");
    const balances = accountBalance("checking", data) + accountBalance("savings", data);
    const envelopeMoney = view.groups
      .flatMap((g) => g.envelopes)
      .reduce((sum, e) => sum + e.envelopeMoney, 0);
    expect(view.availableToAssign).toBe(balances - envelopeMoney);
  });
});

describe("buildBudgetMonth", () => {
  it("shows Planned, Assigned, Spent, Remaining and Saved per envelope", () => {
    const view = buildBudgetMonth(household(), "2026-10");
    const [food, fun] = view.groups[0]!.envelopes;
    // September left 8,000 in Food; October released 5,000 of it.
    expect(food).toMatchObject({
      name: "Food",
      planned: 45_000,
      assigned: 30_000,
      spent: 35_000,
      remaining: 0,
      saved: 3_000,
    });
    expect(fun).toMatchObject({ assigned: 10_000, spent: 0, remaining: 10_000, saved: 0 });
    expect(view.totals).toEqual({
      planned: 45_000,
      assigned: 40_000,
      spent: 35_000,
      remaining: 10_000,
      saved: 3_000,
    });
  });

  it("carries envelopes into months with no activity", () => {
    const [food] = buildBudgetMonth(household(), "2026-11").groups[0]!.envelopes;
    expect(food).toMatchObject({ assigned: 0, remaining: 0, saved: 3_000, planned: 0 });
  });
});

describe("assignableIn", () => {
  it("is limited by later months so assigning never over-assigns the future", () => {
    const data = household();
    // September alone has 110,000 available, but October has only 68,000 left,
    // and assigning in September lowers October too.
    data.envelopeMonths.push({
      envelopeId: "fun",
      month: "2026-10",
      assigned: 200_000,
      released: 0,
      planned: 0,
    });
    expect(availableToAssignFor(data, "2026-09")).toBe(110_000);
    expect(availableToAssignFor(data, "2026-10")).toBe(68_000);
    expect(assignableIn(data, "2026-09")).toBe(68_000);
  });

  it("is never negative", () => {
    const data = household();
    data.envelopeMonths.push({
      envelopeId: "fun",
      month: "2026-10",
      assigned: 900_000,
      released: 0,
      planned: 0,
    });
    expect(assignableIn(data, "2026-10")).toBe(0);
  });
});

describe("checkTransactionSpend", () => {
  it("is null for an uncategorized transaction", () => {
    expect(
      checkTransactionSpend(household(), { date: "2026-10-09", amount: -500, envelopeId: null }),
    ).toBeNull();
  });

  it("covers a shortfall from Saved first, then reports what is still short", () => {
    // Food has 0 Remaining and 3,000 Saved in October.
    expect(
      checkTransactionSpend(household(), {
        date: "2026-10-09",
        amount: -5_000,
        envelopeId: "food",
      }),
    ).toEqual({ remainingAfter: -5_000, shortfall: 5_000, fromSaved: 3_000, stillShort: 2_000 });
  });

  it("does not count the transaction being edited twice", () => {
    // g2 already spent 35,000 of Food; editing it to 34,000 frees 1,000.
    expect(
      checkTransactionSpend(household(), {
        id: "g2",
        date: "2026-10-03",
        amount: -34_000,
        envelopeId: "food",
      }),
    ).toMatchObject({ remainingAfter: 1_000, shortfall: 0 });
  });
});

describe("coverSources", () => {
  it("lists other envelopes with enough Remaining", () => {
    const view = buildBudgetMonth(household(), "2026-10");
    expect(coverSources(view, "food", 2_000).map((e) => e.id)).toEqual(["fun"]);
    expect(coverSources(view, "food", 20_000)).toEqual([]);
  });
});
