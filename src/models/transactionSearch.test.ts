import { describe, expect, it } from "vitest";
import { accountHistory } from "./activity";
import {
  addFilter,
  amountQuery,
  filterFromValue,
  filterLabel,
  filterValue,
  findRows,
  foundTotal,
  regroupDays,
  searchChoices,
  sortRows,
  type FoundRow,
} from "./transactionSearch";
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

const transfer = (from: string, to: string, amount: number, date: string) => {
  const transferId = `x${++nextId}`;
  return [
    tx({ accountId: from, amount: -amount, date, isTransfer: true, transferId, payee: "Payment" }),
    tx({ accountId: to, amount, date, isTransfer: true, transferId, payee: "Payment" }),
  ];
};

const budget = (transactions: Transaction[]): BudgetData => ({
  household: { id: "h", name: "Home" },
  accounts: [
    account("checking", "Main Checking"),
    account("card", "Discover Card", { type: "credit_card" }),
  ],
  groups: [
    { id: "bills", name: "Bills", position: 1 },
    { id: "food", name: "Food", position: 0 },
  ],
  envelopes: [
    { id: "power", groupId: "bills", name: "Power", position: 0, cardAccountId: null },
    { id: "groceries", groupId: "food", name: "Groceries", position: 0, cardAccountId: null },
    { id: "dining", groupId: "food", name: "Dining out", position: 1, cardAccountId: null },
  ],
  envelopeMonths: [],
  transactions,
  incomeRules: [],
});

const to = (envelopeId: string, amount: number) => [{ envelopeId, amount }];

/** A checking account with one of each kind of row. */
const sample = () => {
  const data = budget([
    tx({ id: "pay", payee: "Paycheck", amount: 200_000, isIncome: true, date: "2026-10-01" }),
    tx({
      id: "kroger",
      payee: "Kroger",
      memo: "weekly shop",
      amount: -4_520,
      allocations: to("groceries", -4_520),
      date: "2026-10-03",
    }),
    tx({
      id: "costco",
      payee: "Costco",
      amount: -3_000,
      allocations: [
        { envelopeId: "groceries", amount: -1_000 },
        { envelopeId: "dining", amount: -2_000 },
      ],
      date: "2026-10-03",
    }),
    tx({ id: "refund", payee: "Kroger", amount: 500, allocations: to("groceries", 500) }),
    tx({ id: "mystery", payee: "Zelle", amount: -12_345, date: "2026-10-20" }),
    tx({
      id: "electric",
      payee: "Dominion",
      amount: -9_900,
      allocations: to("power", -9_900),
      date: "2026-09-28",
    }),
    ...transfer("checking", "card", 30_000, "2026-10-10"),
  ]);
  return { data, days: accountHistory(data, "checking") };
};

const ids = (found: FoundRow[]) => found.map((f) => f.row.tx.id);

describe("findRows", () => {
  it("keeps everything with no choice and nothing typed", () => {
    const { days } = sample();
    expect(findRows(days, [], "")).toHaveLength(7);
  });

  it("an envelope keeps only its transactions, counting only its part of a split", () => {
    const { days } = sample();
    const found = findRows(days, [{ envelopeId: "groceries" }], "");
    expect(ids(found).sort()).toEqual(["costco", "kroger", "refund"]);
    expect(found.find((f) => f.row.tx.id === "costco")!.amount).toBe(-1_000);
    expect(foundTotal(found)).toBe(-4_520 - 1_000 + 500);
  });

  it("kinds keep uncategorized, income and transfers", () => {
    const { days } = sample();
    expect(ids(findRows(days, [{ kind: "uncategorized" }], ""))).toEqual(["mystery"]);
    expect(ids(findRows(days, [{ kind: "income" }], ""))).toEqual(["pay"]);
    const transfers = findRows(days, [{ kind: "transfer" }], "");
    expect(transfers).toHaveLength(1);
    expect(transfers[0]!.amount).toBe(-30_000);
  });

  it("keeps card credits on a card", () => {
    const data = budget([
      tx({ id: "cashback", accountId: "card", amount: 2_500, payee: "Cashback" }),
      tx({ id: "buy", accountId: "card", amount: -2_500 }),
    ]);
    const found = findRows(accountHistory(data, "card"), [{ kind: "card-credit" }], "");
    expect(ids(found)).toEqual(["cashback"]);
  });

  it("typed words match payee, memo and a transfer's accounts, any case, all words", () => {
    const { days } = sample();
    expect(ids(findRows(days, [], "kroger")).sort()).toEqual(["kroger", "refund"]);
    expect(ids(findRows(days, [], "WEEKLY"))).toEqual(["kroger"]);
    expect(ids(findRows(days, [], "kroger weekly"))).toEqual(["kroger"]);
    expect(findRows(days, [], "discover")).toHaveLength(1);
    expect(findRows(days, [], "nothing like this")).toHaveLength(0);
  });

  it("combines a choice with typed text", () => {
    const { days } = sample();
    expect(ids(findRows(days, [{ envelopeId: "groceries" }], "costco"))).toEqual(["costco"]);
  });

  it("matches amounts, in or out, including a split's parts", () => {
    const { days } = sample();
    expect(ids(findRows(days, [], "45.20"))).toEqual(["kroger"]);
    expect(ids(findRows(days, [], "$45.2"))).toEqual(["kroger"]);
    expect(ids(findRows(days, [], "2000"))).toEqual(["pay"]);
    expect(ids(findRows(days, [], "20"))).toEqual(["costco"]);
  });
});

describe("amountQuery", () => {
  it("whole dollars match any cents, one decimal any last digit, two (or $) exactly", () => {
    const dollars = amountQuery("45")!;
    expect([dollars(4_500), dollars(-4_599), dollars(450_00)]).toEqual([true, true, false]);
    const dimes = amountQuery("45.2")!;
    expect([dimes(4_520), dimes(4_529), dimes(4_530)]).toEqual([true, true, false]);
    expect(amountQuery("45.20")!(4_521)).toBe(false);
    expect(amountQuery("$45")!(4_550)).toBe(false);
    expect(amountQuery("$45")!(-4_500)).toBe(true);
    expect(amountQuery("1,204.18")!(120_418)).toBe(true);
    expect(amountQuery("-12")!(1_250)).toBe(true);
  });

  it("is null for words", () => {
    expect(amountQuery("7-Eleven")).toBeNull();
    expect(amountQuery("$")).toBeNull();
    expect(amountQuery("")).toBeNull();
  });
});

describe("sortRows", () => {
  const found = () => findRows(sample().days, [], "");

  it("orders by date either way", () => {
    const newest = sortRows(found(), "newest");
    expect(newest[0]!.row.tx.id).toBe("mystery");
    expect(sortRows(found(), "oldest")[0]!.row.tx.id).toBe("electric");
  });

  it("orders by size, ignoring sign", () => {
    expect(ids(sortRows(found(), "amount-large")).slice(0, 2)).toEqual(["pay", expect.any(String)]);
    expect(sortRows(found(), "amount-large")[1]!.row.kind).toBe("transfer");
    expect(sortRows(found(), "amount-small")[0]!.row.tx.id).toBe("refund");
  });

  it("orders by payee and by envelope, ties newest first", () => {
    const byPayee = sortRows(found(), "payee").map((f) => f.row.tx.payee);
    expect(byPayee).toEqual([
      "Costco",
      "Dominion",
      "Kroger",
      "Kroger",
      "Paycheck",
      "Payment",
      "Zelle",
    ]);
    expect(sortRows(found(), "payee")[2]!.row.tx.id).toBe("refund");
    const byEnvelope = sortRows(found(), "envelope").map((f) => f.row.tx.id);
    expect(byEnvelope).toEqual([
      "refund",
      "kroger",
      "costco",
      "pay",
      "electric",
      expect.any(String),
      "mystery",
    ]);
  });
});

describe("regroupDays", () => {
  it("puts rows back under their days, nets from the matched parts without transfers", () => {
    const days = regroupDays(findRows(sample().days, [], ""));
    expect(days.map((d) => d.date)).toEqual([
      "2026-10-20",
      "2026-10-15",
      "2026-10-10",
      "2026-10-03",
      "2026-10-01",
      "2026-09-28",
    ]);
    expect(days.find((d) => d.date === "2026-10-10")!.net).toBe(0);
    const groceries = regroupDays(findRows(sample().days, [{ envelopeId: "groceries" }], ""));
    expect(groceries.find((d) => d.date === "2026-10-03")!.net).toBe(-4_520 - 1_000);
  });
});

describe("searchChoices", () => {
  it("offers kinds then envelopes by group, with counts, leaving out what keeps nothing", () => {
    const { data, days } = sample();
    expect(searchChoices(days, data)).toEqual([
      { value: "kind:uncategorized", label: "Uncategorized", detail: "1 transaction" },
      { value: "kind:income", label: "Income", detail: "1 transaction" },
      { value: "kind:transfer", label: "Transfer", detail: "1 transaction" },
      { value: "kind:not-reconciled", label: "Not reconciled", detail: "7 transactions" },
      {
        value: "envelope:groceries",
        label: "Groceries",
        group: "Food",
        detail: "3 transactions",
      },
      { value: "envelope:dining", label: "Dining out", group: "Food", detail: "1 transaction" },
      { value: "envelope:power", label: "Power", group: "Bills", detail: "1 transaction" },
    ]);
  });
});

describe("stacking chips", () => {
  /** The sample with Kroger, Zelle and the transfer marked reconciled. */
  const reconciledSample = () => {
    const { data } = sample();
    const marked = new Set(["kroger", "mystery"]);
    const transactions = data.transactions.map((t) =>
      marked.has(t.id) || t.isTransfer ? { ...t, reconciled: true } : t,
    );
    const next = { ...data, transactions };
    return { data: next, days: accountHistory(next, "checking") };
  };

  it("Not reconciled keeps rows not marked, and stacks with an envelope or kind", () => {
    const { days } = reconciledSample();
    expect(ids(findRows(days, [{ kind: "not-reconciled" }], "")).sort()).toEqual([
      "costco",
      "electric",
      "pay",
      "refund",
    ]);
    const groceries = findRows(days, [{ envelopeId: "groceries" }, { kind: "not-reconciled" }], "");
    expect(ids(groceries).sort()).toEqual(["costco", "refund"]);
    expect(foundTotal(groceries)).toBe(-1_000 + 500);
    expect(findRows(days, [{ kind: "uncategorized" }, { kind: "not-reconciled" }], "")).toEqual([]);
  });

  it("a new choice replaces the chip of its group, what a row is first", () => {
    const groceries = { envelopeId: "groceries" };
    const notReconciled = { kind: "not-reconciled" as const };
    expect(addFilter([notReconciled], groceries)).toEqual([groceries, notReconciled]);
    expect(addFilter([groceries, notReconciled], { kind: "uncategorized" })).toEqual([
      { kind: "uncategorized" },
      notReconciled,
    ]);
    expect(addFilter([groceries], notReconciled)).toEqual([groceries, notReconciled]);
  });

  it("choices count alongside the other group's chip and leave out the chosen", () => {
    const { data, days } = reconciledSample();
    const choices = searchChoices(days, data, [{ kind: "not-reconciled" }]);
    expect(choices.map((c) => `${c.label}: ${c.detail}`)).toEqual([
      "Income: 1 transaction",
      "Groceries: 2 transactions",
      "Dining out: 1 transaction",
      "Power: 1 transaction",
    ]);
  });
});

describe("filter values and labels", () => {
  it("round-trips and names a choice", () => {
    const { data } = sample();
    for (const filter of [{ envelopeId: "groceries" }, { kind: "card-credit" as const }])
      expect(filterFromValue(filterValue(filter))).toEqual(filter);
    expect(filterFromValue("kind:nope")).toBeNull();
    expect(filterLabel({ envelopeId: "dining" }, data)).toBe("Dining out");
    expect(filterLabel({ kind: "income" }, data)).toBe("Income");
  });
});
