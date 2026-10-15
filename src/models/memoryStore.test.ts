import { describe, expect, it } from "vitest";
import { UserFacingError, type TransactionInput } from "./dataStore";
import { createMemoryStore } from "./memoryStore";

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
