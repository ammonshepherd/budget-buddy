/**
 * Runs the real Supabase data store against the dev project. Skipped unless
 * a dedicated test account is given, because it writes real rows:
 *
 *   SUPABASE_TEST_EMAIL=... SUPABASE_TEST_PASSWORD=... npm run test:integration
 *
 * Uses VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from .env.local. Each run
 * leaves a closed account in the test account's household (accounts are
 * never deleted, by design); groups and envelopes it creates are removed.
 */
import { loadEnv } from "vite";
import { describe, expect, it } from "vitest";
import { buildBudgetMonth } from "../src/models/budgetMath";
import { UserFacingError } from "../src/models/dataStore";
import { createSupabaseStore } from "../src/models/supabaseStore";
import { detectFormat, previewTransactionImport, readTable } from "../src/models/transactionImport";
import { parseCsv } from "../src/models/csv";

const email = process.env.SUPABASE_TEST_EMAIL;
const password = process.env.SUPABASE_TEST_PASSWORD;
const env = loadEnv("development", process.cwd(), "VITE_");

describe.skipIf(!email || !password)("supabaseStore against the dev project", () => {
  it("round-trips a budget and enforces the database rules", async () => {
    const store = createSupabaseStore(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
    await store.signIn(email!, password!);
    expect((await store.getSession())?.email).toBe(email);

    if (!(await store.load())) await store.createHousehold("Integration test");
    let data = (await store.load())!;
    const householdId = data.household.id;
    const run = `run-${Date.now()}`;
    const month = "2026-10";

    await store.addAccount(householdId, {
      name: run,
      type: "checking",
      openingBalance: 100_000,
      openingDate: "2026-10-01",
    });
    await store.addGroup(householdId, run, 99);
    data = (await store.load())!;
    const account = data.accounts.find((a) => a.name === run)!;
    const group = data.groups.find((g) => g.name === run)!;

    await store.addEnvelope(householdId, group.id, "Food", 0);
    await store.addEnvelope(householdId, group.id, "Fun", 1);
    data = (await store.load())!;
    const [food, fun] = ["Food", "Fun"].map((name) =>
      data.envelopes.find((e) => e.groupId === group.id && e.name === name)!,
    ) as [(typeof data.envelopes)[number], (typeof data.envelopes)[number]];

    await store.adjustEnvelopeMonth(food.id, month, { assigned: 30_000 });
    await store.adjustEnvelopeMonth(food.id, month, { assigned: 5_000 });
    await store.adjustEnvelopeMonth(fun.id, month, { assigned: 10_000 });
    await store.moveBetweenEnvelopes(fun.id, food.id, month, 2_500);
    await store.setPlanned(householdId, food.id, month, 40_000);
    await store.saveTransaction(householdId, {
      accountId: account.id,
      date: "2026-10-05",
      amount: -12_345,
      payee: "Market",
      memo: run,
      isTransfer: false,
      envelopeId: food.id,
    });

    data = (await store.load())!;
    const tx = data.transactions.find((t) => t.memo === run)!;
    expect(tx).toMatchObject({
      amount: -12_345,
      allocations: [{ envelopeId: food.id, amount: -12_345 }],
    });
    const rows = buildBudgetMonth(data, month).groups.find((g) => g.id === group.id)!.envelopes;
    expect(rows.map((r) => [r.name, r.planned, r.assigned, r.spent, r.remaining])).toEqual([
      ["Food", 40_000, 37_500, 12_345, 25_155],
      ["Fun", 0, 7_500, 0, 7_500],
    ]);

    // Edit: new amount and Uncategorized in one call.
    await store.saveTransaction(householdId, {
      id: tx.id,
      accountId: account.id,
      date: "2026-10-06",
      amount: -500,
      payee: "Market",
      memo: run,
      isTransfer: false,
      envelopeId: null,
    });
    data = (await store.load())!;
    expect(data.transactions.find((t) => t.id === tx.id)).toMatchObject({
      amount: -500,
      allocations: [],
    });

    // Database rules surface as readable errors.
    await expect(
      store.saveTransaction(householdId, {
        accountId: account.id,
        date: "2026-10-07",
        amount: -100,
        payee: "x",
        memo: run,
        isTransfer: true,
        envelopeId: food.id,
      }),
    ).rejects.toThrow(UserFacingError);
    // Put the transaction in Fun so Fun and its group are "in use".
    await store.saveTransaction(householdId, {
      id: tx.id,
      accountId: account.id,
      date: "2026-10-06",
      amount: -500,
      payee: "Market",
      memo: run,
      isTransfer: false,
      envelopeId: fun.id,
    });
    await expect(store.deleteEnvelope(fun.id)).rejects.toThrow(/still in use/);
    await expect(store.deleteGroup(group.id)).rejects.toThrow(/still in use/);

    // Cleanup what can be deleted; close the account.
    await store.deleteTransaction(tx.id);
    await store.deleteEnvelope(fun.id);
    await store.deleteEnvelope(food.id);
    await store.deleteGroup(group.id);
    await store.closeAccount(account.id);
    data = (await store.load())!;
    expect(data.transactions.some((t) => t.memo === run)).toBe(false);
    expect(data.groups.some((g) => g.id === group.id)).toBe(false);
    expect(data.accounts.find((a) => a.id === account.id)?.closedAt).not.toBeNull();

    await store.signOut();
    expect(await store.getSession()).toBeNull();
  }, 30_000);

  it("imports an envelope plan, matching existing names", async () => {
    const store = createSupabaseStore(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
    await store.signIn(email!, password!);
    if (!(await store.load())) await store.createHousehold("Integration test");
    const householdId = (await store.load())!.household.id;
    const run = `plan-${Date.now()}`;
    const month = "2030-01";

    await store.importEnvelopePlan(householdId, month, [
      { group: run, envelope: "Rent", planned: 120_000 },
      { group: run, envelope: "Water", planned: 4_550 },
    ]);
    // Same names in other case: updates Planned, creates nothing new.
    await store.importEnvelopePlan(householdId, month, [
      { group: run.toUpperCase(), envelope: " rent ", planned: 130_000 },
    ]);

    const data = (await store.load())!;
    const groups = data.groups.filter((g) => g.name.toLowerCase() === run);
    expect(groups).toHaveLength(1);
    const envelopes = data.envelopes.filter((e) => e.groupId === groups[0]!.id);
    const planned = (name: string) =>
      data.envelopeMonths.find(
        (r) => r.month === month && r.envelopeId === envelopes.find((e) => e.name === name)?.id,
      )?.planned;
    expect(envelopes.map((e) => e.name).sort()).toEqual(["Rent", "Water"]);
    expect([planned("Rent"), planned("Water")]).toEqual([130_000, 4_550]);

    // Bad input is refused as a whole.
    await expect(
      store.importEnvelopePlan(householdId, month, [{ group: run, envelope: "", planned: 1 }]),
    ).rejects.toThrow(UserFacingError);

    for (const envelope of envelopes) await store.deleteEnvelope(envelope.id);
    await store.deleteGroup(groups[0]!.id);
    await store.signOut();
  }, 30_000);
  it("imports transactions once, remembering the account's columns", async () => {
    const store = createSupabaseStore(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
    await store.signIn(email!, password!);
    if (!(await store.load())) await store.createHousehold("Integration test");
    let data = (await store.load())!;
    const run = `import-${Date.now()}`;
    await store.addAccount(data.household.id, {
      name: run,
      type: "credit_card",
      openingBalance: 0,
      openingDate: "2030-01-01",
    });
    data = (await store.load())!;
    const account = data.accounts.find((a) => a.name === run)!;
    expect(account.type).toBe("credit_card");

    const table = readTable(
      parseCsv(
        `Transaction ID,Date,Description,Amount\n${run}-1,01/02/30,Coffee,-4.50\n${run}-2,01/03/30,Pay,100`,
      ),
    );
    const format = detectFormat(table);
    const rows = previewTransactionImport(data, account, table, format).rows.map(
      ({ date, amount, payee, memo, importKey }) => ({ date, amount, payee, memo, importKey }),
    );
    expect(await store.importTransactions(account.id, format, rows)).toBe(2);
    // Sending the same rows again adds nothing: the database also refuses duplicates.
    expect(await store.importTransactions(account.id, format, rows)).toBe(0);

    data = (await store.load())!;
    const imported = data.transactions.filter((t) => t.accountId === account.id);
    expect(imported.map((t) => [t.amount, t.importKey, t.allocations.length]).sort()).toEqual([
      [-450, `id:${run}-1`, 0],
      [10_000, `id:${run}-2`, 0],
    ]);
    expect(data.accounts.find((a) => a.id === account.id)?.importFormat).toEqual(format);

    for (const tx of imported) await store.deleteTransaction(tx.id);
    await store.closeAccount(account.id);
    await store.signOut();
  }, 30_000);
});
