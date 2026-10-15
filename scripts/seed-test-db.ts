/**
 * Resets the test database to a known state: two confirmed test users, each
 * with their own household and made-up data.
 *
 *   npm run db:seed:test
 *
 * Refuses to run against anything but the test project or a local Supabase.
 * Uses the service-role key (from .env.test or the environment, never a
 * VITE_ variable) only to delete and create the users and their households;
 * all budget data is written while signed in as each user, through the same
 * tables and SQL functions the app uses, so the same triggers and Row Level
 * Security apply. Run it again any time: it starts from scratch each time.
 *
 * Node runs this TypeScript file directly (Node 23+ strips the types), so
 * local imports end in .ts.
 */
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/models/database.types.ts";
import { assertTestTarget } from "./testTarget.ts";
import { readTestEnv, writeEnvValue, type TestEnv, type TestUser } from "./testEnv.ts";

type Client = SupabaseClient<Database>;

export const HOUSEHOLD_A = "Test Household A";
export const HOUSEHOLD_B = "Test Household B";
const DEFAULT_EMAILS = { a: "test-a@budgetbuddy.test", b: "test-b@budgetbuddy.test" };

interface Result {
  error: { message: string } | null;
}

/** Throws on a Supabase error. */
function check(result: Result, what: string): void {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
}

/** Throws on a Supabase error or missing data, and returns the data. */
function must<T>(result: Result & { data: T }, what: string): NonNullable<T> {
  check(result, what);
  if (result.data == null) throw new Error(`${what}: no data`);
  return result.data;
}

/** "YYYY-MM" for this month (offset 0) or an earlier one (offset -1, …). */
function month(offset: number, today = new Date()): string {
  const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** A date in that month; this month's dates never go past today. */
function day(offset: number, dayOfMonth: number, today = new Date()): string {
  const d = offset === 0 ? Math.min(dayOfMonth, today.getDate()) : dayOfMonth;
  return `${month(offset, today)}-${String(d).padStart(2, "0")}`;
}

/** Fills in emails and generates any missing password (saved to .env.test). */
function completeUsers(env: TestEnv): TestEnv["users"] {
  const users = { a: { ...env.users.a }, b: { ...env.users.b } };
  for (const key of ["a", "b"] as const) {
    const name = `TEST_USER_${key.toUpperCase()}`;
    if (!users[key].email) {
      users[key].email = DEFAULT_EMAILS[key];
      writeEnvValue(`${name}_EMAIL`, users[key].email);
    }
    if (!users[key].password) {
      users[key].password = randomBytes(24).toString("base64url");
      writeEnvValue(`${name}_PASSWORD`, users[key].password);
    }
  }
  return users;
}

async function findUserId(admin: Client, email: string): Promise<string | null> {
  for (let page = 1; ; page++) {
    const listed = await admin.auth.admin.listUsers({ page, perPage: 200 });
    check(listed, "list users");
    const users = listed.data.users;
    const user = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (user) return user.id;
    if (users.length < 200) return null;
  }
}

/**
 * Deletes the user's household (everything in it goes with it) and returns
 * a confirmed user with the given password, creating it if needed.
 */
async function resetUser(admin: Client, user: TestUser, householdName: string): Promise<void> {
  const userId = await findUserId(admin, user.email);
  if (userId) {
    const members = must(
      await admin.from("household_members").select("household_id").eq("user_id", userId),
      "find household",
    );
    const ids = members.map((m) => m.household_id);
    if (ids.length)
      check(await admin.from("households").delete().in("id", ids), "delete household");
    check(
      await admin.auth.admin.updateUserById(userId, {
        password: user.password,
        email_confirm: true,
      }),
      "update user",
    );
  } else {
    // email_confirm skips the confirmation email, so no SMTP is needed.
    check(
      await admin.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
      }),
      "create user",
    );
  }
  // Leftover households with this name and no members (e.g. a failed run).
  const orphans = must(
    await admin
      .from("households")
      .select("id, household_members(user_id)")
      .eq("name", householdName),
    "find old households",
  ).filter((h) => !h.household_members.length);
  if (orphans.length) {
    check(
      await admin
        .from("households")
        .delete()
        .in(
          "id",
          orphans.map((h) => h.id),
        ),
      "delete old households",
    );
  }
}

/** Signs in as the user with the publishable key, as the app does. */
async function signIn(env: TestEnv, user: TestUser): Promise<Client> {
  const client = createClient<Database>(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  check(await client.auth.signInWithPassword(user), `sign in as ${user.email}`);
  return client;
}

/** Small helpers mirroring src/models/supabaseStore.ts. */
function budgetWriter(db: Client, householdId: string) {
  return {
    async account(name: string, type: "checking" | "credit_card", openingBalance: number) {
      const row = must(
        await db
          .from("accounts")
          .insert({
            household_id: householdId,
            name,
            type,
            opening_balance: openingBalance,
            opening_date: day(-1, 1),
          })
          .select("id")
          .single(),
        `add account ${name}`,
      );
      return row.id;
    },
    async group(name: string, position: number) {
      return must(
        await db
          .from("category_groups")
          .insert({ household_id: householdId, name, position })
          .select("id")
          .single(),
        `add group ${name}`,
      ).id;
    },
    async envelope(groupId: string, name: string, position: number) {
      return must(
        await db
          .from("categories")
          .insert({ household_id: householdId, group_id: groupId, name, position })
          .select("id")
          .single(),
        `add envelope ${name}`,
      ).id;
    },
    async assign(envelopeId: string, monthKey: string, assigned: number) {
      check(
        await db.rpc("adjust_category_month", {
          p_category_id: envelopeId,
          p_month: monthKey,
          p_assigned_delta: assigned,
          p_released_delta: 0,
        }),
        "assign",
      );
    },
    async plan(envelopeId: string, monthKey: string, planned: number) {
      check(
        await db
          .from("category_months")
          .upsert(
            { household_id: householdId, category_id: envelopeId, month: monthKey, planned },
            { onConflict: "category_id,month" },
          ),
        "set planned",
      );
    },
    async transaction(
      accountId: string,
      date: string,
      amount: number,
      payee: string,
      lines: { envelopeId: string; amount: number }[] = [],
      isIncome = false,
    ) {
      check(
        await db.rpc("save_transaction", {
          p_id: null as unknown as string,
          p_account_id: accountId,
          p_date: date,
          p_amount: amount,
          p_payee: payee,
          p_memo: "seed",
          p_is_transfer: false,
          p_is_income: isIncome,
          p_allocations: lines.map((l) => ({ category_id: l.envelopeId, amount: l.amount })),
        }),
        `save transaction ${payee}`,
      );
    },
    async transfer(fromId: string, toId: string, date: string, amount: number, payee: string) {
      check(
        await db.rpc("save_transfer", {
          p_transfer_id: null as unknown as string,
          p_legs: [
            { id: null, account_id: fromId, date, amount: -amount, payee, memo: "seed" },
            { id: null, account_id: toId, date, amount, payee, memo: "seed" },
          ],
        }),
        `save transfer ${payee}`,
      );
    },
  };
}

async function createHousehold(db: Client, name: string): Promise<string> {
  check(await db.rpc("create_household", { p_name: name }), `create ${name}`);
  return must(await db.from("households").select("id").single(), "read household").id;
}

/**
 * Household A covers what the tests need: a checking account and a credit
 * card, groups and envelopes with Planned and Assigned for last month and
 * this month (so Saved carries over), salary income (and a "salary" income
 * rule), categorized spending, an Uncategorized outflow to review, a split,
 * a card payment (linked transfer) and a card credit. Amounts are cents.
 */
async function seedHouseholdA(db: Client): Promise<void> {
  const householdId = await createHousehold(db, HOUSEHOLD_A);
  const w = budgetWriter(db, householdId);
  const [prev, now] = [month(-1), month(0)];

  const checking = await w.account("Test Checking", "checking", 250_000);
  // A card's balance is negative when money is owed. The database creates
  // its "Test Visa payment" envelope in the "Credit card payments" group.
  const card = await w.account("Test Visa", "credit_card", -30_000);
  const payment = must(
    await db.from("categories").select("id").eq("card_account_id", card).single(),
    "find card payment envelope",
  ).id;

  const bills = await w.group("Bills", 0);
  const everyday = await w.group("Everyday", 1);
  const rent = await w.envelope(bills, "Rent", 0);
  const utilities = await w.envelope(bills, "Utilities", 1);
  const groceries = await w.envelope(everyday, "Groceries", 0);
  const dining = await w.envelope(everyday, "Dining Out", 1);
  const fun = await w.envelope(everyday, "Fun Money", 2);

  const budget: [string, number, number][] = [
    // envelope, planned, assigned (same both months)
    [rent, 120_000, 120_000],
    [utilities, 20_000, 20_000],
    [groceries, 50_000, 50_000],
    [dining, 15_000, 15_000],
    [fun, 10_000, 10_000],
  ];
  for (const m of [prev, now]) {
    for (const [envelope, planned, assigned] of budget) {
      await w.plan(envelope, m, planned);
      await w.assign(envelope, m, assigned);
    }
  }
  // Cash set aside to pay the card this month.
  await w.assign(payment, now, 15_000);

  check(
    await db.from("income_rules").insert({ household_id: householdId, pattern: "salary" }),
    "add income rule",
  );

  // Last month: everything categorized; Groceries, Utilities and Fun have money left (Saved).
  await w.transaction(checking, day(-1, 1), 300_000, "ACME Corp salary", [], true);
  await w.transaction(checking, day(-1, 2), -120_000, "Landlord", [
    { envelopeId: rent, amount: -120_000 },
  ]);
  await w.transaction(checking, day(-1, 10), -18_500, "City Power", [
    { envelopeId: utilities, amount: -18_500 },
  ]);
  await w.transaction(checking, day(-1, 12), -42_000, "Fresh Market", [
    { envelopeId: groceries, amount: -42_000 },
  ]);

  // This month.
  await w.transaction(checking, day(0, 1), 300_000, "ACME Corp salary", [], true);
  await w.transaction(checking, day(0, 1), -120_000, "Landlord", [
    { envelopeId: rent, amount: -120_000 },
  ]);
  await w.transaction(checking, day(0, 2), -6_543, "Fresh Market", [
    { envelopeId: groceries, amount: -6_543 },
  ]);
  // A split: one purchase, two envelopes.
  await w.transaction(checking, day(0, 3), -12_000, "Big Box Store", [
    { envelopeId: groceries, amount: -8_000 },
    { envelopeId: fun, amount: -4_000 },
  ]);
  // Uncategorized: waits in "To review".
  await w.transaction(checking, day(0, 4), -1_999, "Mystery Charge");
  // A card purchase in an envelope (moves money into the card's payment envelope).
  await w.transaction(card, day(0, 2), -4_250, "Noodle House", [
    { envelopeId: dining, amount: -4_250 },
  ]);
  // A card payment: one linked transfer, checking → card.
  await w.transfer(checking, card, day(0, 5), 15_000, "Test Visa payment");
  // A card credit: an inflow on the card that only lowers what is owed.
  await w.transaction(card, day(0, 5), 2_500, "Statement credit");
}

/** Household B: a little data of its own, to prove A cannot see or change it. */
async function seedHouseholdB(db: Client): Promise<void> {
  const householdId = await createHousehold(db, HOUSEHOLD_B);
  const w = budgetWriter(db, householdId);
  const now = month(0);
  const checking = await w.account("B Checking", "checking", 100_000);
  const home = await w.group("Home", 0);
  const groceries = await w.envelope(home, "B Groceries", 0);
  await w.plan(groceries, now, 20_000);
  await w.assign(groceries, now, 20_000);
  await w.transaction(checking, day(0, 1), 50_000, "B Employer salary", [], true);
  await w.transaction(checking, day(0, 2), -2_500, "Corner Shop", [
    { envelopeId: groceries, amount: -2_500 },
  ]);
}

/** Resets both test users and households. Exported for the integration test setup. */
export async function seedTestDb(): Promise<void> {
  const env = readTestEnv();
  assertTestTarget(env.url);
  if (!env.anonKey) throw new Error("VITE_SUPABASE_ANON_KEY is missing (see .env.test.example).");
  if (!env.serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing (see .env.test.example).");
  }
  const users = completeUsers(env);

  const admin = createClient<Database>(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await resetUser(admin, users.a, HOUSEHOLD_A);
  await resetUser(admin, users.b, HOUSEHOLD_B);

  const seeded = { ...env, users };
  await seedHouseholdA(await signIn(seeded, users.a));
  await seedHouseholdB(await signIn(seeded, users.b));
}

// Run when called as a script (not when imported by the test setup).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  seedTestDb().then(
    () => console.log("Seeded the test database: Test Household A and Test Household B."),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
