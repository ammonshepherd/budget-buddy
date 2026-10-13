import { describe, expect, it } from "vitest";
import {
  incomeRuleFor,
  inflowsMatchingRules,
  matchesIncomeRule,
  readIncomeRule,
} from "./incomeRules";
import type { BudgetData, Transaction } from "./types";

const rule = { id: "r", pattern: "ACME  payroll", accountId: null };

describe("matchesIncomeRule", () => {
  const inflow = { accountId: "checking", amount: 200_000, payee: "Deposit ACH acme payroll 1234" };

  it("matches text anywhere in the description, ignoring case and extra spaces", () => {
    expect(matchesIncomeRule(rule, inflow)).toBe(true);
    expect(matchesIncomeRule(rule, { ...inflow, payee: "ACME BONUS" })).toBe(false);
  });

  it("never matches an outflow", () => {
    expect(matchesIncomeRule(rule, { ...inflow, amount: -200_000 })).toBe(false);
  });

  it("can be limited to one account", () => {
    const savingsOnly = { ...rule, accountId: "savings" };
    expect(matchesIncomeRule(savingsOnly, inflow)).toBe(false);
    expect(matchesIncomeRule(savingsOnly, { ...inflow, accountId: "savings" })).toBe(true);
    expect(incomeRuleFor([savingsOnly, rule], inflow)).toBe(rule);
  });
});

describe("readIncomeRule", () => {
  it("tidies the text and refuses one that would match almost anything", () => {
    expect(readIncomeRule("  ACME   payroll ", null)).toEqual({
      pattern: "ACME payroll",
      accountId: null,
    });
    expect(() => readIncomeRule(" a ", null)).toThrow(/at least 2 characters/);
    expect(() => readIncomeRule("x".repeat(101), null)).toThrow(/100 characters/);
  });
});

describe("inflowsMatchingRules", () => {
  const tx = (partial: Partial<Transaction> & Pick<Transaction, "id" | "amount" | "payee">) => ({
    accountId: "checking",
    date: "2026-10-01",
    memo: "",
    isTransfer: false,
    isIncome: false,
    transferId: null,
    voided: false,
    allocations: [],
    importKey: null,
    ...partial,
  });

  it("finds only inflows still to review", () => {
    const data = {
      accounts: [],
      incomeRules: [rule],
      transactions: [
        tx({ id: "match", amount: 100, payee: "ACME PAYROLL" }),
        tx({ id: "done", amount: 100, payee: "ACME PAYROLL", isIncome: true }),
        tx({
          id: "envelope",
          amount: 100,
          payee: "ACME PAYROLL",
          allocations: [{ envelopeId: "e", amount: 100 }],
        }),
        tx({ id: "other", amount: 100, payee: "GIFT" }),
      ],
    } as unknown as BudgetData;
    expect(inflowsMatchingRules(data).map((t) => t.id)).toEqual(["match"]);
  });
});
