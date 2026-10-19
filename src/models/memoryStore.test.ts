import { describe, expect, it } from "vitest";
import { UserFacingError, type TransactionInput } from "./dataStore";
import { createMemoryStore } from "./memoryStore";
import type { ImportFormat } from "./transactionImport";
import type { TransferInput } from "./transfers";

/** A store with a household, checking and a Visa, and envelopes A and B. */
async function setUp() {
  const store = createMemoryStore();
  await store.signIn("test@example.com", "password123");
  await store.createHousehold("Home");
  let data = (await store.load())!;
  const householdId = data.household.id;
  const opening = { openingBalance: 100_000, openingDate: "2026-10-01" };
  await store.addAccount(householdId, { name: "Checking", type: "checking", ...opening });
  await store.addAccount(householdId, { name: "Visa", type: "credit_card", ...opening });
  await store.addGroup(householdId, "Everyday", 0);
  data = (await store.load())!;
  const group = data.groups.find((g) => g.name === "Everyday")!;
  await store.addEnvelope(householdId, group.id, "A", 0);
  await store.addEnvelope(householdId, group.id, "B", 1);
  data = (await store.load())!;
  const id = (name: string) =>
    data.envelopes.find((e) => e.name === name)?.id ??
    data.accounts.find((a) => a.name === name)!.id;
  const visaPayment = data.envelopes.find((e) => e.cardAccountId)!.id;
  const save = (accountId: string, amount: number, lines: [string, number][]) =>
    store.saveTransaction(householdId, {
      accountId,
      date: "2026-10-05",
      amount,
      payee: "Shop",
      memo: "",
      isIncome: false,
      allocations: lines.map(([envelopeId, cents]) => ({ envelopeId, amount: cents })),
    } satisfies TransactionInput);
  return { store, id, visaPayment, save };
}

describe("memory store splits", () => {
  it("saves a split on checking and on a card purchase", async () => {
    const { store, id, save } = await setUp();
    await save(id("Checking"), -5_000, [
      [id("A"), -2_000],
      [id("B"), -3_000],
    ]);
    await save(id("Visa"), -1_000, [
      [id("A"), -400],
      [id("B"), -600],
    ]);
    await save(id("Checking"), 1_000, [
      [id("A"), 400],
      [id("B"), 600],
    ]);
    const data = (await store.load())!;
    expect(data.transactions.map((t) => t.allocations.length)).toEqual([2, 2, 2]);
  });

  it("rejects what the database rejects", async () => {
    const { id, visaPayment, save } = await setUp();
    const rejects = async (promise: Promise<void>, message: RegExp) => {
      const error: unknown = await promise.then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(UserFacingError);
      expect((error as Error).message).toMatch(message);
    };
    await rejects(
      save(id("Checking"), -5_000, [
        [id("A"), -2_000],
        [id("A"), -3_000],
      ]),
      /only once/,
    );
    await rejects(
      save(id("Checking"), -5_000, [
        [id("A"), 1_000],
        [id("B"), -6_000],
      ]),
      /same way/,
    );
    await rejects(
      save(id("Checking"), -5_000, [
        [id("A"), -1_000],
        [id("B"), -1_000],
      ]),
      /must sum/,
    );
    await rejects(
      save(id("Visa"), 1_000, [
        [id("A"), 400],
        [id("B"), 600],
      ]),
      /card credit/,
    );
    await rejects(
      save(id("Checking"), -5_000, [
        [id("A"), -1_000],
        [visaPayment, -4_000],
      ]),
      /payment envelope/,
    );
  });
});

describe("memory store rename and reorder", () => {
  const byPosition = <T extends { position: number; name: string }>(items: T[]) =>
    [...items].sort((a, b) => a.position - b.position).map((item) => item.name);

  it("renames groups and envelopes, but not a card's payment envelope", async () => {
    const { store, id, visaPayment } = await setUp();
    const data = (await store.load())!;
    const everyday = data.groups.find((g) => g.name === "Everyday")!;
    await store.renameGroup(everyday.id, "Daily");
    await store.renameEnvelope(id("A"), "Groceries");
    await expect(store.renameEnvelope(visaPayment, "Mine")).rejects.toThrow(/named after its card/);
    const after = (await store.load())!;
    expect(after.groups.map((g) => g.name)).toContain("Daily");
    expect(after.envelopes.map((e) => e.name)).toEqual(
      expect.arrayContaining(["Groceries", "B", "Visa payment"]),
    );
  });

  it("reorders a whole list, and refuses an out-of-date one", async () => {
    const { store, id } = await setUp();
    const data = (await store.load())!;
    const groupIds = [...data.groups].sort((a, b) => a.position - b.position).map((g) => g.id);
    await store.reorderGroups(data.household.id, [...groupIds].reverse());
    const everyday = data.groups.find((g) => g.name === "Everyday")!;
    await store.reorderEnvelopes(everyday.id, [id("B"), id("A")]);

    const after = (await store.load())!;
    expect(byPosition(after.groups)).toEqual(byPosition(data.groups).reverse());
    expect(byPosition(after.envelopes.filter((e) => e.groupId === everyday.id))).toEqual([
      "B",
      "A",
    ]);
    await expect(store.reorderEnvelopes(everyday.id, [id("A")])).rejects.toThrow(/reload/);
    await expect(store.reorderEnvelopes(everyday.id, [id("A"), id("A")])).rejects.toThrow(/reload/);
  });

  it("puts a new card's payment envelope in the renamed card group", async () => {
    const { store, visaPayment } = await setUp();
    let data = (await store.load())!;
    const cardGroup = data.envelopes.find((e) => e.id === visaPayment)!.groupId;
    await store.renameGroup(cardGroup, "Cards");
    await store.addAccount(data.household.id, {
      name: "Amex",
      type: "credit_card",
      openingBalance: 0,
      openingDate: "2026-10-01",
    });
    data = (await store.load())!;
    expect(data.envelopes.find((e) => e.name === "Amex payment")!.groupId).toBe(cardGroup);
    expect(data.groups.map((g) => g.name)).not.toContain("Credit card payments");
  });
});

describe("memory store moving envelopes", () => {
  it("moves an envelope to another group, but not a card's payment envelope", async () => {
    const { store, id, visaPayment } = await setUp();
    let data = (await store.load())!;
    await store.addGroup(data.household.id, "Bills", 5);
    data = (await store.load())!;
    const bills = data.groups.find((g) => g.name === "Bills")!;

    await store.moveEnvelope(id("A"), bills.id, 0);
    data = (await store.load())!;
    expect(data.envelopes.find((e) => e.id === id("A"))).toMatchObject({
      groupId: bills.id,
      position: 0,
    });
    await expect(store.moveEnvelope(visaPayment, bills.id, 1)).rejects.toThrow(
      /stays in its group/,
    );
    await expect(store.moveEnvelope(id("B"), "no-such-group", 0)).rejects.toThrow(
      /Group not found/,
    );
  });
});

describe("memory store import matching", () => {
  const format: ImportFormat = {
    version: 1,
    hasHeader: true,
    headers: [],
    columnCount: 3,
    date: 0,
    dateOrder: "MDY",
    description: 1,
    memo: -1,
    amount: { kind: "signed", column: 2, flip: false },
    bankId: -1,
  };
  const row = (importKey: string, amount: number, matchId: string | null) => ({
    date: "2026-10-07",
    amount,
    payee: "BANK SHOP",
    memo: "",
    importKey,
    isIncome: false,
    matchId,
  });

  it("gives the typed transaction the import key, keeping what was entered", async () => {
    const { store, id, save } = await setUp();
    await save(id("Checking"), -5_000, [[id("A"), -5_000]]);
    const typed = (await store.load())!.transactions[0]!;
    const rows = [row("id:1", -5_000, typed.id), row("id:2", -700, null)];
    expect(await store.importTransactions(id("Checking"), format, rows)).toBe(2);
    const data = (await store.load())!;
    expect(data.transactions).toHaveLength(2);
    expect(data.transactions.find((t) => t.id === typed.id)).toEqual({
      ...typed,
      importKey: "id:1",
    });

    // A match that no longer fits (already matched, or gone) saves nothing.
    for (const stale of [
      [row("id:3", -5_000, typed.id)],
      [row("id:3", -700, null), row("id:4", -5_000, "missing")],
    ]) {
      await expect(store.importTransactions(id("Checking"), format, stale)).rejects.toThrow(
        UserFacingError,
      );
    }
    expect((await store.load())!.transactions).toHaveLength(2);
  });
});

describe("memory store reconciling", () => {
  it("marks and unmarks in one step, counting only what changed", async () => {
    const { store, id, save } = await setUp();
    await save(id("Checking"), -1_000, []);
    await save(id("Checking"), -2_000, []);
    const [a, b] = (await store.load())!.transactions.map((t) => t.id);

    expect(await store.setReconciled([a!], true)).toBe(1);
    expect(await store.setReconciled([a!, b!], true)).toBe(1);
    expect(await store.setReconciled([b!], false)).toBe(1);
    const data = (await store.load())!;
    expect(data.transactions.map((t) => [t.id, t.reconciled])).toEqual([
      [a, true],
      [b, false],
    ]);
  });

  it("keeps the mark when a transaction or transfer is edited", async () => {
    const { store, id, save } = await setUp();
    await save(id("Checking"), -1_000, []);
    let tx = (await store.load())!.transactions[0]!;
    await store.setReconciled([tx.id], true);
    await store.saveTransaction((await store.load())!.household.id, {
      id: tx.id,
      accountId: tx.accountId,
      date: tx.date,
      amount: -1_500,
      payee: "Edited",
      memo: "",
      isIncome: false,
      allocations: [],
    });
    tx = (await store.load())!.transactions[0]!;
    expect(tx).toMatchObject({ amount: -1_500, reconciled: true });

    const side = { date: "2026-10-06", payee: "Pay Visa", memo: "" };
    await store.saveTransfer({
      transferId: null,
      sides: [
        { ...side, accountId: id("Checking"), amount: -500 },
        { ...side, accountId: id("Visa"), amount: 500 },
      ],
    });
    const sides = (await store.load())!.transactions.filter((t) => t.isTransfer);
    await store.setReconciled([sides[0]!.id], true);
    await store.saveTransfer({
      transferId: sides[0]!.transferId!,
      sides: [sides[0]!, sides[1]!].map((t) => ({
        ...side,
        id: t.id,
        accountId: t.accountId,
        amount: t.amount,
      })) as TransferInput["sides"],
    });
    const after = (await store.load())!.transactions.filter((t) => t.isTransfer);
    expect(after.find((t) => t.id === sides[0]!.id)!.reconciled).toBe(true);
    expect(after.find((t) => t.id === sides[1]!.id)!.reconciled).toBe(false);
  });
});
