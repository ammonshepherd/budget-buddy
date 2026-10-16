/**
 * Runs the real Supabase data store against the test project as test user A
 * (never production). Skipped unless the test database is configured in
 * .env.test (see docs/testing.md). The integration setup reseeds the test
 * households before every run, so whatever this test adds is cleared then.
 */
import { describe, expect, it } from "vitest";
import { buildBudgetMonth } from "../src/models/budgetMath";
import { UserFacingError } from "../src/models/dataStore";
import { createSupabaseStore } from "../src/models/supabaseStore";
import { detectFormat, previewTransactionImport, readTable } from "../src/models/transactionImport";
import { parseCsv } from "../src/models/csv";
import { skipReason, testEnv } from "./testDb";

const { email, password } = testEnv.users.a;

describe.skipIf(!!skipReason)("supabaseStore against the test project", () => {
  it("round-trips a budget and enforces the database rules", async () => {
    const store = createSupabaseStore(testEnv.url, testEnv.anonKey);
    await store.signIn(email, password);
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
      isIncome: false,
      allocations: [{ envelopeId: food.id, amount: -12_345 }],
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
      isIncome: false,
      allocations: [],
    });
    data = (await store.load())!;
    expect(data.transactions.find((t) => t.id === tx.id)).toMatchObject({
      amount: -500,
      allocations: [],
    });

    // Database rules surface as readable errors.
    await expect(
      store.saveTransfer({
        transferId: null,
        sides: [
          { accountId: account.id, date: "2026-10-07", amount: -100, payee: "x", memo: run },
          { accountId: account.id, date: "2026-10-07", amount: 90, payee: "x", memo: run },
        ],
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
      isIncome: false,
      allocations: [{ envelopeId: fun.id, amount: -500 }],
    });
    // A split: one line per envelope, each with the transaction's sign.
    await store.saveTransaction(householdId, {
      id: tx.id,
      accountId: account.id,
      date: "2026-10-06",
      amount: -500,
      payee: "Market",
      memo: run,
      isIncome: false,
      allocations: [
        { envelopeId: food.id, amount: -200 },
        { envelopeId: fun.id, amount: -300 },
      ],
    });
    data = (await store.load())!;
    expect(
      data.transactions
        .find((t) => t.id === tx.id)!
        .allocations.sort((a, b) => a.amount - b.amount),
    ).toEqual([
      { envelopeId: fun.id, amount: -300 },
      { envelopeId: food.id, amount: -200 },
    ]);
    await expect(
      store.saveTransaction(householdId, {
        id: tx.id,
        accountId: account.id,
        date: "2026-10-06",
        amount: -500,
        payee: "Market",
        memo: run,
        isIncome: false,
        allocations: [
          { envelopeId: food.id, amount: 100 },
          { envelopeId: fun.id, amount: -600 },
        ],
      }),
    ).rejects.toThrow(/same way/);
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
    const store = createSupabaseStore(testEnv.url, testEnv.anonKey);
    await store.signIn(email, password);
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

    // Copying a plan into the next month sets several Planned at once, all or nothing.
    const [rent, water] = ["Rent", "Water"].map((n) => envelopes.find((e) => e.name === n)!.id);
    await store.setPlannedAmounts(householdId, "2030-02", [
      { envelopeId: rent!, planned: 130_000 },
      { envelopeId: water!, planned: 4_550 },
    ]);
    await expect(
      store.setPlannedAmounts(householdId, "2030-02", [
        { envelopeId: rent!, planned: 1 },
        { envelopeId: water!, planned: -1 },
      ]),
    ).rejects.toThrow();
    const february = (await store.load())!.envelopeMonths.filter((r) => r.month === "2030-02");
    expect([rent, water].map((id) => february.find((r) => r.envelopeId === id)?.planned)).toEqual([
      130_000, 4_550,
    ]);

    for (const envelope of envelopes) await store.deleteEnvelope(envelope.id);
    await store.deleteGroup(groups[0]!.id);
    await store.signOut();
  }, 30_000);
  it("imports transactions once, remembering the account's columns", async () => {
    const store = createSupabaseStore(testEnv.url, testEnv.anonKey);
    await store.signIn(email, password);
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
    // The database trigger gave the card its payment envelope.
    expect(data.envelopes.find((e) => e.cardAccountId === account.id)?.name).toBe(`${run} payment`);

    // A transaction typed in before the bank's file arrives.
    await store.saveTransaction(data.household.id, {
      accountId: account.id,
      date: "2030-01-01",
      amount: -450,
      payee: "Typed coffee",
      memo: "",
      isIncome: false,
      allocations: [],
    });
    data = (await store.load())!;
    const typed = data.transactions.find((t) => t.payee === "Typed coffee")!;

    const table = readTable(
      parseCsv(
        `Transaction ID,Date,Description,Amount\n${run}-1,01/02/30,Coffee,-4.50\n${run}-2,01/03/30,Pay,100`,
      ),
    );
    const format = detectFormat(table);
    const preview = previewTransactionImport(data, account, table, format);
    expect(preview.matches.map((m) => [m.row.line, m.tx.id])).toEqual([[2, typed.id]]);
    const rows = [...preview.rows, ...preview.matches.map((m) => m.row)].map(
      ({ date, amount, payee, memo, importKey, isIncome, matchId }) => ({
        date,
        amount,
        payee,
        memo,
        importKey,
        isIncome,
        matchId,
      }),
    );
    // One row added, one matched.
    expect(await store.importTransactions(account.id, format, rows)).toBe(2);
    // The typed transaction is already matched, so the same match is refused.
    await expect(store.importTransactions(account.id, format, rows)).rejects.toThrow(
      "A transaction to match has changed since the preview",
    );
    // Sending the rows again as new adds nothing: the database also refuses duplicates.
    const asNew = rows.map((row) => ({ ...row, matchId: null }));
    expect(await store.importTransactions(account.id, format, asNew)).toBe(0);

    data = (await store.load())!;
    const imported = data.transactions.filter((t) => t.accountId === account.id);
    expect(
      imported.map((t) => [t.amount, t.importKey, t.payee, t.date, t.allocations.length]).sort(),
    ).toEqual([
      // The match keeps what was typed and takes the bank's key.
      [-450, `id:${run}-1`, "Typed coffee", "2030-01-01", 0],
      [10_000, `id:${run}-2`, "Pay", "2030-01-03", 0],
    ]);
    expect(data.accounts.find((a) => a.id === account.id)?.importFormat).toEqual(format);

    for (const tx of imported) await store.deleteTransaction(tx.id);
    await store.closeAccount(account.id);
    await store.signOut();
  }, 30_000);

  it("renames and reorders groups and envelopes", async () => {
    const store = createSupabaseStore(testEnv.url, testEnv.anonKey);
    await store.signIn(email, password);
    let data = (await store.load())!;
    const householdId = data.household.id;
    const run = `order-${Date.now()}`;
    await store.addGroup(householdId, run, 99);
    data = (await store.load())!;
    const group = data.groups.find((g) => g.name === run)!;
    for (const [i, name] of ["One", "Two", "Three"].entries()) {
      await store.addEnvelope(householdId, group.id, name, i);
    }
    data = (await store.load())!;
    const id = (name: string) =>
      data.envelopes.find((e) => e.groupId === group.id && e.name === name)!.id;
    const inOrder = <T extends { position: number; name: string }>(items: T[]) =>
      [...items].sort((x, y) => x.position - y.position).map((item) => item.name);

    await store.renameGroup(group.id, `${run} renamed`);
    await store.renameEnvelope(id("One"), "First");
    await store.reorderEnvelopes(group.id, [id("Three"), id("One"), id("Two")]);
    const groupIds = inOrder(data.groups).map(
      (name) => data.groups.find((g) => g.name === name)!.id,
    );
    const reversed = [...groupIds].reverse();
    await store.reorderGroups(householdId, reversed);

    const after = (await store.load())!;
    expect(after.groups.find((g) => g.id === group.id)!.name).toBe(`${run} renamed`);
    expect(inOrder(after.envelopes.filter((e) => e.groupId === group.id))).toEqual([
      "Three",
      "First",
      "Two",
    ]);
    expect([...after.groups].sort((x, y) => x.position - y.position).map((g) => g.id)).toEqual(
      reversed,
    );

    // An out-of-date list, a card's payment envelope, and a blank name are refused.
    await expect(store.reorderEnvelopes(group.id, [id("Two")])).rejects.toThrow(UserFacingError);
    await expect(store.reorderGroups(householdId, reversed.slice(1))).rejects.toThrow(
      UserFacingError,
    );
    const payment = after.envelopes.find((e) => e.cardAccountId);
    if (payment) {
      await expect(store.renameEnvelope(payment.id, "Mine")).rejects.toThrow(
        /named after its card/,
      );
    }
    await expect(store.renameGroup(group.id, " ")).rejects.toThrow(UserFacingError);

    // An envelope moves to another group and back; a payment envelope stays put.
    const elsewhere = groupIds.find((groupId) => groupId !== group.id)!;
    await store.moveEnvelope(id("Two"), elsewhere, 99);
    const moved = (await store.load())!.envelopes.find((e) => e.id === id("Two"))!;
    expect(moved).toMatchObject({ groupId: elsewhere, position: 99 });
    await store.moveEnvelope(id("Two"), group.id, 2);
    if (payment) {
      await expect(store.moveEnvelope(payment.id, group.id, 0)).rejects.toThrow(
        /stays in its group/,
      );
    }

    // Put the seeded order back and tidy up.
    await store.reorderGroups(householdId, groupIds);
    for (const name of ["First", "Two", "Three"]) {
      await store.deleteEnvelope(
        after.envelopes.find((e) => e.groupId === group.id && e.name === name)!.id,
      );
    }
    await store.deleteGroup(group.id);
    await store.signOut();
  }, 30_000);
});
