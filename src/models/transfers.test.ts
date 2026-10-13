import { describe, expect, it } from "vitest";
import { findTransferMatch, planTransfer, transferPartner, type TransferSide } from "./transfers";
import type { BudgetData, Transaction } from "./types";

function tx(partial: Partial<Transaction> & Pick<Transaction, "id" | "amount">): Transaction {
  return {
    accountId: "visa",
    date: "2026-10-10",
    payee: "",
    memo: "",
    isTransfer: false,
    transferId: null,
    voided: false,
    allocations: [],
    importKey: null,
    ...partial,
  };
}

function budget(transactions: Transaction[]): BudgetData {
  const account = (id: string) => ({
    id,
    name: id,
    type: "checking" as const,
    openingBalance: 0,
    openingDate: "2026-10-01",
    onBudget: true,
    closedAt: null,
    importFormat: null,
  });
  return {
    household: { id: "h", name: "Home" },
    accounts: [account("checking"), account("visa")],
    groups: [],
    envelopes: [],
    envelopeMonths: [],
    transactions,
  };
}

const payment: TransferSide = {
  accountId: "checking",
  date: "2026-10-10",
  amount: -50_000,
  payee: "Pay Visa",
  memo: "",
};

describe("findTransferMatch", () => {
  const bankRow = tx({ id: "bank", amount: 50_000, date: "2026-10-12", importKey: "id:1" });

  it("finds the other account's unlinked, uncategorized row with the opposite amount", () => {
    const data = budget([bankRow]);
    const wanted = { accountId: "visa", amount: 50_000, date: "2026-10-10", excludeIds: [] };
    expect(findTransferMatch(data, wanted)?.id).toBe("bank");
  });

  it("prefers the closest date and stays within 7 days", () => {
    const data = budget([
      bankRow,
      tx({ id: "closer", amount: 50_000, date: "2026-10-09" }),
      tx({ id: "too-far", amount: 50_000, date: "2026-10-20" }),
    ]);
    const wanted = { accountId: "visa", amount: 50_000, date: "2026-10-10", excludeIds: [] };
    expect(findTransferMatch(data, wanted)?.id).toBe("closer");
    expect(findTransferMatch(data, { ...wanted, date: "2026-10-28" })).toBeNull();
  });

  it("ignores linked, categorized, voided, other-amount and excluded rows", () => {
    const data = budget([
      tx({ id: "linked", amount: 50_000, transferId: "t", isTransfer: true }),
      tx({ id: "categorized", amount: 50_000, allocations: [{ envelopeId: "e", amount: 50_000 }] }),
      tx({ id: "voided", amount: 50_000, voided: true }),
      tx({ id: "other", amount: 49_999 }),
      tx({ id: "excluded", amount: 50_000 }),
    ]);
    const wanted = {
      accountId: "visa",
      amount: 50_000,
      date: "2026-10-10",
      excludeIds: ["excluded"],
    };
    expect(findTransferMatch(data, wanted)).toBeNull();
  });
});

describe("planTransfer", () => {
  it("adds a mirrored other side when nothing matches", () => {
    const { input, other } = planTransfer(budget([]), payment, "visa");
    expect(other.kind).toBe("new");
    expect(input).toEqual({
      transferId: null,
      sides: [payment, { ...payment, id: undefined, accountId: "visa", amount: 50_000 }],
    });
  });

  it("links an imported bank row, keeping the bank's date and description", () => {
    const bank = tx({
      id: "bank",
      amount: 50_000,
      date: "2026-10-12",
      payee: "THANK YOU",
      importKey: "id:1",
    });
    const { input, other } = planTransfer(budget([bank]), payment, "visa");
    expect(other).toEqual({ kind: "match", tx: bank });
    expect(input.sides[1]).toEqual({
      id: "bank",
      accountId: "visa",
      date: "2026-10-12",
      amount: 50_000,
      payee: "THANK YOU",
      memo: "",
    });
  });

  it("updates both sides when an existing transfer is edited", () => {
    const out = tx({
      id: "out",
      accountId: "checking",
      amount: -50_000,
      transferId: "t",
      isTransfer: true,
    });
    const into = tx({ id: "in", amount: 50_000, transferId: "t", isTransfer: true });
    const data = budget([out, into]);
    expect(transferPartner(data, out)?.id).toBe("in");
    const { input, other } = planTransfer(
      data,
      { ...payment, id: "out", amount: -60_000 },
      "visa",
      out,
    );
    expect(other.kind).toBe("partner");
    expect(input.transferId).toBe("t");
    expect(input.sides[1]).toMatchObject({ id: "in", amount: 60_000, payee: "Pay Visa" });
  });

  it("will not change the amount of an imported other side", () => {
    const out = tx({
      id: "out",
      accountId: "checking",
      amount: -50_000,
      transferId: "t",
      isTransfer: true,
    });
    const into = tx({
      id: "in",
      amount: 50_000,
      transferId: "t",
      isTransfer: true,
      importKey: "id:1",
    });
    expect(() =>
      planTransfer(budget([out, into]), { ...payment, id: "out", amount: -60_000 }, "visa", out),
    ).toThrow("imported from the bank as $500.00, so this side must be -$500.00");
  });

  it("refuses a transfer into the same account", () => {
    expect(() => planTransfer(budget([]), payment, "checking")).toThrow(/different account/);
  });
});
