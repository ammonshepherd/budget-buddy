import { describe, expect, it } from "vitest";
import {
  findTransferMatch,
  planTransfer,
  transferChoices,
  transferPartner,
  type TransferSide,
} from "./transfers";
import type { BudgetData, Transaction } from "./types";

function tx(partial: Partial<Transaction> & Pick<Transaction, "id" | "amount">): Transaction {
  return {
    accountId: "visa",
    date: "2026-10-10",
    payee: "",
    memo: "",
    isTransfer: false,
    isIncome: false,
    transferId: null,
    voided: false,
    allocations: [],
    importKey: null,
    reconciled: false,
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
    incomeRules: [],
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

describe("choosing the other side", () => {
  const near = tx({ id: "near", amount: 50_000, date: "2026-10-11", importKey: "id:1" });
  const later = tx({ id: "later", amount: 50_000, date: "2026-10-30", importKey: "id:2" });
  const tooFar = tx({ id: "too-far", amount: 50_000, date: "2026-11-15", importKey: "id:3" });

  it("offers every candidate within 31 days, closest first, but links only within 7", () => {
    const data = budget([later, near, tooFar]);
    expect(transferChoices(data, payment, "visa").matches.map((t) => t.id)).toEqual([
      "near",
      "later",
    ]);
    // Without "near", the 20-days-away row is offered but not linked automatically.
    const onlyLater = budget([later]);
    expect(transferChoices(onlyLater, payment, "visa").matches.map((t) => t.id)).toEqual(["later"]);
    expect(planTransfer(onlyLater, payment, "visa").other.kind).toBe("new");
  });

  it("links the candidate the user picks", () => {
    const { input, other } = planTransfer(
      budget([near, later]),
      payment,
      "visa",
      undefined,
      "later",
    );
    expect(other).toEqual({ kind: "match", tx: later });
    expect(input.sides[1]).toMatchObject({ id: "later", date: "2026-10-30" });
  });

  it("adds a new transaction when asked, even with a match nearby", () => {
    const { input, other } = planTransfer(budget([near]), payment, "visa", undefined, "new");
    expect(other.kind).toBe("new");
    expect(input.sides[1].id).toBeUndefined();
  });

  it("falls back to the automatic choice when the picked row no longer fits", () => {
    expect(planTransfer(budget([near]), payment, "visa", undefined, "gone").other).toEqual({
      kind: "match",
      tx: near,
    });
  });

  it("swaps a typed-in other side for the bank's row", () => {
    const out = tx({
      id: "out",
      accountId: "checking",
      amount: -50_000,
      transferId: "t",
      isTransfer: true,
    });
    const typed = tx({ id: "typed", amount: 50_000, transferId: "t", isTransfer: true });
    const data = budget([out, typed, near]);
    const choices = transferChoices(data, payment, "visa", out);
    expect(choices).toEqual({ partner: typed, matches: [near], canAddNew: false });
    // By default the typed-in side is kept and updated…
    expect(planTransfer(data, { ...payment, id: "out" }, "visa", out).other.kind).toBe("partner");
    // …and choosing the bank row links it instead (save_transfer then deletes the typed one).
    const { input, other } = planTransfer(data, { ...payment, id: "out" }, "visa", out, "near");
    expect(other).toEqual({ kind: "match", tx: near });
    expect(input).toMatchObject({ transferId: "t", sides: [{ id: "out" }, { id: "near" }] });
  });

  it("can release an imported other side for a new transaction", () => {
    const out = tx({
      id: "out",
      accountId: "checking",
      amount: -50_000,
      transferId: "t",
      isTransfer: true,
    });
    const bank = tx({
      id: "bank",
      amount: 50_000,
      transferId: "t",
      isTransfer: true,
      importKey: "id:9",
    });
    const data = budget([out, bank]);
    expect(transferChoices(data, payment, "visa", out).canAddNew).toBe(true);
    const { input, other } = planTransfer(data, { ...payment, id: "out" }, "visa", out, "new");
    expect(other.kind).toBe("new");
    expect(input.sides[1].id).toBeUndefined();
  });
});
