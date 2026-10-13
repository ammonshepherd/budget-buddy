import { describe, expect, it } from "vitest";
import {
  accountBalance,
  availableToAssignFor,
  buildBudgetMonth,
  checkTransactionSpend,
  type BudgetMonthView,
} from "./budgetMath";
import type { BudgetData, Transaction } from "./types";

const M = "2026-10";

function tx(partial: Partial<Transaction> & Pick<Transaction, "id" | "amount">): Transaction {
  return {
    accountId: "checking",
    date: "2026-10-05",
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

/** $10,000 in checking and a Visa added owing $12,000 (the write-up's example). */
function household(): BudgetData {
  return {
    household: { id: "h", name: "Home" },
    incomeRules: [],
    accounts: [
      {
        id: "checking",
        name: "Checking",
        type: "checking",
        openingBalance: 1_000_000,
        openingDate: "2026-10-01",
        onBudget: true,
        closedAt: null,
        importFormat: null,
      },
      {
        id: "visa",
        name: "Visa",
        type: "credit_card",
        openingBalance: -1_200_000,
        openingDate: "2026-10-01",
        onBudget: true,
        closedAt: null,
        importFormat: null,
      },
    ],
    groups: [
      { id: "g", name: "Everyday", position: 0 },
      { id: "cards", name: "Credit card payments", position: 1 },
    ],
    envelopes: [
      { id: "groceries", groupId: "g", name: "Groceries", position: 0, cardAccountId: null },
      { id: "fun", groupId: "g", name: "Fun", position: 1, cardAccountId: null },
      {
        id: "visa-pay",
        groupId: "cards",
        name: "Visa payment",
        position: 0,
        cardAccountId: "visa",
      },
    ],
    envelopeMonths: [],
    transactions: [],
  };
}

const assign = (data: BudgetData, envelopeId: string, assigned: number, released = 0) =>
  data.envelopeMonths.push({ envelopeId, month: M, assigned, released, planned: 0 });

const row = (view: BudgetMonthView, id: string) =>
  view.groups.flatMap((g) => g.envelopes).find((e) => e.id === id)!;

/** The rule from CLAUDE.md: non-card budget balances − all envelope money. */
function expectIdentity(data: BudgetData) {
  const view = buildBudgetMonth(data, M);
  const cash = accountBalance("checking", data);
  const envelopeMoney = view.groups
    .flatMap((g) => g.envelopes)
    .reduce((sum, e) => sum + e.envelopeMoney, 0);
  expect(view.availableToAssign).toBe(cash - envelopeMoney);
  return view;
}

describe("card-payment envelope", () => {
  it("follows the worked example step by step", () => {
    const data = household();

    // 1. Adding the card: the debt does not lower Available to Assign.
    let view = expectIdentity(data);
    expect(view.availableToAssign).toBe(1_000_000);
    expect(row(view, "visa-pay").card).toEqual({
      accountId: "visa",
      open: true,
      owed: 1_200_000,
      uncovered: 1_200_000,
    });

    // 2. Assign $400 to Groceries.
    assign(data, "groceries", 40_000);
    expect(expectIdentity(data).availableToAssign).toBe(960_000);

    // 3. $50 of groceries on the Visa moves $50 into Visa payment.
    data.transactions.push(
      tx({
        id: "buy",
        accountId: "visa",
        amount: -5_000,
        allocations: [{ envelopeId: "groceries", amount: -5_000 }],
      }),
    );
    view = expectIdentity(data);
    expect(view.availableToAssign).toBe(960_000);
    expect(row(view, "groceries").remaining).toBe(35_000);
    expect(row(view, "visa-pay")).toMatchObject({
      remaining: 5_000,
      card: { owed: 1_205_000, uncovered: 1_200_000 },
    });

    // 4. $20 left Uncategorized on the Visa comes from Available to Assign.
    data.transactions.push(tx({ id: "uncat", accountId: "visa", amount: -2_000 }));
    view = expectIdentity(data);
    expect(view.availableToAssign).toBe(958_000);
    expect(row(view, "visa-pay").remaining).toBe(7_000);

    // 5. Assign $1,000 to Visa payment.
    assign(data, "visa-pay", 100_000);
    view = expectIdentity(data);
    expect(view.availableToAssign).toBe(858_000);
    expect(row(view, "visa-pay").card!.uncovered).toBe(1_100_000);

    // 6. Pay $1,070 from checking: a Transfer on both accounts.
    data.transactions.push(
      tx({ id: "pay-out", amount: -107_000, isTransfer: true }),
      tx({ id: "pay-in", accountId: "visa", amount: 107_000, isTransfer: true }),
    );
    view = expectIdentity(data);
    expect(view.availableToAssign).toBe(858_000);
    expect(accountBalance("checking", data)).toBe(893_000);
    expect(row(view, "visa-pay")).toMatchObject({
      remaining: 0,
      card: { owed: 1_100_000, uncovered: 1_100_000 },
    });
  });

  it("does not count card purchases moving in as Spent in the month's totals", () => {
    const data = household();
    assign(data, "groceries", 10_000);
    data.transactions.push(
      tx({
        id: "buy",
        accountId: "visa",
        amount: -5_000,
        allocations: [{ envelopeId: "groceries", amount: -5_000 }],
      }),
    );
    expect(buildBudgetMonth(data, M).totals.spent).toBe(5_000);
  });

  it("leaves a card refund still to review out of both Available and the envelope", () => {
    const data = household();
    data.transactions.push(
      tx({ id: "uncat", accountId: "visa", amount: -3_000 }),
      tx({ id: "refund", accountId: "visa", amount: 5_000 }),
    );
    const view = buildBudgetMonth(data, M);
    expect(view.availableToAssign).toBe(1_000_000 - 3_000);
    expect(row(view, "visa-pay").remaining).toBe(3_000);
    expect(row(view, "visa-pay").card!.owed).toBe(1_200_000 - 2_000);
    expect(view.toReview).toEqual({ count: 1, amount: 5_000 });
  });

  it("counts a card refund marked Income only as far as the envelope reaches", () => {
    const data = household();
    data.transactions.push(
      tx({ id: "uncat", accountId: "visa", amount: -3_000 }),
      tx({ id: "refund", accountId: "visa", amount: 5_000, isIncome: true }),
    );
    const view = expectIdentity(data);
    // $30 went into Visa payment; the $50 refund takes it back out as income,
    // and the other $20 only lowers what is owed.
    expect(row(view, "visa-pay").remaining).toBe(0);
    expect(view.availableToAssign).toBe(1_000_000 - 3_000 + 3_000);
    expect(row(view, "visa-pay").card!.owed).toBe(1_200_000 - 2_000);
  });

  it("puts a cash advance into the payment envelope without changing Available", () => {
    const data = household();
    data.transactions.push(
      tx({ id: "adv-out", accountId: "visa", amount: -20_000, isTransfer: true }),
      tx({ id: "adv-in", amount: 20_000, isTransfer: true }),
    );
    const view = expectIdentity(data);
    expect(view.availableToAssign).toBe(1_000_000);
    expect(row(view, "visa-pay").remaining).toBe(20_000);
  });

  it("always shows an open card's payment envelope, and only then", () => {
    const data = household();
    // Make every envelope "used" so only the card rule keeps one visible.
    for (const id of ["groceries", "fun", "visa-pay"]) {
      data.envelopeMonths.push({
        envelopeId: id,
        month: "2026-09",
        assigned: 0,
        released: 0,
        planned: 0,
      });
    }
    expect(row(buildBudgetMonth(data, M), "visa-pay").inUse).toBe(true);
    expect(row(buildBudgetMonth(data, M), "fun").inUse).toBe(false);
    data.accounts[1]!.closedAt = "2026-10-20T00:00:00Z";
    expect(row(buildBudgetMonth(data, M), "visa-pay").inUse).toBe(false);
  });

  it("leaves a card out before its opening month", () => {
    const data = household();
    data.accounts[1]!.openingDate = "2026-11-01";
    const view = buildBudgetMonth(data, M);
    expect(row(view, "visa-pay").card!.owed).toBe(0);
    expect(availableToAssignFor(data, M)).toBe(1_000_000);
  });
});

describe("checkTransactionSpend for cards", () => {
  const payment = {
    accountId: "visa",
    date: "2026-10-09",
    amount: 50_000,
    envelopeId: null,
    isTransfer: true,
  };

  it("needs no cover when the payment envelope holds enough", () => {
    const data = household();
    assign(data, "visa-pay", 60_000);
    expect(checkTransactionSpend(data, payment)).toBeNull();
  });

  it("asks to cover a payment larger than the payment envelope, Saved first", () => {
    const data = household();
    data.envelopeMonths.push({
      envelopeId: "visa-pay",
      month: "2026-09",
      assigned: 10_000,
      released: 0,
      planned: 0,
    });
    data.accounts[1]!.openingDate = "2026-09-01";
    assign(data, "visa-pay", 15_000);
    expect(checkTransactionSpend(data, payment)).toEqual({
      envelopeId: "visa-pay",
      remainingAfter: -35_000,
      shortfall: 35_000,
      fromSaved: 10_000,
      stillShort: 25_000,
    });
  });

  it("checks the payment envelope for a categorized refund on the card", () => {
    const data = household();
    expect(
      checkTransactionSpend(data, {
        ...payment,
        amount: 2_500,
        isTransfer: false,
        envelopeId: "groceries",
      }),
    ).toMatchObject({ envelopeId: "visa-pay", shortfall: 2_500 });
  });

  it("never stops an uncategorized refund or a purchase on the card for the payment envelope", () => {
    const data = household();
    expect(checkTransactionSpend(data, { ...payment, isTransfer: false })).toBeNull();
    assign(data, "groceries", 10_000);
    expect(
      checkTransactionSpend(data, {
        ...payment,
        amount: -4_000,
        isTransfer: false,
        envelopeId: "groceries",
      }),
    ).toBeNull();
  });
});
