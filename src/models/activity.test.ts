import { describe, expect, it } from "vitest";
import { activityAccounts, activityMonth } from "./activity";
import { transactionsToReview } from "./budgetMath";
import type { Account, BudgetData, Transaction } from "./types";

const account = (id: string, name: string, extra: Partial<Account> = {}): Account => ({
  id,
  name,
  type: "checking",
  openingBalance: 0,
  openingDate: "2026-01-01",
  onBudget: true,
  closedAt: null,
  importFormat: null,
  ...extra,
});

let nextId = 0;
const tx = (partial: Partial<Transaction>): Transaction => ({
  id: `t${++nextId}`,
  accountId: "checking",
  date: "2026-10-15",
  amount: -1_000,
  payee: "Shop",
  memo: "",
  isTransfer: false,
  isIncome: false,
  transferId: null,
  voided: false,
  allocations: [],
  importKey: null,
  ...partial,
});

/** Both sides of a transfer of `amount` cents from one account to another. */
const transfer = (from: string, to: string, amount: number, date = "2026-10-15") => {
  const transferId = `x${++nextId}`;
  return [
    tx({ accountId: from, amount: -amount, date, isTransfer: true, transferId, payee: "Payment" }),
    tx({ accountId: to, amount, date, isTransfer: true, transferId, payee: "Payment" }),
  ];
};

const budget = (transactions: Transaction[], accounts?: Account[]): BudgetData => ({
  household: { id: "h", name: "Home" },
  accounts: accounts ?? [
    account("checking", "Main Checking"),
    account("card", "Discover Card", { type: "credit_card" }),
  ],
  groups: [{ id: "g", name: "Everyday", position: 0 }],
  envelopes: [
    { id: "groceries", groupId: "g", name: "Groceries", position: 0, cardAccountId: null },
    { id: "kids", groupId: "g", name: "Kids", position: 1, cardAccountId: null },
  ],
  envelopeMonths: [],
  transactions,
  incomeRules: [],
});

const groceries = (amount: number) => [{ envelopeId: "groceries", amount }];

describe("activityMonth totals", () => {
  it("adds inflows to In, outflows to Out and leaves transfers out of both", () => {
    const { totals } = activityMonth(
      budget([
        tx({ amount: 245_000, isIncome: true }),
        tx({ amount: 500, allocations: groceries(500) }), // a refund
        tx({ amount: -8_642, allocations: groceries(-8_642) }),
        tx({ accountId: "card", amount: -4_118 }), // a card purchase to review
        ...transfer("checking", "card", 30_000), // a card payment
      ]),
      "2026-10",
    );
    expect(totals).toEqual({ moneyIn: 245_500, moneyOut: 12_760, transfers: 30_000 });
  });

  it("counts a split once, at its full amount", () => {
    const split = tx({
      amount: -14_213,
      allocations: [
        { envelopeId: "kids", amount: -6_857 },
        { envelopeId: "groceries", amount: -7_356 },
      ],
    });
    expect(activityMonth(budget([split]), "2026-10").totals.moneyOut).toBe(14_213);
  });

  it("leaves out off-budget (tracking) accounts and voided transactions", () => {
    const accounts = [
      account("checking", "Main Checking"),
      account("tracking", "Brokerage", { onBudget: false }),
    ];
    const month = activityMonth(
      budget(
        [
          tx({ accountId: "tracking", amount: 99_900, isIncome: true }),
          tx({ amount: -2_000, voided: true }),
          tx({ amount: -300 }),
        ],
        accounts,
      ),
      "2026-10",
    );
    expect(month.totals).toEqual({ moneyIn: 0, moneyOut: 300, transfers: 0 });
    expect(month.days.flatMap((d) => d.rows)).toHaveLength(1);
  });

  it("goes by transaction date, also at month boundaries", () => {
    const data = budget([
      tx({ date: "2026-11-01", amount: -100 }),
      tx({ date: "2026-10-31", amount: -200 }),
      tx({ date: "2026-10-01", amount: -400 }),
      tx({ date: "2026-09-30", amount: -800 }),
    ]);
    const october = activityMonth(data, "2026-10");
    expect(october.totals.moneyOut).toBe(600);
    expect(october.days.map((d) => d.date)).toEqual(["2026-10-31", "2026-10-01"]);
    expect(activityMonth(data, "2026-11").totals.moneyOut).toBe(100);
  });

  it("is all zero for an empty month", () => {
    expect(activityMonth(budget([tx({ date: "2026-09-01" })]), "2026-10")).toEqual({
      totals: { moneyIn: 0, moneyOut: 0, transfers: 0 },
      days: [],
    });
  });
});

describe("activityMonth days", () => {
  it("lists days newest first, keeping the data's order within a day", () => {
    const { days } = activityMonth(
      budget([
        tx({ date: "2026-10-14", payee: "B" }),
        tx({ date: "2026-10-15", payee: "A" }),
        tx({ date: "2026-10-14", payee: "C" }),
      ]),
      "2026-10",
    );
    expect(days.map((d) => [d.date, d.rows.map((r) => r.tx.payee)])).toEqual([
      ["2026-10-15", ["A"]],
      ["2026-10-14", ["B", "C"]],
    ]);
  });

  it("nets each day's amounts without transfers", () => {
    const { days } = activityMonth(
      budget([
        tx({ amount: 245_000, isIncome: true }),
        tx({ amount: -14_213 }),
        ...transfer("checking", "card", 30_000),
      ]),
      "2026-10",
    );
    expect(days[0]!.net).toBe(230_787);
  });

  it("nets a day with only transfers to zero", () => {
    const { days } = activityMonth(budget(transfer("checking", "card", 30_000)), "2026-10");
    expect(days[0]!.net).toBe(0);
  });
});

describe("activity rows", () => {
  const rowsOf = (transactions: Transaction[], accounts?: Account[]) =>
    activityMonth(budget(transactions, accounts), "2026-10").days.flatMap((d) => d.rows);

  it("shows a transfer once, from its money-out side, as From → To", () => {
    const [out, into] = transfer("checking", "card", 30_000);
    const rows = rowsOf([into!, out!]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tx: { id: out!.id },
      kind: "transfer",
      amount: 30_000,
      accountLine: "Main Checking → Discover Card",
      category: "Transfer",
    });
  });

  it("names envelopes, Income, card credits and Uncategorized", () => {
    const rows = rowsOf([
      tx({ amount: -8_642, allocations: groceries(-8_642) }),
      tx({ amount: 245_000, isIncome: true }),
      tx({ accountId: "card", amount: 1_500 }),
      tx({ amount: -2_367 }),
    ]);
    expect(rows.map((r) => [r.category, r.kind, r.toReview])).toEqual([
      ["Groceries", "out", false],
      ["Income", "in", false],
      ["Card credit", "in", false],
      ["Uncategorized", "out", true],
    ]);
  });

  it("lists a split's portions, which add up to its amount", () => {
    const [row] = rowsOf([
      tx({
        amount: -14_213,
        allocations: [
          { envelopeId: "kids", amount: -6_857 },
          { envelopeId: "groceries", amount: -7_356 },
        ],
      }),
    ]);
    expect(row!.category).toBe("");
    expect(row!.portions).toEqual([
      { envelopeId: "kids", envelopeName: "Kids", amount: -6_857 },
      { envelopeId: "groceries", envelopeName: "Groceries", amount: -7_356 },
    ]);
  });

  it("marks imported rows cleared and typed ones uncleared", () => {
    const rows = rowsOf([tx({ importKey: "bank-1" }), tx({})]);
    expect(rows.map((r) => r.status)).toEqual(["cleared", "uncleared"]);
  });

  it("still names a closed account", () => {
    const accounts = [account("checking", "Old Checking", { closedAt: "2026-10-20T00:00:00Z" })];
    expect(rowsOf([tx({})], accounts)[0]!.accountLine).toBe("Old Checking");
  });
});

describe("one account's activity", () => {
  const savings = account("savings", "Savings");
  const accounts = [
    account("checking", "Main Checking"),
    account("card", "Discover Card", { type: "credit_card" }),
    savings,
    account("old", "Old Checking", { closedAt: "2026-09-01T00:00:00Z" }),
    account("offbudget", "Mortgage", { onBudget: false }),
  ];

  it("offers budget accounts, open ones first, then closed", () => {
    expect(activityAccounts(budget([], accounts))).toEqual([
      { id: "card", name: "Discover Card", closed: false },
      { id: "checking", name: "Main Checking", closed: false },
      { id: "savings", name: "Savings", closed: false },
      { id: "old", name: "Old Checking", closed: true },
    ]);
  });

  it("shows only that account's transactions and transfers to or from it", () => {
    const data = budget(
      [
        tx({ amount: -2_000, payee: "Grocer" }),
        tx({ accountId: "card", amount: -500, payee: "Cafe" }),
        tx({ amount: 100_000, isIncome: true, payee: "Pay" }),
        ...transfer("checking", "card", 30_000),
        ...transfer("savings", "checking", 7_000),
      ],
      accounts,
    );
    const payees = (id: string | null) =>
      activityMonth(data, "2026-10", id).days.flatMap((d) => d.rows.map((r) => r.tx.payee));

    expect(payees("card")).toEqual(["Cafe", "Payment"]);
    expect(activityMonth(data, "2026-10", "card").totals).toEqual({
      moneyIn: 0,
      moneyOut: 500,
      transfers: 30_000,
    });
    // A transfer into the account shows too, from its money-out side.
    const checking = activityMonth(data, "2026-10", "checking");
    expect(checking.days.flatMap((d) => d.rows.map((r) => r.accountLine))).toEqual([
      "Main Checking",
      "Main Checking",
      "Main Checking → Discover Card",
      "Savings → Main Checking",
    ]);
    expect(checking.totals).toEqual({ moneyIn: 100_000, moneyOut: 2_000, transfers: 37_000 });
    expect(payees(null)).toHaveLength(5);
  });

  it("narrows the transactions to review to the account", () => {
    const data = budget(
      [tx({ amount: -2_000 }), tx({ amount: 5_000 }), tx({ accountId: "card", amount: -500 })],
      accounts,
    );
    expect(transactionsToReview(data, "checking")).toMatchObject({
      count: 2,
      inflow: 5_000,
      outflow: 2_000,
    });
    expect(transactionsToReview(data, "card")).toMatchObject({ count: 1, outflow: 500 });
    expect(transactionsToReview(data).count).toBe(3);
  });
});
