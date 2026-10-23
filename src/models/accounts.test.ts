import { describe, expect, it } from "vitest";
import {
  accountFromKind,
  accountKind,
  cardDebt,
  groupAccounts,
  isTracking,
  openingBalanceFromEntry,
  openingBalanceToEntry,
  sidebarAccounts,
} from "./accounts";
import type { Account, Transaction } from "./types";

describe("account kinds", () => {
  it("stores a tracking account as an off-budget checking account, and reads it back", () => {
    expect(accountFromKind("tracking")).toEqual({ type: "checking", onBudget: false });
    expect(accountFromKind("checking")).toEqual({ type: "checking", onBudget: true });
    expect(accountFromKind("credit_card")).toEqual({ type: "credit_card", onBudget: true });
    for (const kind of ["checking", "credit_card", "tracking"] as const) {
      expect(accountKind(accountFromKind(kind))).toBe(kind);
    }
    expect(isTracking({ onBudget: false })).toBe(true);
    expect(isTracking({ onBudget: true })).toBe(false);
    expect(isTracking(undefined)).toBe(false);
  });
});

describe("opening balance entry", () => {
  it("keeps checking balances as entered", () => {
    expect(openingBalanceFromEntry("checking", 12_000)).toBe(12_000);
    expect(openingBalanceFromEntry("checking", -500)).toBe(-500);
  });

  it("stores the amount owed on a card as a negative balance", () => {
    expect(openingBalanceFromEntry("credit_card", 45_010)).toBe(-45_010);
    // A card with a credit balance (overpaid) is entered as negative.
    expect(openingBalanceFromEntry("credit_card", -2_000)).toBe(2_000);
  });

  it("turns a stored balance back into what the form shows", () => {
    for (const type of ["checking", "credit_card"] as const) {
      expect(openingBalanceToEntry(type, openingBalanceFromEntry(type, 7_550))).toBe(7_550);
    }
  });
});

describe("card debt", () => {
  const account = (id: string, extra: Partial<Account> = {}): Account => ({
    id,
    name: id,
    type: "credit_card",
    openingBalance: 0,
    openingDate: "2026-01-01",
    onBudget: true,
    closedAt: null,
    importFormat: null,
    ...extra,
  });
  const tx = (accountId: string, amount: number, date = "2026-10-01"): Transaction => ({
    id: `${accountId}-${amount}-${date}`,
    accountId,
    date,
    amount,
    payee: "",
    memo: "",
    isTransfer: false,
    isIncome: false,
    transferId: null,
    voided: false,
    allocations: [],
    importKey: null,
    reconciled: false,
  });

  it("adds up what every card owes today, leaving out checking and future dates", () => {
    const data = {
      accounts: [
        account("visa", { openingBalance: -10_000 }),
        account("discover"),
        account("checking", { type: "checking", openingBalance: -5_000 }),
      ],
      transactions: [
        tx("visa", -2_500),
        tx("discover", -4_000),
        tx("discover", 1_000),
        tx("checking", -9_999),
        tx("visa", -7_000, "2026-11-01"),
      ],
    };
    expect(cardDebt(data, "2026-10-20")).toBe(15_500);
  });

  it("is $0.00 without cards, and a card in credit lowers it", () => {
    expect(
      cardDebt({ accounts: [account("c", { type: "checking" })], transactions: [] }, "2026-10-20"),
    ).toBe(0);
    const data = {
      accounts: [
        account("visa", { openingBalance: -3_000 }),
        account("amex", { openingBalance: 1_000 }),
      ],
      transactions: [],
    };
    expect(cardDebt(data, "2026-10-20")).toBe(2_000);
  });
});

describe("groupAccounts", () => {
  const a = (name: string, type: "checking" | "credit_card", onBudget = true) => ({
    name,
    type,
    onBudget,
  });

  it("groups Checking, Credit cards, then Tracking, each by name, leaving out empty groups", () => {
    const groups = groupAccounts([
      a("Visa", "credit_card"),
      a("Savings", "checking"),
      a("Brokerage", "checking", false),
      a("Main", "checking"),
    ]);
    expect(groups.map((g) => [g.name, g.accounts.map((x) => x.name)])).toEqual([
      ["Checking", ["Main", "Savings"]],
      ["Credit cards", ["Visa"]],
      ["Tracking", ["Brokerage"]],
    ]);
    expect(groupAccounts([a("Visa", "credit_card")]).map((g) => g.name)).toEqual(["Credit cards"]);
  });
});

describe("sidebarAccounts", () => {
  const a = (
    name: string,
    type: "checking" | "credit_card",
    onBudget = true,
    closedAt: string | null = null,
  ) => ({
    name,
    type,
    onBudget,
    closedAt,
  });

  it("lists open budget accounts (checking, then cards) apart from tracking accounts", () => {
    const { budget, tracking } = sidebarAccounts([
      a("Visa", "credit_card"),
      a("Savings", "checking"),
      a("Old", "checking", true, "2026-01-01T00:00:00Z"),
      a("Mortgage", "checking", false),
      a("Brokerage", "checking", false),
      a("Main", "checking"),
    ]);
    expect(budget.map((x) => x.name)).toEqual(["Main", "Savings", "Visa"]);
    expect(tracking.map((x) => x.name)).toEqual(["Brokerage", "Mortgage"]);
  });

  it("gives empty lists when there are no accounts", () => {
    expect(sidebarAccounts([])).toEqual({ budget: [], tracking: [] });
  });
});
