import { describe, expect, it } from "vitest";
import {
  accountBalance,
  assignableIn,
  availableToAssignFor,
  buildBudgetMonth,
  checkTransactionSpend,
  coverSources,
  visibleGroups,
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
    importKey: null,
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
        type: "checking",
        openingBalance: 100_000,
        openingDate: "2026-09-15",
        onBudget: true,
        closedAt: null,
        importFormat: null,
      },
      {
        id: "savings",
        name: "Savings",
        type: "checking",
        openingBalance: 50_000,
        openingDate: "2026-09-15",
        onBudget: true,
        closedAt: null,
        importFormat: null,
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

  it("treats a credit card as a budget account that owes money", () => {
    const data = household();
    data.accounts.push({
      id: "card",
      name: "Card",
      type: "credit_card",
      openingBalance: -20_000,
      openingDate: "2026-10-01",
      onBudget: true,
      closedAt: null,
      importFormat: null,
    });
    const before = availableToAssignFor(data, "2026-10");
    data.transactions.push(
      // A card purchase from Fun lowers the envelope, not Available to Assign.
      tx({
        id: "card-buy",
        date: "2026-10-07",
        amount: -4_000,
        accountId: "card",
        allocations: [{ envelopeId: "fun", amount: -4_000 }],
      }),
      // Paying the card from checking is a Transfer on both sides.
      tx({ id: "pay-out", date: "2026-10-08", amount: -15_000, isTransfer: true }),
      tx({
        id: "pay-in",
        date: "2026-10-08",
        amount: 15_000,
        isTransfer: true,
        accountId: "card",
      }),
    );

    // The amount owed when the card opened is already out of Available to Assign.
    expect(before).toBe(150_000 + 200_000 - 80_000 - 2_000 - 20_000);
    expect(availableToAssignFor(data, "2026-10")).toBe(before);
    expect(accountBalance("card", data)).toBe(-20_000 - 4_000 + 15_000);
    const view = buildBudgetMonth(data, "2026-10");
    const fun = view.groups[0]!.envelopes.find((e) => e.id === "fun")!;
    expect(fun.remaining).toBe(6_000);
    const balances = ["checking", "savings", "card"].reduce(
      (sum, id) => sum + accountBalance(id, data),
      0,
    );
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

describe("envelopes in use per month", () => {
  /** Adds a second group with envelopes that are used only in some months. */
  function withMonthlySets(): BudgetData {
    const data = household();
    data.groups.push(
      { id: "extra", name: "Extras", position: 1 },
      { id: "empty", name: "Empty", position: 2 },
    );
    data.envelopes.push(
      { id: "trip", groupId: "extra", name: "Trip", position: 0 },
      { id: "gifts", groupId: "extra", name: "Gifts", position: 1 },
      { id: "new", groupId: "extra", name: "New", position: 2 },
    );
    data.envelopeMonths.push(
      // Planned in September only, never funded.
      { envelopeId: "trip", month: "2026-09", assigned: 0, released: 0, planned: 20_000 },
      // Funded in September and never spent: the money carries into Saved.
      { envelopeId: "gifts", month: "2026-09", assigned: 5_000, released: 0, planned: 0 },
    );
    return data;
  }

  const inUse = (data: BudgetData, month: string) =>
    Object.fromEntries(
      buildBudgetMonth(data, month)
        .groups.flatMap((g) => g.envelopes)
        .map((e) => [e.id, e.inUse]),
    );

  it("counts a stored month, spending, held money, or never having been used", () => {
    const data = withMonthlySets();
    expect(inUse(data, "2026-09")).toEqual({
      food: true, // assigned and spent
      fun: false, // nothing yet in September, though used in October
      trip: true, // planned
      gifts: true, // assigned
      new: true, // never used anywhere
    });
    expect(inUse(data, "2026-10")).toEqual({
      food: true,
      fun: true,
      trip: false, // no plan, no money: hidden
      gifts: true, // still holds $50 in Saved
      new: true,
    });
  });

  it("counts a $0 record, as a plan import with no amount stores", () => {
    const data = withMonthlySets();
    data.envelopeMonths.push({
      envelopeId: "trip",
      month: "2026-10",
      assigned: 0,
      released: 0,
      planned: 0,
    });
    expect(inUse(data, "2026-10").trip).toBe(true);
  });

  it("counts spending without a stored month, so an overspend is never hidden", () => {
    const data = withMonthlySets();
    data.transactions.push(
      tx({
        id: "t",
        date: "2026-11-02",
        amount: -1_000,
        allocations: [{ envelopeId: "trip", amount: -1_000 }],
      }),
    );
    const trip = buildBudgetMonth(data, "2026-11")
      .groups.flatMap((g) => g.envelopes)
      .find((e) => e.id === "trip")!;
    expect(trip).toMatchObject({ inUse: true, shortfall: 1_000 });
  });

  it("hides unused envelopes and their emptied groups unless showing all", () => {
    const data = withMonthlySets();
    data.envelopes = data.envelopes.filter((e) => e.id !== "new" && e.id !== "gifts");
    const view = buildBudgetMonth(data, "2026-10");
    expect(view.unusedCount).toBe(1);

    const names = (showAll: boolean) =>
      visibleGroups(view, showAll).map((g) => [g.name, g.envelopes.map((e) => e.name)]);
    expect(names(false)).toEqual([
      ["Everyday", ["Food", "Fun"]],
      // Extras is hidden: its only envelope, Trip, is not used in October.
      ["Empty", []], // a group with no envelopes yet stays, so envelopes can be added
    ]);
    expect(names(true)).toEqual([
      ["Everyday", ["Food", "Fun"]],
      ["Extras", ["Trip"]],
      ["Empty", []],
    ]);
  });
});
