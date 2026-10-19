/**
 * Row Level Security: each test user sees and changes only their own
 * household. Signed in with the publishable key, exactly as the app is.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/models/database.types";
import { HOUSEHOLD_A, HOUSEHOLD_B } from "../scripts/seed-test-db";
import { signInAs, skipReason, testEnv } from "./testDb";

type Client = SupabaseClient<Database>;

interface Side {
  db: Client;
  householdId: string;
  accountId: string;
  envelopeId: string;
  groupId: string;
  transactionId: string;
}

async function load(db: Client, householdName: string): Promise<Side> {
  const household = await db.from("households").select("id, name").single();
  expect(household.error).toBeNull();
  expect(household.data!.name).toBe(householdName);
  const first = async (table: "accounts" | "categories" | "category_groups" | "transactions") => {
    const { data, error } = await db.from(table).select("id").limit(1).single();
    expect(error).toBeNull();
    return data!.id;
  };
  return {
    db,
    householdId: household.data!.id,
    accountId: await first("accounts"),
    envelopeId: await first("categories"),
    groupId: await first("category_groups"),
    transactionId: await first("transactions"),
  };
}

describe.skipIf(!!skipReason)("Row Level Security between test households", () => {
  let a: Side;
  let b: Side;

  beforeAll(async () => {
    a = await load(await signInAs(testEnv.users.a), HOUSEHOLD_A);
    b = await load(await signInAs(testEnv.users.b), HOUSEHOLD_B);
  });

  // Each direction: "me" tries to read and change "them".
  for (const [meName, themName] of [
    ["A", "B"],
    ["B", "A"],
  ] as const) {
    const pick = () => (meName === "A" ? { me: a, them: b } : { me: b, them: a });

    describe(`user ${meName}`, () => {
      it("reads its own household's accounts, transactions and envelopes", async () => {
        const { me } = pick();
        for (const table of ["accounts", "transactions", "categories"] as const) {
          const { data, error } = await me.db.from(table).select("household_id");
          expect(error).toBeNull();
          expect(data!.length).toBeGreaterThan(0);
          expect(data!.every((row) => row.household_id === me.householdId)).toBe(true);
        }
      });

      it(`gets no rows from household ${themName}`, async () => {
        const { me, them } = pick();
        const tables = [
          "accounts",
          "transactions",
          "categories",
          "category_groups",
          "category_months",
          "transaction_allocations",
          "income_rules",
          "household_members",
        ] as const;
        for (const table of tables) {
          const { data, error } = await me.db
            .from(table)
            .select("household_id")
            .eq("household_id", them.householdId);
          expect(error, table).toBeNull();
          expect(data, table).toEqual([]);
        }
        const { data } = await me.db.from("households").select("id").eq("id", them.householdId);
        expect(data).toEqual([]);
        const byId = await me.db.from("accounts").select("id").eq("id", them.accountId);
        expect(byId.data).toEqual([]);
      });

      it(`cannot add rows to household ${themName}`, async () => {
        const { me, them } = pick();
        const account = await me.db.from("accounts").insert({
          household_id: them.householdId,
          name: "Intruder",
          type: "checking",
          opening_balance: 0,
          opening_date: "2026-01-01",
        });
        expect(account.error?.code).toBe("42501");
        const group = await me.db
          .from("category_groups")
          .insert({ household_id: them.householdId, name: "Intruder", position: 9 });
        expect(group.error?.code).toBe("42501");
        const envelope = await me.db.from("categories").insert({
          household_id: them.householdId,
          group_id: them.groupId,
          name: "Intruder",
          position: 9,
        });
        expect(envelope.error?.code).toBe("42501");

        // The app's SQL functions refuse too.
        const tx = await me.db.rpc("save_transaction", {
          p_id: null as unknown as string,
          p_account_id: them.accountId,
          p_date: "2026-01-01",
          p_amount: -100,
          p_payee: "Intruder",
          p_memo: "",
          p_is_transfer: false,
          p_is_income: false,
          p_allocations: [],
        });
        expect(tx.error?.message).toMatch(/Account not found/);
        const assign = await me.db.rpc("adjust_category_month", {
          p_category_id: them.envelopeId,
          p_month: "2026-01",
          p_assigned_delta: 100,
          p_released_delta: 0,
        });
        expect(assign.error?.message).toMatch(/Envelope not found/);
      });

      it(`cannot change or delete rows in household ${themName}`, async () => {
        const { me, them } = pick();
        // RLS hides the rows, so updates and deletes match nothing.
        const renamed = await me.db
          .from("accounts")
          .update({ name: "Hacked" })
          .eq("id", them.accountId)
          .select("id");
        expect(renamed.error).toBeNull();
        expect(renamed.data).toEqual([]);
        const deleted = await me.db
          .from("transactions")
          .delete()
          .eq("id", them.transactionId)
          .select("id");
        expect(deleted.error).toBeNull();
        expect(deleted.data).toEqual([]);
        const reconciled = await me.db.rpc("set_reconciled", {
          p_ids: [them.transactionId],
          p_reconciled: true,
        });
        expect(reconciled.error).toBeNull();
        expect(reconciled.data).toBe(0);
        const household = await me.db
          .from("households")
          .update({ name: "Hacked" })
          .eq("id", them.householdId)
          .select("id");
        expect(household.data ?? []).toEqual([]);

        // Their owner still sees everything unchanged.
        const account = await them.db.from("accounts").select("name").eq("id", them.accountId);
        expect(account.data![0]!.name).not.toBe("Hacked");
        const tx = await them.db
          .from("transactions")
          .select("id, reconciled")
          .eq("id", them.transactionId);
        expect(tx.data).toEqual([{ id: them.transactionId, reconciled: false }]);
        const own = await them.db.from("households").select("name").single();
        expect(own.data!.name).toBe(meName === "A" ? HOUSEHOLD_B : HOUSEHOLD_A);
      });
    });
  }
});

if (skipReason) console.warn(`Integration tests skipped: ${skipReason}`);
