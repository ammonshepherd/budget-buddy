/**
 * Full backup of a household's budget as one JSON file, and the checks a file
 * must pass before it is restored.
 *
 * The file mirrors the database tables (snake_case, amounts in cents) minus
 * household_id, and carries everything a plain "what the app shows" export
 * would lose: reconciled and voided marks, import keys (so later bank CSV
 * imports still skip rows already imported), where a row came from (`source`),
 * transfer links, splits, closed accounts, each card's payment envelope, the
 * saved CSV column mappings and when rows were created (ties in a day keep
 * their order). The SQL functions export_backup / restore_backup read and
 * write it; see supabase/migrations/20261020105751_backup_restore.sql.
 *
 * validateBackup checks the same rules the database enforces, so a broken or
 * hand-edited file is refused with a clear message before anything is sent,
 * and the in-memory store (UI tests) behaves like the database.
 */
import { UserFacingError } from "./dataStore";
import { isMonth, monthOf, type Month } from "./month";
import type { BudgetData } from "./types";

export const BACKUP_FORMAT = "budget-buddy-backup";
export const BACKUP_VERSION = 1;

export interface BackupAccount {
  id: string;
  name: string;
  type: "checking" | "credit_card";
  opening_balance: number;
  opening_date: string;
  on_budget: boolean;
  closed_at: string | null;
  import_format: unknown;
  created_at: string | null;
}

export interface BackupGroup {
  id: string;
  name: string;
  position: number;
  created_at: string | null;
}

export interface BackupEnvelope {
  id: string;
  group_id: string;
  name: string;
  position: number;
  /** Set on a credit card's payment envelope. */
  card_account_id: string | null;
  created_at: string | null;
}

export interface BackupEnvelopeMonth {
  category_id: string;
  month: string;
  assigned: number;
  released: number;
  planned: number;
}

export interface BackupTransaction {
  id: string;
  account_id: string;
  date: string;
  amount: number;
  payee: string;
  memo: string;
  is_transfer: boolean;
  is_income: boolean;
  transfer_id: string | null;
  voided: boolean;
  import_key: string | null;
  reconciled: boolean;
  source: "manual" | "csv";
  created_at: string | null;
}

export interface BackupAllocation {
  transaction_id: string;
  category_id: string;
  amount: number;
}

export interface BackupIncomeRule {
  pattern: string;
  account_id: string | null;
  created_at: string | null;
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exported_at: string;
  /** The app version that wrote the file (informational). */
  app_version?: string;
  household: { name: string };
  accounts: BackupAccount[];
  category_groups: BackupGroup[];
  /** Envelopes (the database calls them categories). */
  categories: BackupEnvelope[];
  category_months: BackupEnvelopeMonth[];
  transactions: BackupTransaction[];
  transaction_allocations: BackupAllocation[];
  income_rules: BackupIncomeRule[];
}

/** Largest amount the database accepts (its bigint checks). */
const MAX_AMOUNT = 999_999_999_999;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export class BackupError extends UserFacingError {}

const fail = (message: string): never => {
  throw new BackupError(`This backup cannot be restored: ${message}`);
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Reads one list of rows, checking each field's type. */
function rows<T>(
  file: Record<string, unknown>,
  key: string,
  fields: Record<string, (value: unknown) => boolean>,
): T[] {
  const list = file[key];
  if (!Array.isArray(list)) return fail(`its ${key} list is missing.`);
  list.forEach((row, index) => {
    if (!isObject(row)) return fail(`${key} row ${index + 1} is not an object.`);
    for (const [field, ok] of Object.entries(fields)) {
      if (!ok(row[field])) fail(`${key} row ${index + 1} has a bad ${field}.`);
    }
  });
  return list as T[];
}

const text =
  (max: number, min = 0) =>
  (v: unknown) =>
    typeof v === "string" && v.length <= max && v.trim().length >= min;
const name = text(100, 1);
const id = (v: unknown) => typeof v === "string" && v.length > 0;
const optionalId = (v: unknown) => v === null || id(v);
const bool = (v: unknown) => typeof v === "boolean";
const int = (v: unknown) => Number.isSafeInteger(v);
const amount = (v: unknown) => int(v) && Math.abs(v as number) <= MAX_AMOUNT;
const nonZero = (v: unknown) => amount(v) && v !== 0;
const notNegative = (v: unknown) => amount(v) && (v as number) >= 0;
const date = (v: unknown) => typeof v === "string" && DATE.test(v);
const timestamp = (v: unknown) =>
  v === null || v === undefined || (typeof v === "string" && !Number.isNaN(Date.parse(v)));

/** Throws a BackupError when a value is not a usable backup; otherwise it is one. */
export function validateBackup(value: unknown): Backup {
  if (!isObject(value) || value.format !== BACKUP_FORMAT) {
    return fail("it is not a Budget Buddy backup file.");
  }
  if (value.version !== BACKUP_VERSION) {
    return fail(
      `it was made by a different version of the backup format (${String(value.version)}).`,
    );
  }
  if (!isObject(value.household) || !name(value.household.name)) {
    return fail("the household name is missing.");
  }

  const accounts = rows<BackupAccount>(value, "accounts", {
    id,
    name,
    type: (v) => v === "checking" || v === "credit_card",
    opening_balance: amount,
    opening_date: date,
    on_budget: bool,
    closed_at: timestamp,
    import_format: (v) => v === null || v === undefined || isObject(v),
    created_at: timestamp,
  });
  const groups = rows<BackupGroup>(value, "category_groups", {
    id,
    name,
    position: int,
    created_at: timestamp,
  });
  const envelopes = rows<BackupEnvelope>(value, "categories", {
    id,
    group_id: id,
    name,
    position: int,
    card_account_id: optionalId,
    created_at: timestamp,
  });
  const months = rows<BackupEnvelopeMonth>(value, "category_months", {
    category_id: id,
    month: (v) => typeof v === "string" && isMonth(v),
    assigned: amount,
    released: notNegative,
    planned: notNegative,
  });
  const transactions = rows<BackupTransaction>(value, "transactions", {
    id,
    account_id: id,
    date,
    amount: nonZero,
    payee: text(200),
    memo: text(500),
    is_transfer: bool,
    is_income: bool,
    transfer_id: optionalId,
    voided: bool,
    import_key: (v) => v === null || (typeof v === "string" && v.length >= 1 && v.length <= 300),
    reconciled: bool,
    source: (v) => v === "manual" || v === "csv",
    created_at: timestamp,
  });
  const allocations = rows<BackupAllocation>(value, "transaction_allocations", {
    transaction_id: id,
    category_id: id,
    amount: nonZero,
  });
  const rules = rows<BackupIncomeRule>(value, "income_rules", {
    pattern: text(100, 2),
    account_id: optionalId,
    created_at: timestamp,
  });

  const unique = <T>(list: T[], key: (row: T) => string, what: string) => {
    const seen = new Set<string>();
    for (const row of list) {
      const k = key(row);
      if (seen.has(k)) fail(`${what} appears twice.`);
      seen.add(k);
    }
  };
  unique(accounts, (a) => a.id, "an account id");
  unique(groups, (g) => g.id, "a group id");
  unique(envelopes, (e) => e.id, "an envelope id");
  unique(transactions, (t) => t.id, "a transaction id");
  unique(months, (m) => `${m.category_id} ${m.month}`, "an envelope month");
  unique(allocations, (a) => `${a.transaction_id} ${a.category_id}`, "an envelope in one split");
  unique(
    transactions.filter((t) => t.import_key !== null),
    (t) => `${t.account_id} ${t.import_key}`,
    "a bank import key in one account",
  );

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const groupIds = new Set(groups.map((g) => g.id));
  const envelopeById = new Map(envelopes.map((e) => [e.id, e]));
  const transactionById = new Map(transactions.map((t) => [t.id, t]));

  // Envelopes, and one payment envelope per credit card.
  const paymentFor = new Map<string, string>();
  for (const e of envelopes) {
    if (!groupIds.has(e.group_id)) fail(`envelope “${e.name}” is in a missing group.`);
    if (e.card_account_id === null) continue;
    const card = accountById.get(e.card_account_id);
    if (card?.type !== "credit_card") fail(`envelope “${e.name}” pays a missing card.`);
    if (paymentFor.has(e.card_account_id)) fail(`card “${card?.name}” has two payment envelopes.`);
    paymentFor.set(e.card_account_id, e.id);
  }
  for (const a of accounts) {
    if (a.type === "credit_card" && !paymentFor.has(a.id)) {
      fail(`card “${a.name}” has no payment envelope.`);
    }
  }
  for (const m of months) {
    if (!envelopeById.has(m.category_id)) fail(`an envelope month (${m.month}) has no envelope.`);
  }
  for (const r of rules) {
    if (r.account_id !== null && !accountById.has(r.account_id)) {
      fail(`income rule “${r.pattern}” names a missing account.`);
    }
  }

  // Transactions and transfers.
  const sides = new Map<string, BackupTransaction[]>();
  for (const t of transactions) {
    const account = accountById.get(t.account_id);
    if (!account) return fail(`a transaction on ${t.date} is in a missing account.`);
    if (t.is_transfer !== (t.transfer_id !== null)) {
      fail(`a transaction on ${t.date} is half marked as a transfer.`);
    }
    if (t.is_income && (t.amount < 0 || t.is_transfer || account.type === "credit_card")) {
      fail(`a transaction on ${t.date} is marked Income but cannot be.`);
    }
    if (t.transfer_id !== null) {
      sides.set(t.transfer_id, [...(sides.get(t.transfer_id) ?? []), t]);
    }
  }
  for (const pair of sides.values()) {
    const [a, b] = pair;
    if (
      !a ||
      !b ||
      pair.length !== 2 ||
      a.account_id === b.account_id ||
      a.amount + b.amount !== 0
    ) {
      fail(
        `a transfer on ${pair[0]?.date} does not have two sides in different accounts that cancel out.`,
      );
    }
  }

  // Envelope lines (one for a normal transaction, several for a split).
  const lines = new Map<string, BackupAllocation[]>();
  for (const line of allocations) {
    const t = transactionById.get(line.transaction_id);
    if (!t) return fail("an envelope line belongs to a missing transaction.");
    const envelope = envelopeById.get(line.category_id);
    if (!envelope) return fail(`a transaction on ${t.date} is in a missing envelope.`);
    if (envelope.card_account_id !== null) {
      fail(`a transaction on ${t.date} is in a card's payment envelope.`);
    }
    lines.set(t.id, [...(lines.get(t.id) ?? []), line]);
  }
  for (const [transactionId, list] of lines) {
    const t = transactionById.get(transactionId)!;
    const card = accountById.get(t.account_id)?.type === "credit_card";
    if (t.is_transfer) fail(`a transfer on ${t.date} is in an envelope.`);
    if (t.is_income) fail(`Income on ${t.date} is in an envelope.`);
    if (card && t.amount > 0) fail(`a card credit on ${t.date} is in an envelope.`);
    if (list.some((line) => Math.sign(line.amount) !== Math.sign(t.amount))) {
      fail(`a split on ${t.date} has a line going the other way.`);
    }
    if (list.reduce((sum, line) => sum + line.amount, 0) !== t.amount) {
      fail(`the envelope lines of a transaction on ${t.date} do not add up to its amount.`);
    }
  }

  return value as unknown as Backup;
}

/** Reads a backup file's text; throws a BackupError when it cannot be restored. */
export function parseBackup(fileText: string): Backup {
  let value: unknown;
  try {
    value = JSON.parse(fileText);
  } catch {
    return fail("it is not a JSON file.");
  }
  return validateBackup(value);
}

/**
 * The same backup with every id replaced by a new one (links kept), so it can
 * be restored in the same database as the household it came from.
 */
export function withFreshIds(
  backup: Backup,
  newId: () => string = () => crypto.randomUUID(),
): Backup {
  const ids = new Map<string, string>();
  const fresh = (old: string) => {
    let next = ids.get(old);
    if (!next) {
      next = newId();
      ids.set(old, next);
    }
    return next;
  };
  const maybe = (old: string | null) => (old === null ? null : fresh(old));
  return {
    ...backup,
    household: { ...backup.household },
    accounts: backup.accounts.map((a) => ({ ...a, id: fresh(a.id) })),
    category_groups: backup.category_groups.map((g) => ({ ...g, id: fresh(g.id) })),
    categories: backup.categories.map((e) => ({
      ...e,
      id: fresh(e.id),
      group_id: fresh(e.group_id),
      card_account_id: maybe(e.card_account_id),
    })),
    category_months: backup.category_months.map((m) => ({
      ...m,
      category_id: fresh(m.category_id),
    })),
    transactions: backup.transactions.map((t) => ({
      ...t,
      id: fresh(t.id),
      account_id: fresh(t.account_id),
      transfer_id: maybe(t.transfer_id),
    })),
    transaction_allocations: backup.transaction_allocations.map((x) => ({
      ...x,
      transaction_id: fresh(x.transaction_id),
      category_id: fresh(x.category_id),
    })),
    income_rules: backup.income_rules.map((r) => ({ ...r, account_id: maybe(r.account_id) })),
  };
}

export interface BackupSummary {
  householdName: string;
  exportedAt: string;
  accounts: number;
  envelopes: number;
  transactions: number;
  incomeRules: number;
  /** Months with transactions or a stored Planned/Assigned/Released, oldest first. */
  months: Month[];
}

export function summarizeBackup(backup: Backup): BackupSummary {
  const months = new Set<Month>(backup.transactions.map((t) => monthOf(t.date)));
  for (const m of backup.category_months) {
    if (m.planned !== 0 || m.assigned !== 0 || m.released !== 0) months.add(m.month);
  }
  return {
    householdName: backup.household.name,
    exportedAt: backup.exported_at,
    accounts: backup.accounts.length,
    envelopes: backup.categories.length,
    transactions: backup.transactions.length,
    incomeRules: backup.income_rules.length,
    months: [...months].sort(),
  };
}

/** A household can take a restore only when it holds no budget data at all. */
export function isEmptyHousehold(data: BudgetData): boolean {
  return (
    data.accounts.length === 0 &&
    data.groups.length === 0 &&
    data.envelopes.length === 0 &&
    data.envelopeMonths.length === 0 &&
    data.transactions.length === 0 &&
    data.incomeRules.length === 0
  );
}

export const NOT_EMPTY = "A backup can only be restored into an empty household";

/** "budget-buddy-backup-2026-10-20.json" */
export function backupFileName(today: string): string {
  return `budget-buddy-backup-${today}.json`;
}
