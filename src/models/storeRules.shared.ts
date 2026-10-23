/**
 * Rules every DataStore must enforce, written once and run against both:
 * the in-memory store (memoryStore.rules.test.ts, unit tests) and the real
 * database (integration/storeRules.test.ts, the test project). The UI tests
 * trust the memory store to behave like the database; these tests check it.
 *
 * Each test adds its own accounts, group and envelopes with unique names, so
 * it can run inside a household that already holds data.
 */
import { expect, it } from "vitest";
import { UserFacingError, type DataStore, type TransactionInput } from "./dataStore";
import type { ImportFormat } from "./transactionImport";
import type { TransferSide } from "./transfers";

/** A signed-in store whose user already has a household. */
export type StoreFactory = () => Promise<DataStore>;

let runs = 0;

async function setUp(makeStore: StoreFactory) {
  const store = await makeStore();
  const tag = `rules-${Date.now()}-${++runs}`;
  const householdId = (await store.load())!.household.id;
  const opening = { openingBalance: 100_000, openingDate: "2026-10-01" };
  await store.addAccount(householdId, { name: `${tag} Checking`, type: "checking", ...opening });
  await store.addAccount(householdId, { name: `${tag} Savings`, type: "checking", ...opening });
  await store.addAccount(householdId, { name: `${tag} Visa`, type: "credit_card", ...opening });
  await store.addAccount(householdId, {
    name: `${tag} Brokerage`,
    type: "checking",
    onBudget: false,
    ...opening,
  });
  await store.addGroup(householdId, tag, 900);
  let data = (await store.load())!;
  const group = data.groups.find((g) => g.name === tag)!;
  await store.addEnvelope(householdId, group.id, `${tag} A`, 0);
  await store.addEnvelope(householdId, group.id, `${tag} B`, 1);
  data = (await store.load())!;

  const account = (name: string) => data.accounts.find((a) => a.name === `${tag} ${name}`)!.id;
  const envelope = (name: string) => data.envelopes.find((e) => e.name === `${tag} ${name}`)!.id;
  const visa = account("Visa");
  const ids = {
    checking: account("Checking"),
    savings: account("Savings"),
    visa,
    tracking: account("Brokerage"),
    a: envelope("A"),
    b: envelope("B"),
    visaPayment: data.envelopes.find((e) => e.cardAccountId === visa)!.id,
    group: group.id,
  };
  const save = (
    accountId: string,
    amount: number,
    lines: [string, number][],
    isIncome = false,
  ): Promise<void> =>
    store.saveTransaction(householdId, {
      accountId,
      date: "2026-10-05",
      amount,
      payee: tag,
      memo: "",
      isIncome,
      allocations: lines.map(([envelopeId, cents]) => ({ envelopeId, amount: cents })),
    } satisfies TransactionInput);
  const side = (accountId: string, amount: number): TransferSide => ({
    accountId,
    date: "2026-10-06",
    amount,
    payee: tag,
    memo: "",
  });
  return { store, householdId, ids, save, side };
}

/** The promise fails with a message the user can be shown, matching `message`. */
async function rejects(promise: Promise<unknown>, message: RegExp) {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected a rejection matching ${message}`).toBeInstanceOf(UserFacingError);
  expect((error as Error).message).toMatch(message);
}

/** Registers the shared rule tests; call inside a describe block. */
export function storeRuleTests(makeStore: StoreFactory) {
  it("accepts a valid split on checking and on a card purchase", async () => {
    const { store, ids, save } = await setUp(makeStore);
    await save(ids.checking, -5_000, [
      [ids.a, -2_000],
      [ids.b, -3_000],
    ]);
    await save(ids.visa, -1_000, [
      [ids.a, -400],
      [ids.b, -600],
    ]);
    const data = (await store.load())!;
    const mine = data.transactions.filter((t) => [ids.checking, ids.visa].includes(t.accountId));
    expect(mine.map((t) => t.allocations.length)).toEqual([2, 2]);
  });

  it("rejects split lines that break the rules", async () => {
    const { ids, save } = await setUp(makeStore);
    await rejects(
      save(ids.checking, -5_000, [
        [ids.a, -2_000],
        [ids.a, -3_000],
      ]),
      /only once/,
    );
    await rejects(
      save(ids.checking, -5_000, [
        [ids.a, 1_000],
        [ids.b, -6_000],
      ]),
      /same way/,
    );
    await rejects(
      save(ids.checking, -5_000, [
        [ids.a, -1_000],
        [ids.b, -1_000],
      ]),
      /must sum/,
    );
  });

  it("keeps card credits and payment envelopes out of envelopes", async () => {
    const { ids, save } = await setUp(makeStore);
    await rejects(save(ids.visa, 1_000, [[ids.a, 1_000]]), /card credit/);
    await rejects(
      save(ids.checking, -5_000, [
        [ids.a, -1_000],
        [ids.visaPayment, -4_000],
      ]),
      /payment envelope/,
    );
  });

  it("allows Income only on a positive non-card inflow without an envelope", async () => {
    const { ids, save } = await setUp(makeStore);
    await save(ids.checking, 2_000, [], true);
    await rejects(save(ids.checking, -2_000, [], true), /Income is money coming in/);
    await rejects(save(ids.checking, 2_000, [[ids.a, 2_000]], true), /without an envelope/);
    await rejects(save(ids.visa, 2_000, [], true), /card credit.*Income/);
  });

  it("protects a card's payment envelope while the card is open", async () => {
    const { store, ids } = await setUp(makeStore);
    await rejects(store.renameEnvelope(ids.visaPayment, "Something else"), /named after its card/);
    await rejects(store.moveEnvelope(ids.visaPayment, ids.group, 0), /stays in its group/);
    await rejects(store.deleteEnvelope(ids.visaPayment), /cannot be deleted while the card/);
    // Renaming the card renames its envelope.
    await store.updateAccount(ids.visa, {
      name: `Renamed ${ids.visa.slice(0, 8)}`,
      openingBalance: 100_000,
      openingDate: "2026-10-01",
    });
    const data = (await store.load())!;
    const payment = data.envelopes.find((e) => e.id === ids.visaPayment)!;
    expect(payment.name).toContain(`Renamed ${ids.visa.slice(0, 8)}`);
  });

  it("saves transfers only as two sides in different accounts that cancel out", async () => {
    const { store, ids, side } = await setUp(makeStore);
    await store.saveTransfer({
      transferId: null,
      sides: [side(ids.checking, -3_000), side(ids.savings, 3_000)],
    });
    await rejects(
      store.saveTransfer({
        transferId: null,
        sides: [side(ids.checking, -3_000), side(ids.savings, 2_000)],
      }),
      /different accounts that cancel out/,
    );
    // Both sides in one account. The database stops this with a unique index
    // before its friendlier check runs, so only the refusal is compared (the
    // transfer form never offers the same account twice).
    await rejects(
      store.saveTransfer({
        transferId: null,
        sides: [side(ids.checking, -3_000), side(ids.checking, 3_000)],
      }),
      /./,
    );
  });

  it("keeps a tracking account standalone: no envelopes, Income or transfers", async () => {
    const { store, householdId, ids, save, side } = await setUp(makeStore);
    await save(ids.tracking, 2_500, []);
    await save(ids.tracking, -1_000, []);
    await rejects(save(ids.tracking, -1_000, [[ids.a, -1_000]]), /tracking account/);
    await rejects(save(ids.tracking, 2_000, [], true), /tracking account/);
    await rejects(
      store.saveTransfer({
        transferId: null,
        sides: [side(ids.checking, -3_000), side(ids.tracking, 3_000)],
      }),
      /tracking account/,
    );
    const inflow = (await store.load())!.transactions.find(
      (t) => t.accountId === ids.tracking && t.amount === 2_500,
    )!;
    expect(await store.markIncome([inflow.id])).toBe(0);
    // Only a checking-type account can be off budget.
    await rejects(
      store.addAccount(householdId, {
        name: `Card ${ids.tracking.slice(0, 8)}`,
        type: "credit_card",
        onBudget: false,
        openingBalance: 0,
        openingDate: "2026-10-01",
      }),
      /./,
    );
  });

  it("never marks rows imported into a tracking account as Income", async () => {
    const { store, ids } = await setUp(makeStore);
    const format: ImportFormat = {
      version: 1,
      hasHeader: true,
      headers: ["date", "description", "amount"],
      columnCount: 3,
      date: 0,
      dateOrder: "YMD",
      description: 1,
      memo: -1,
      amount: { kind: "signed", column: 2, flip: false },
      bankId: -1,
    };
    const row = (importKey: string) => ({
      date: "2026-10-07",
      amount: 1_200,
      payee: "Dividend",
      memo: "",
      importKey,
      isIncome: true,
      matchId: null,
    });
    await store.importTransactions(ids.tracking, format, [row(`t-${ids.tracking}`)]);
    await store.importTransactions(ids.checking, format, [row(`c-${ids.checking}`)]);
    const data = (await store.load())!;
    const income = (accountId: string) =>
      data.transactions.find((t) => t.accountId === accountId && t.payee === "Dividend")!.isIncome;
    expect(income(ids.tracking)).toBe(false);
    expect(income(ids.checking)).toBe(true);
  });

  it("refuses to delete what is still in use", async () => {
    const { store, ids, save } = await setUp(makeStore);
    await save(ids.checking, -1_000, [[ids.a, -1_000]]);
    await rejects(store.deleteEnvelope(ids.a), /still in use/);
    await rejects(store.deleteGroup(ids.group), /still in use/);
    // An unused envelope can go.
    await store.deleteEnvelope(ids.b);
  });

  it("refuses a reorder made from an out-of-date list", async () => {
    const { store, ids } = await setUp(makeStore);
    await rejects(store.reorderEnvelopes(ids.group, [ids.a]), /have changed/);
    await store.reorderEnvelopes(ids.group, [ids.b, ids.a]);
  });
}
