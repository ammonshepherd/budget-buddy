import { describe, expect, it } from "vitest";
import {
  accountBalance,
  assignableIn,
  availableToAssignFor,
  budgetWith,
  buildBudgetMonth,
  coverSources,
  transactionShortfalls,
  visibleGroups,
  withEnvelopeMonth,
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
    isIncome: false,
    transferId: null,
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
    incomeRules: [],
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
      { id: "food", groupId: "g", name: "Food", position: 0, cardAccountId: null },
      { id: "fun", groupId: "g", name: "Fun", position: 1, cardAccountId: null },
    ],
    envelopeMonths: [
      { envelopeId: "food", month: "2026-09", assigned: 40_000, released: 0, planned: 0 },
      { envelopeId: "food", month: "2026-10", assigned: 30_000, released: 5_000, planned: 45_000 },
      { envelopeId: "fun", month: "2026-10", assigned: 10_000, released: 0, planned: 0 },
    ],
    transactions: [
      tx({ id: "pay", date: "2026-10-01", amount: 200_000, payee: "Paycheck", isIncome: true }),
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
  it("counts opening balances, income and assigned, ignoring transfers, voids and spending to review", () => {
    const data = household();
    expect(availableToAssignFor(data, "2026-09")).toBe(150_000 - 40_000);
    // The $20 "cash" outflow is still to review, so it is not counted yet.
    expect(availableToAssignFor(data, "2026-10")).toBe(150_000 + 200_000 - 80_000);
  });

  it("ignores accounts before their opening month", () => {
    expect(availableToAssignFor(household(), "2026-08")).toBe(0);
  });

  it("equals on-budget balances minus all envelope money, plus spending to review", () => {
    const data = household();
    const view = buildBudgetMonth(data, "2026-10");
    const balances = accountBalance("checking", data) + accountBalance("savings", data);
    const envelopeMoney = view.groups
      .flatMap((g) => g.envelopes)
      .reduce((sum, e) => sum + e.envelopeMoney, 0);
    expect(view.toReview).toEqual({ count: 1, inflow: 0, outflow: 2_000 });
    expect(view.availableToAssign).toBe(balances - envelopeMoney + view.toReview.outflow);
  });

  it("counts a card without a payment envelope like any budget account", () => {
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
    expect(before).toBe(150_000 + 200_000 - 80_000 - 20_000);
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
    expect(view.availableToAssign).toBe(balances - envelopeMoney + view.toReview.outflow);
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
    // September alone has 110,000 available, but October has only 70,000 left,
    // and assigning in September lowers October too.
    data.envelopeMonths.push({
      envelopeId: "fun",
      month: "2026-10",
      assigned: 200_000,
      released: 0,
      planned: 0,
    });
    expect(availableToAssignFor(data, "2026-09")).toBe(110_000);
    expect(availableToAssignFor(data, "2026-10")).toBe(70_000);
    expect(assignableIn(data, "2026-09")).toBe(70_000);
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

describe("transactionShortfalls", () => {
  const pending = {
    accountId: "checking",
    date: "2026-10-09",
    amount: 0,
    allocations: [],
    isTransfer: false,
    isIncome: false,
  };
  const spend = (amount: number, ...lines: [string, number][]) => ({
    ...pending,
    amount,
    allocations: lines.map(([envelopeId, cents]) => ({ envelopeId, amount: cents })),
  });

  it("is empty for an uncategorized transaction", () => {
    expect(transactionShortfalls(household(), [{ ...pending, amount: -500 }])).toEqual([]);
  });

  it("covers a shortfall from Saved first, then reports what is still short", () => {
    // Food has 0 Remaining and 3,000 Saved in October.
    expect(transactionShortfalls(household(), [spend(-5_000, ["food", -5_000])])).toEqual([
      {
        envelopeId: "food",
        month: "2026-10",
        remainingAfter: -5_000,
        shortfall: 5_000,
        fromSaved: 3_000,
        stillShort: 2_000,
      },
    ]);
  });

  it("does not count the transaction being edited twice (empty: nothing goes negative)", () => {
    // g2 already spent 35,000 of Food; editing it to 34,000 frees 1,000.
    expect(
      transactionShortfalls(household(), [
        { ...spend(-34_000, ["food", -34_000]), id: "g2", date: "2026-10-03" },
      ]),
    ).toEqual([]);
  });

  it("checks each line of a split against its own envelope", () => {
    // Fun has 10,000: its 4,000 line fits; Food's 1,000 line is short.
    expect(
      transactionShortfalls(household(), [spend(-5_000, ["fun", -4_000], ["food", -1_000])]),
    ).toEqual([
      {
        envelopeId: "food",
        month: "2026-10",
        remainingAfter: -1_000,
        shortfall: 1_000,
        fromSaved: 1_000,
        stillShort: 0,
      },
    ]);
    const both = transactionShortfalls(household(), [
      spend(-17_000, ["fun", -12_000], ["food", -5_000]),
    ]);
    expect(both.map((s) => [s.envelopeId, s.shortfall])).toEqual([
      ["fun", 2_000],
      ["food", 5_000],
    ]);
  });

  it("never asks to cover a split refund", () => {
    expect(
      transactionShortfalls(household(), [spend(5_000, ["fun", 4_000], ["food", 1_000])]),
    ).toEqual([]);
  });
});

describe("budgetWith", () => {
  it("shows the budget as it would be after saving and covering", () => {
    const data = household();
    const split = {
      accountId: "checking",
      date: "2026-10-09",
      amount: -5_000,
      allocations: [
        { envelopeId: "fun", amount: -4_000 },
        { envelopeId: "food", amount: -1_000 },
      ],
      isTransfer: false,
      isIncome: false,
    };
    const before = buildBudgetMonth(data, "2026-10");
    const after = buildBudgetMonth(
      budgetWith(data, [split], [{ envelopeId: "food", month: "2026-10", assigned: 1_000 }]),
      "2026-10",
    );
    const remaining = (view: typeof before, id: string) =>
      view.groups[0]!.envelopes.find((e) => e.id === id)!.remaining;
    expect(remaining(after, "fun")).toBe(remaining(before, "fun") - 4_000);
    expect(remaining(after, "food")).toBe(0);
    expect(after.assignable).toBe(before.assignable - 1_000);
    // The original data is left alone.
    expect(data.transactions).toHaveLength(household().transactions.length);
  });
});

describe("withEnvelopeMonth", () => {
  const row = (data: BudgetData, id: string) =>
    buildBudgetMonth(data, "2026-10").groups[0]!.envelopes.find((e) => e.id === id)!;

  it("adds to Assigned or sets Planned on the month's record", () => {
    const data = household();
    const before = buildBudgetMonth(data, "2026-10");
    const assigned = withEnvelopeMonth(data, "food", "2026-10", { assigned: 2_500 });
    expect(row(assigned, "food")).toMatchObject({ assigned: 32_500, planned: 45_000 });
    expect(buildBudgetMonth(assigned, "2026-10").availableToAssign).toBe(
      before.availableToAssign - 2_500,
    );
    const planned = withEnvelopeMonth(data, "food", "2026-10", { planned: 1_000 });
    expect(row(planned, "food")).toMatchObject({ assigned: 30_000, planned: 1_000 });
    expect(buildBudgetMonth(planned, "2026-10").availableToAssign).toBe(before.availableToAssign);
    // The original data is left alone.
    expect(data.envelopeMonths).toEqual(household().envelopeMonths);
  });

  it("adds a record for a month that has none", () => {
    const data = withEnvelopeMonth(household(), "fun", "2026-11", { planned: 700 });
    const november = buildBudgetMonth(data, "2026-11").groups[0]!.envelopes[1]!;
    expect(november).toMatchObject({ id: "fun", planned: 700, assigned: 0 });
  });
});

describe("overPlan", () => {
  it("is Spent (as shown) above Planned; equal is within plan", () => {
    const data = household();
    // Food in October: Planned $450, Spent $350.
    const food = () =>
      buildBudgetMonth(data, "2026-10").groups[0]!.envelopes.find((e) => e.id === "food")!;
    expect(food()).toMatchObject({ outflow: 35_000, overPlan: false });
    data.envelopeMonths[1]!.planned = 35_000;
    expect(food().overPlan).toBe(false);
    data.envelopeMonths[1]!.planned = 34_999;
    expect(food().overPlan).toBe(true);
    // It is not overspending: nothing is short.
    expect(food().shortfall).toBe(0);
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
      { id: "trip", groupId: "extra", name: "Trip", position: 0, cardAccountId: null },
      { id: "gifts", groupId: "extra", name: "Gifts", position: 1, cardAccountId: null },
      { id: "new", groupId: "extra", name: "New", position: 2, cardAccountId: null },
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

describe("income and transactions to review", () => {
  // The fixture already has one outflow to review: the $20 "cash".
  const cash = { count: 1, inflow: 0, outflow: 2_000 };

  it("counts an inflow only once it is marked Income", () => {
    const data = household();
    const before = availableToAssignFor(data, "2026-10");
    data.transactions.push(
      tx({ id: "deposit", date: "2026-10-20", amount: 7_500, payee: "Deposit" }),
    );

    // Still to review: not in Available to Assign, listed for review.
    let view = buildBudgetMonth(data, "2026-10");
    expect(view.availableToAssign).toBe(before);
    expect(view.toReview).toEqual({ count: 2, inflow: 7_500, outflow: 2_000 });
    expect(view.income).toBe(200_000);

    // Marked Income: it counts, and shows in this month's income.
    data.transactions.find((t) => t.id === "deposit")!.isIncome = true;
    view = buildBudgetMonth(data, "2026-10");
    expect(view.availableToAssign).toBe(before + 7_500);
    expect(view.toReview).toEqual(cash);
    expect(view.income).toBe(207_500);
    expect(buildBudgetMonth(data, "2026-11").income).toBe(0);
  });

  it("does not change Available to Assign when spending to review gets an envelope", () => {
    const data = household();
    const before = availableToAssignFor(data, "2026-10");
    data.transactions.push(tx({ id: "shop", date: "2026-10-20", amount: -1_000 }));
    expect(availableToAssignFor(data, "2026-10")).toBe(before);

    // Given the Fun envelope ($100 Remaining): Fun pays, Available to Assign stays.
    data.transactions.find((t) => t.id === "shop")!.allocations = [
      { envelopeId: "fun", amount: -1_000 },
    ];
    const view = buildBudgetMonth(data, "2026-10");
    expect(view.availableToAssign).toBe(before);
    expect(view.groups[0]!.envelopes.find((e) => e.id === "fun")!.remaining).toBe(9_000);
  });

  it("lowers Available to Assign by exactly what is assigned to cover a shortfall", () => {
    const data = household();
    const before = availableToAssignFor(data, "2026-10");
    // A $150 purchase into Fun ($100 Remaining), covered with $50 from Available to Assign.
    data.transactions.push(
      tx({
        id: "big",
        date: "2026-10-20",
        amount: -15_000,
        allocations: [{ envelopeId: "fun", amount: -15_000 }],
      }),
    );
    data.envelopeMonths.find((r) => r.envelopeId === "fun" && r.month === "2026-10")!.assigned +=
      5_000;
    const view = buildBudgetMonth(data, "2026-10");
    expect(view.availableToAssign).toBe(before - 5_000);
    expect(view.groups[0]!.envelopes.find((e) => e.id === "fun")).toMatchObject({
      assigned: 15_000,
      remaining: 0,
    });
  });

  it("adds a refund in an envelope to that envelope only", () => {
    const data = household();
    const before = availableToAssignFor(data, "2026-10");
    data.transactions.push(
      tx({
        id: "refund",
        date: "2026-10-20",
        amount: 2_500,
        allocations: [{ envelopeId: "fun", amount: 2_500 }],
      }),
    );
    const view = buildBudgetMonth(data, "2026-10");
    expect(view.availableToAssign).toBe(before);
    // Fun spent nothing this month, so the refund shows as Refunded, not as Spent −$25.
    expect(view.groups[0]!.envelopes.find((e) => e.id === "fun")).toMatchObject({
      remaining: 12_500,
      spent: -2_500,
      outflow: 0,
      refunded: 2_500,
    });
    expect(
      transactionShortfalls(data, [
        {
          accountId: "checking",
          date: "2026-10-21",
          amount: 2_500,
          allocations: [{ envelopeId: "food", amount: 2_500 }],
          isTransfer: false,
          isIncome: false,
        },
      ]),
    ).toEqual([]); // a refund never needs covering, even into an empty envelope
  });

  it("keeps every dollar accounted for", () => {
    const data = household();
    data.transactions.push(
      tx({ id: "deposit", date: "2026-10-20", amount: 7_500 }),
      tx({ id: "gift", date: "2026-10-21", amount: 2_500, accountId: "savings" }),
      tx({ id: "shop", date: "2026-10-22", amount: -1_000 }),
    );
    const view = buildBudgetMonth(data, "2026-10");
    const balances = accountBalance("checking", data) + accountBalance("savings", data);
    const envelopeMoney = view.groups
      .flatMap((g) => g.envelopes)
      .reduce((sum, e) => sum + e.envelopeMoney, 0);
    expect(view.toReview).toEqual({ count: 4, inflow: 10_000, outflow: 3_000 });
    // Available + inflows to review − outflows to review = balances − envelope money
    expect(view.availableToAssign + view.toReview.inflow - view.toReview.outflow).toBe(
      balances - envelopeMoney,
    );
  });
});

describe("Spent and Refunded as shown", () => {
  it("lets a refund cancel out the month's spending first", () => {
    const data = household();
    data.envelopeMonths.push({
      envelopeId: "home",
      month: "2026-10",
      assigned: 11_709,
      released: 0,
      planned: 6_700,
    });
    data.envelopes.push({
      id: "home",
      groupId: "g",
      name: "Home",
      position: 2,
      cardAccountId: null,
    });
    const spend = (id: string, amount: number) =>
      tx({ id, date: "2026-10-12", amount, allocations: [{ envelopeId: "home", amount }] });
    data.transactions.push(
      spend("a", -6_793),
      spend("b", -1_862),
      spend("c", -7_788),
      spend("r", 4_734),
    );
    const home = buildBudgetMonth(data, "2026-10").groups[0]!.envelopes.find(
      (e) => e.id === "home",
    );
    // $164.43 bought − $47.34 refunded = $117.09 spent, matching Assigned.
    expect(home).toMatchObject({ assigned: 11_709, outflow: 11_709, refunded: 0, remaining: 0 });
  });
});
