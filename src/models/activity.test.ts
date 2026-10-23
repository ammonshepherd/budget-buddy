import { describe, expect, it } from "vitest";
import {
  accountFigures,
  accountHistory,
  activityBalance,
  activityMonth,
  daysByMonth,
  firstRows,
  selectionTotal,
  type ActivityDay,
} from "./activity";
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
  reconciled: false,
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
    expect(totals).toEqual({ moneyIn: 245_500, moneyOut: 12_760 });
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
    expect(month.totals).toEqual({ moneyIn: 0, moneyOut: 300 });
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
      totals: { moneyIn: 0, moneyOut: 0 },
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
      amount: -30_000,
      accountLine: "Main Checking → Discover Card",
      category: "Transfer",
    });
  });

  it("signs a transfer by its side in the account shown", () => {
    const data = budget(transfer("checking", "card", 30_000));
    const amounts = (id: string | null) =>
      activityMonth(data, "2026-10", id).days.flatMap((d) => d.rows.map((r) => r.amount));
    expect(amounts(null)).toEqual([-30_000]);
    expect(amounts("checking")).toEqual([-30_000]);
    expect(amounts("card")).toEqual([30_000]);
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

  it("shows whether a row is reconciled, imported or not", () => {
    const rows = rowsOf([
      tx({ importKey: "bank-1", reconciled: true }),
      tx({ importKey: "bank-2" }),
    ]);
    expect(rows.map((r) => r.reconciled)).toEqual([true, false]);
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
    // In one account, transfers count like the bank shows them.
    expect(activityMonth(data, "2026-10", "card").totals).toEqual({
      moneyIn: 30_000,
      moneyOut: 500,
    });
    // A transfer into the account shows too, from its money-out side.
    const checking = activityMonth(data, "2026-10", "checking");
    expect(checking.days.flatMap((d) => d.rows.map((r) => r.accountLine))).toEqual([
      "Main Checking",
      "Main Checking",
      "Main Checking → Discover Card",
      "Savings → Main Checking",
    ]);
    expect(checking.totals).toEqual({ moneyIn: 107_000, moneyOut: 32_000 });
    expect(checking.days[0]!.net).toBe(75_000);
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

describe("ticking rows for reconciling", () => {
  const rowsIn = (data: BudgetData, accountId: string | null) =>
    activityMonth(data, "2026-10", accountId).days.flatMap((d) => d.rows);

  it("stands for the transaction itself, or a transfer's side in the account shown", () => {
    const [out, into] = transfer("checking", "card", 30_000);
    const data = budget([out!, into!, tx({ id: "shop", amount: -2_000 })]);

    const all = rowsIn(data, null);
    expect(all.map((r) => [r.sideIds, r.sideAmount])).toEqual([
      [[out!.id, into!.id], 0],
      [["shop"], -2_000],
    ]);
    const card = rowsIn(data, "card");
    expect(card.map((r) => [r.sideIds, r.sideAmount])).toEqual([[[into!.id], 30_000]]);
    expect(rowsIn(data, "checking")[0]).toMatchObject({ sideIds: [out!.id], sideAmount: -30_000 });
  });

  it("leaves out a transfer side in an off-budget account", () => {
    const accounts = [
      account("checking", "Main Checking"),
      account("loan", "Loan", { onBudget: false }),
    ];
    const [out, into] = transfer("checking", "loan", 10_000);
    const [row] = rowsIn(budget([out!, into!], accounts), null);
    expect(row).toMatchObject({ sideIds: [out!.id], sideAmount: -10_000 });
  });

  it("counts a transfer reconciled only when every side it stands for is", () => {
    const [out, into] = transfer("checking", "card", 30_000);
    const data = budget([{ ...out!, reconciled: true }, into!]);
    expect(rowsIn(data, null)[0]!.reconciled).toBe(false);
    expect(rowsIn(data, "checking")[0]!.reconciled).toBe(true);
    expect(rowsIn(data, "card")[0]!.reconciled).toBe(false);
  });

  it("adds up the ticked rows, signed", () => {
    const data = budget([
      tx({ id: "a", amount: -2_000 }),
      tx({ id: "b", amount: 50_000 }),
      tx({ id: "c", amount: -700 }),
      ...transfer("checking", "card", 30_000),
    ]);
    const rows = rowsIn(data, null);
    const transferRow = rows.find((r) => r.kind === "transfer")!;
    expect(selectionTotal(rows, new Set(["a", "b", transferRow.tx.id]))).toBe(48_000);
    expect(selectionTotal(rows, new Set())).toBe(0);
    expect(selectionTotal(rowsIn(data, "checking"), new Set([transferRow.tx.id]))).toBe(-30_000);
  });
});

describe("activityBalance", () => {
  const accounts = [
    account("checking", "Main Checking", { openingBalance: 100_000 }),
    account("card", "Discover Card", { type: "credit_card", openingBalance: -20_000 }),
    account("offbudget", "Mortgage", { onBudget: false, openingBalance: -9_000_000 }),
  ];
  const data = budget(
    [
      tx({ amount: -5_000, date: "2026-10-10", reconciled: true }),
      tx({ amount: -1_000, date: "2026-10-18" }),
      tx({ amount: -3_000, date: "2026-10-25" }), // after today
      tx({ amount: -400, voided: true }),
      tx({ accountId: "card", amount: -2_500, date: "2026-10-12", reconciled: true }),
      ...transfer("checking", "card", 10_000, "2026-10-15"),
    ],
    accounts,
  );

  it("is one account's balance today, plus its reconciled balance", () => {
    expect(activityBalance(data, "checking", "2026-10-19")).toEqual({
      today: 100_000 - 5_000 - 1_000 - 10_000,
      reconciled: 100_000 - 5_000,
      cash: 84_000,
      cardsOwe: 0,
      hasCards: false,
    });
    expect(activityBalance(data, "card", "2026-10-19")).toMatchObject({
      today: -20_000 - 2_500 + 10_000,
      reconciled: -22_500,
      cardsOwe: 12_500,
      hasCards: true,
    });
  });

  it("adds up every budget account: cash minus what the cards owe", () => {
    expect(activityBalance(data, null, "2026-10-19")).toMatchObject({
      today: 84_000 - 12_500,
      cash: 84_000,
      cardsOwe: 12_500,
      hasCards: true,
    });
  });

  it("counts a future-dated transaction once its day comes", () => {
    expect(activityBalance(data, "checking", "2026-10-25").today).toBe(81_000);
  });
});

describe("accountFigures", () => {
  const data = budget(
    [
      tx({ date: "2026-11-02", amount: -2_000, allocations: groceries(-2_000) }),
      tx({ date: "2026-10-20", amount: 300_000, isIncome: true, reconciled: true }),
      tx({ date: "2026-10-18", amount: 1_500, allocations: groceries(1_500) }), // a refund
      tx({
        date: "2026-10-10",
        amount: -9_000,
        allocations: [
          { envelopeId: "groceries", amount: -4_000 },
          { envelopeId: "kids", amount: -5_000 },
        ],
      }),
      ...transfer("checking", "card", 25_000, "2026-10-05"), // a card payment
      tx({ date: "2026-10-03", amount: -700, voided: true }),
      tx({ date: "2026-09-30", amount: -1_000, reconciled: true }),
    ],
    [
      account("checking", "Main Checking", { openingBalance: 100_000 }),
      account("card", "Discover Card", { type: "credit_card", openingBalance: -40_000 }),
    ],
  );

  it("shows the current, month start, opening and reconciled balances", () => {
    expect(accountFigures(data, "checking", "2026-10")).toMatchObject({
      current: 100_000 - 2_000 + 300_000 + 1_500 - 9_000 - 25_000 - 1_000,
      monthStart: 100_000 - 1_000,
      opening: 100_000,
      reconciled: 100_000 + 300_000 - 1_000,
    });
  });

  it("leaves transfers out of money in and out, and counts a split once", () => {
    expect(accountFigures(data, "checking", "2026-10")).toMatchObject({
      moneyIn: 301_500,
      moneyOut: 9_000,
    });
    // On the card the payment is a transfer too: nothing in or out.
    expect(accountFigures(data, "card", "2026-10")).toMatchObject({
      moneyIn: 0,
      moneyOut: 0,
      opening: -40_000,
      current: -15_000,
    });
  });

  it("gives a card's extra paid for the month, and none for other accounts", () => {
    expect(accountFigures(data, "checking", "2026-10").extraPaid).toBeNull();
    // This household's card has no payment envelope, so nothing counts as extra.
    expect(accountFigures(data, "card", "2026-10").extraPaid).toBe(0);
  });

  it("adds a month's net activity to its start to give the next month's start", () => {
    for (const month of ["2026-09", "2026-10", "2026-11"]) {
      const next = `${month.slice(0, 5)}${String(Number(month.slice(5)) + 1).padStart(2, "0")}`;
      const net = data.transactions
        .filter((t) => t.accountId === "checking" && !t.voided && t.date.startsWith(month))
        .reduce((sum, t) => sum + t.amount, 0);
      expect(accountFigures(data, "checking", next).monthStart).toBe(
        accountFigures(data, "checking", month).monthStart + net,
      );
    }
  });
});

describe("accountHistory", () => {
  const data = budget([
    tx({ id: "nov", date: "2026-11-02", amount: -2_000 }),
    tx({ id: "oct", date: "2026-10-20", amount: 5_000, isIncome: true }),
    ...transfer("checking", "card", 25_000, "2026-10-20"),
    tx({ id: "card", accountId: "card", date: "2026-10-19", amount: -3_000 }),
    tx({ id: "gone", date: "2026-09-01", amount: -700, voided: true }),
    tx({ id: "sep", date: "2026-09-01", amount: -1_000 }),
  ]);

  it("lists the account's transactions from every month, newest first", () => {
    const days = accountHistory(data, "checking");
    expect(days.map((d) => d.date)).toEqual(["2026-11-02", "2026-10-20", "2026-09-01"]);
    expect(days.flatMap((d) => d.rows.map((r) => r.tx.id))).toEqual([
      "nov",
      "oct",
      expect.any(String),
      "sep",
    ]);
  });

  it("lists card payments on both sides, with each side's sign, and leaves them out of day nets", () => {
    const [payment] = accountHistory(data, "card")
      .flatMap((d) => d.rows)
      .filter((r) => r.kind === "transfer");
    expect(payment).toMatchObject({ amount: 25_000, accountLine: "Main Checking → Discover Card" });
    // The row edits the money-out side, as on All accounts.
    expect(payment!.tx.accountId).toBe("checking");
    const checking = accountHistory(data, "checking");
    expect(checking[1]!.rows.find((r) => r.kind === "transfer")!.amount).toBe(-25_000);
    expect(checking[1]!.net).toBe(5_000);
  });
});

describe("firstRows", () => {
  const day = (date: string, count: number): ActivityDay => ({
    date,
    net: -count * 100,
    rows: Array.from({ length: count }, () => ({
      tx: tx({ date }),
      kind: "out",
      amount: -100,
      accountLine: "Main Checking",
      category: "Uncategorized",
      toReview: true,
      portions: [],
      sideIds: [],
      sideAmount: -100,
      reconciled: false,
    })),
  });
  const days = [day("2026-10-03", 60), day("2026-10-02", 60), day("2026-10-01", 120)];

  it("shows the first rows, cutting a day short but keeping its full net", () => {
    const page = firstRows(days, 100);
    expect(page).toMatchObject({ shown: 100, total: 240 });
    expect(page.days.map((d) => d.rows.length)).toEqual([60, 40]);
    expect(page.days[1]!.net).toBe(-6_000);
  });

  it("continues a cut day under the same heading, with no rows repeated or skipped", () => {
    const first = firstRows(days, 100).days.flatMap((d) => d.rows);
    const more = firstRows(days, 200);
    expect(more.days.map((d) => d.date)).toEqual(["2026-10-03", "2026-10-02", "2026-10-01"]);
    const rows = more.days.flatMap((d) => d.rows);
    expect(rows.slice(0, 100)).toEqual(first);
    expect(new Set(rows).size).toBe(200);
    expect(firstRows(days, 300)).toMatchObject({ shown: 240, total: 240 });
  });

  it("keeps a split's parts with it: a split is one row", () => {
    const split = day("2026-10-01", 1);
    split.rows[0]!.portions = [
      { envelopeId: "kids", envelopeName: "Kids", amount: -40 },
      { envelopeId: "groceries", envelopeName: "Groceries", amount: -60 },
    ];
    const page = firstRows([day("2026-10-02", 99), split], 100);
    expect(page.days[1]!.rows[0]!.portions).toHaveLength(2);
  });
});

describe("daysByMonth", () => {
  it("puts days under their month, newest first", () => {
    const days = ["2026-11-02", "2026-10-20", "2026-10-01", "2025-12-12"].map((date) => ({
      date,
      net: 0,
      rows: [],
    }));
    expect(daysByMonth(days).map((m) => [m.month, m.days.length])).toEqual([
      ["2026-11", 1],
      ["2026-10", 2],
      ["2025-12", 1],
    ]);
  });
});
