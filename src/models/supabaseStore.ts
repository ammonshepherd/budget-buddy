/**
 * DataStore backed by Supabase. Row Level Security on every table limits
 * each user to their own household, so these queries need no household filter.
 */
import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";
import { UserFacingError, type DataStore, type UserSession } from "./dataStore";
import { fetchAll } from "./fetchAll";
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

    async signOut() {
      const { error } = await db().auth.signOut();
      if (error) throw error;
    },

    async load() {
      const household = await db().from("households").select("id, name").maybeSingle();
      check(household.error);
      if (!household.data) return null;

      // Each query is paged, so each ends its order on a unique key: rows
      // tied on the earlier columns then keep their place between pages.
      const exact = { count: "exact" } as const;
      const [accounts, groups, envelopes, months, transactions, rules] = await Promise.all([
        fetchAll(
          (from, to) =>
            db()
              .from("accounts")
              .select("*", exact)
              .order("created_at")
              .order("id")
              .range(from, to),
          check,
        ),
        fetchAll(
          (from, to) => db().from("category_groups").select("*", exact).order("id").range(from, to),
          check,
        ),
        fetchAll(
          (from, to) => db().from("categories").select("*", exact).order("id").range(from, to),
          check,
        ),
        fetchAll(
          (from, to) =>
            db()
              .from("category_months")
              .select("*", exact)
              .order("category_id")
              .order("month")
              .range(from, to),
          check,
        ),
        fetchAll(
          (from, to) =>
            db()
              .from("transactions")
              .select("*, transaction_allocations(category_id, amount)", exact)
              .order("date", { ascending: false })
              .order("created_at", { ascending: false })
              .order("id", { ascending: false })
              .range(from, to),
          check,
        ),
        fetchAll(
          (from, to) =>
            db()
              .from("income_rules")
              .select("id, pattern, account_id", exact)
              .order("created_at")
              .order("id")
              .range(from, to),
          check,
        ),
      ]);

      return {
        household: household.data,
        incomeRules: rules.map((r) => ({
          id: r.id,
          pattern: r.pattern,
          accountId: r.account_id,
        })),
        accounts: accounts.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type === "credit_card" ? "credit_card" : "checking",
          openingBalance: a.opening_balance,
          openingDate: a.opening_date,
          onBudget: a.on_budget,
          closedAt: a.closed_at,
          importFormat: asImportFormat(a.import_format),
        })),
        groups: groups.map((g) => ({ id: g.id, name: g.name, position: g.position })),
        envelopes: envelopes.map((c) => ({
          id: c.id,
          groupId: c.group_id,
          name: c.name,
          position: c.position,
          cardAccountId: c.card_account_id,
        })),
        envelopeMonths: months.map((m) => ({
          envelopeId: m.category_id,
          month: m.month,
          assigned: m.assigned,
          released: m.released,
          planned: m.planned,
        })),
        transactions: transactions.map((t) => ({
          id: t.id,
          accountId: t.account_id,
          date: t.date,
          amount: t.amount,
          payee: t.payee,
          memo: t.memo,
          isTransfer: t.is_transfer,
          isIncome: t.is_income,
          transferId: t.transfer_id,
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

    async renameGroup(groupId, name) {
      const { data, error } = await db()
        .from("category_groups")
        .update({ name })
        .eq("id", groupId)
        .select("id");
      check(error);
      if (!data?.length) throw new UserFacingError("Group not found");
    },

    async renameEnvelope(envelopeId, name) {
      const { data, error } = await db()
        .from("categories")
        .update({ name })
        .eq("id", envelopeId)
        .select("id");
      check(error);
      if (!data?.length) throw new UserFacingError("Envelope not found");
    },

    async moveEnvelope(envelopeId, groupId, position) {
      const { data, error } = await db()
        .from("categories")
        .update({ group_id: groupId, position })
        .eq("id", envelopeId)
        .select("id");
      check(error);
      if (!data?.length) throw new UserFacingError("Envelope not found");
    },

    async reorderGroups(householdId, groupIds) {
      const { error } = await db().rpc("reorder_category_groups", {
        p_household_id: householdId,
        p_group_ids: groupIds,
      });
      check(error);
    },

    async reorderEnvelopes(groupId, envelopeIds) {
      const { error } = await db().rpc("reorder_categories", {
        p_group_id: groupId,
        p_category_ids: envelopeIds,
      });
      check(error);
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
        // The generated types mark SQL arguments as non-null, but p_id
        // accepts null (create).
        p_id: input.id ?? (null as unknown as string),
        p_allocations: input.allocations.map((a) => ({
          category_id: a.envelopeId,
          amount: a.amount,
        })),
        p_account_id: input.accountId,
        p_date: input.date,
        p_amount: input.amount,
        p_payee: input.payee,
        p_memo: input.memo,
        p_is_transfer: false,
        p_is_income: input.isIncome,
      });
      check(error);
    },

    async addIncomeRule(householdId, rule) {
      const { error } = await db()
        .from("income_rules")
        .insert({ household_id: householdId, pattern: rule.pattern, account_id: rule.accountId });
      check(error);
    },

    async deleteIncomeRule(ruleId) {
      check((await db().from("income_rules").delete().eq("id", ruleId)).error);
    },

    async markIncome(transactionIds) {
      const { data, error } = await db().rpc("mark_income", { p_ids: transactionIds });
      check(error);
      return data ?? 0;
    },

    async saveTransfer(input) {
      const { error } = await db().rpc("save_transfer", {
        // null = a new transfer (the generated types mark it non-null).
        p_transfer_id: input.transferId ?? (null as unknown as string),
        p_legs: input.sides.map((side) => ({
          id: side.id ?? null,
          account_id: side.accountId,
          date: side.date,
          amount: side.amount,
          payee: side.payee,
          memo: side.memo,
        })),
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
          is_income: r.isIncome,
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
