/**
 * DataStore backed by Supabase. Row Level Security on every table limits
 * each user to their own household, so these queries need no household filter.
 */
import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";
import { UserFacingError, type DataStore, type UserSession } from "./dataStore";
import { asImportFormat } from "./transactionImport";

type Client = SupabaseClient<Database>;

/** Turns database errors into messages a person can act on. */
function check(error: PostgrestError | null): void {
  if (!error) return;
  if (error.code === "23503") {
    throw new UserFacingError("It is still in use. Move or delete what uses it first.");
  }
  // Our SQL functions raise readable messages with these codes.
  if (["23514", "23505", "P0002", "22023", "42501"].includes(error.code)) {
    throw new UserFacingError(error.message);
  }
  throw new Error(`${error.message} (${error.code})`);
}

function toSession(user: { id: string; email?: string } | null | undefined): UserSession | null {
  return user ? { userId: user.id, email: user.email ?? "" } : null;
}

export function createSupabaseStore(
  url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_ANON_KEY,
): DataStore {
  let client: Client | null = null;
  const db = (): Client => {
    if (!url || !key) {
      throw new UserFacingError(
        "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
      );
    }
    // PKCE puts the sign-in code in ?code=, leaving the #route hash alone.
    client ??= createClient<Database>(url, key, { auth: { flowType: "pkce" } });
    return client;
  };

  return {
    async getSession() {
      const { data, error } = await db().auth.getSession();
      if (error) throw error;
      return toSession(data.session?.user);
    },

    onSessionChange(callback) {
      const { data } = db().auth.onAuthStateChange((_event, session) =>
        callback(toSession(session?.user)),
      );
      return () => data.subscription.unsubscribe();
    },

    async signIn(email, password) {
      const { error } = await db().auth.signInWithPassword({ email, password });
      if (error) throw new UserFacingError(error.message);
    },

    async signUp(email, password) {
      const { data, error } = await db().auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
      });
      if (error) throw new UserFacingError(error.message);
      return data.session === null;
    },

    async signOut() {
      const { error } = await db().auth.signOut();
      if (error) throw error;
    },

    async load() {
      const household = await db().from("households").select("id, name").maybeSingle();
      check(household.error);
      if (!household.data) return null;

      const [accounts, groups, envelopes, months, transactions] = await Promise.all([
        db().from("accounts").select("*").order("created_at"),
        db().from("category_groups").select("*"),
        db().from("categories").select("*"),
        db().from("category_months").select("*"),
        db()
          .from("transactions")
          .select("*, transaction_allocations(category_id, amount)")
          .order("date", { ascending: false })
          .order("created_at", { ascending: false }),
      ]);
      for (const result of [accounts, groups, envelopes, months, transactions]) check(result.error);

      return {
        household: household.data,
        accounts: (accounts.data ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type === "credit_card" ? "credit_card" : "checking",
          openingBalance: a.opening_balance,
          openingDate: a.opening_date,
          onBudget: a.on_budget,
          closedAt: a.closed_at,
          importFormat: asImportFormat(a.import_format),
        })),
        groups: (groups.data ?? []).map((g) => ({ id: g.id, name: g.name, position: g.position })),
        envelopes: (envelopes.data ?? []).map((c) => ({
          id: c.id,
          groupId: c.group_id,
          name: c.name,
          position: c.position,
          cardAccountId: c.card_account_id,
        })),
        envelopeMonths: (months.data ?? []).map((m) => ({
          envelopeId: m.category_id,
          month: m.month,
          assigned: m.assigned,
          released: m.released,
          planned: m.planned,
        })),
        transactions: (transactions.data ?? []).map((t) => ({
          id: t.id,
          accountId: t.account_id,
          date: t.date,
          amount: t.amount,
          payee: t.payee,
          memo: t.memo,
          isTransfer: t.is_transfer,
          voided: t.voided,
          allocations: t.transaction_allocations.map((a) => ({
            envelopeId: a.category_id,
            amount: a.amount,
          })),
          importKey: t.import_key,
        })),
      };
    },

    async createHousehold(name) {
      check((await db().rpc("create_household", { p_name: name })).error);
    },

    async addAccount(householdId, account) {
      const { error } = await db().from("accounts").insert({
        household_id: householdId,
        name: account.name,
        type: account.type,
        opening_balance: account.openingBalance,
        opening_date: account.openingDate,
      });
      check(error);
    },

    async updateAccount(accountId, account) {
      const { data, error } = await db()
        .from("accounts")
        .update({
          name: account.name,
          opening_balance: account.openingBalance,
          opening_date: account.openingDate,
        })
        .eq("id", accountId)
        .select("id");
      check(error);
      // Row Level Security hides other households' accounts: no row, no update.
      if (!data?.length) throw new UserFacingError("Account not found");
    },

    async closeAccount(accountId) {
      const { error } = await db()
        .from("accounts")
        .update({ closed_at: new Date().toISOString() })
        .eq("id", accountId);
      check(error);
    },

    async addGroup(householdId, name, position) {
      check(
        (await db().from("category_groups").insert({ household_id: householdId, name, position }))
          .error,
      );
    },

    async addEnvelope(householdId, groupId, name, position) {
      const { error } = await db()
        .from("categories")
        .insert({ household_id: householdId, group_id: groupId, name, position });
      check(error);
    },

    async deleteEnvelope(envelopeId) {
      check((await db().from("categories").delete().eq("id", envelopeId)).error);
    },

    async deleteGroup(groupId) {
      check((await db().from("category_groups").delete().eq("id", groupId)).error);
    },

    async adjustEnvelopeMonth(envelopeId, month, change) {
      const { error } = await db().rpc("adjust_category_month", {
        p_category_id: envelopeId,
        p_month: month,
        p_assigned_delta: change.assigned ?? 0,
        p_released_delta: change.released ?? 0,
      });
      check(error);
    },

    async moveBetweenEnvelopes(fromId, toId, month, amount) {
      const { error } = await db().rpc("move_between_envelopes", {
        p_from_category_id: fromId,
        p_to_category_id: toId,
        p_month: month,
        p_amount: amount,
      });
      check(error);
    },

    async setPlanned(householdId, envelopeId, month, planned) {
      const { error } = await db()
        .from("category_months")
        .upsert(
          { household_id: householdId, category_id: envelopeId, month, planned },
          { onConflict: "category_id,month" },
        );
      check(error);
    },

    async importEnvelopePlan(householdId, month, rows) {
      const { error } = await db().rpc("import_envelope_plan", {
        p_household_id: householdId,
        p_month: month,
        p_rows: rows.map(({ group, envelope, planned }) => ({ group, envelope, planned })),
      });
      check(error);
    },

    async saveTransaction(_householdId, input) {
      const { error } = await db().rpc("save_transaction", {
        // The generated types mark SQL arguments as non-null, but both of
        // these accept null (create, and Uncategorized).
        p_id: input.id ?? (null as unknown as string),
        p_category_id: input.envelopeId ?? (null as unknown as string),
        p_account_id: input.accountId,
        p_date: input.date,
        p_amount: input.amount,
        p_payee: input.payee,
        p_memo: input.memo,
        p_is_transfer: input.isTransfer,
      });
      check(error);
    },

    async importTransactions(accountId, format, rows) {
      const { data, error } = await db().rpc("import_transactions", {
        p_account_id: accountId,
        p_format: format as unknown as Json,
        p_rows: rows.map((r) => ({
          date: r.date,
          amount: r.amount,
          payee: r.payee,
          memo: r.memo,
          import_key: r.importKey,
        })),
      });
      check(error);
      return data ?? 0;
    },

    async deleteTransaction(transactionId) {
      check((await db().from("transactions").delete().eq("id", transactionId)).error);
    },
  };
}
