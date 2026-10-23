/**
 * Transaction CSV import. Every bank exports different columns, date styles
 * and sign conventions, so a file is read through an ImportFormat that says
 * which column holds what. `detectFormat` guesses one from the header names
 * and the values; the user can correct it, and it is saved on the account so
 * the next file from the same bank needs no setup.
 *
 * Duplicates are recognised by an import key: the bank's transaction ID when
 * the file has one, otherwise date + amount + description (+ how many times
 * that exact row has appeared earlier in the file).
 *
 * A bank row that matches a transaction the user typed into the account
 * (same amount, dated within IMPORT_MATCH_DAYS) is matched to it instead of
 * being added again: the typed transaction takes the row's import key, so it
 * counts as imported (cleared), and keeps everything the user entered.
 */
import { CsvError, type CsvRow } from "./csv";
import { incomeRuleFor } from "./incomeRules";
import { parseCents, type Cents } from "./money";
import { daysBetween } from "./transfers";
import type { Account, BudgetData, IsoDate, Transaction } from "./types";

export const MAX_IMPORT_ROWS = 2000;
/** How far apart a bank row and a typed transaction may be dated to match. */
export const IMPORT_MATCH_DAYS = 10;
const MAX_PAYEE = 200;
const MAX_MEMO = 500;
const MAX_AMOUNT: Cents = 999_999_999_999;

/** Order of day, month and year in the file's dates. */
export type DateOrder = "MDY" | "DMY" | "YMD";

export type AmountColumns =
  /** One column, signed. `flip` for files that show spending as positive. */
  | { kind: "signed"; column: number; flip: boolean }
  /** Separate money-out and money-in columns. */
  | { kind: "split"; outflow: number; inflow: number };

/** Which column holds what. Column numbers start at 0; -1 means none. */
export interface ImportFormat {
  version: 1;
  hasHeader: boolean;
  /** Header names (normalized) or, without a header, just the count, to recognise the bank's next file. */
  headers: string[];
  columnCount: number;
  date: number;
  dateOrder: DateOrder;
  description: number;
  memo: number;
  amount: AmountColumns;
  bankId: number;
}

/** The part of a CSV that holds transactions. */
export interface CsvTable {
  /** Header cells, or null when the file starts straight with data. */
  header: string[] | null;
  rows: CsvRow[];
  columnCount: number;
}

/** One transaction ready to save (always Uncategorized), or a match. */
export interface ImportedTransaction {
  date: IsoDate;
  amount: Cents;
  payee: string;
  memo: string;
  importKey: string;
  /** Marked Income by an income rule (inflows only). */
  isIncome: boolean;
  /**
   * A typed-in transaction this row matches: it takes the import key and
   * keeps the rest; nothing is added. Null = a new transaction.
   */
  matchId: string | null;
}

export interface ImportPreviewRow extends ImportedTransaction {
  line: number;
}

export interface SkippedImportRow {
  line: number;
  date: IsoDate;
  amount: Cents;
  payee: string;
  reason: string;
}

/** A bank row and the typed-in transaction it matches. */
export interface ImportMatch {
  row: ImportPreviewRow;
  tx: Transaction;
  /** The user chose to import the row as a new transaction instead. */
  separate: boolean;
}

export interface TransactionImportPreview {
  /** Rows added as new transactions (including matches kept separate). */
  rows: ImportPreviewRow[];
  /** Rows matched to typed-in transactions, in file order. */
  matches: ImportMatch[];
  duplicates: SkippedImportRow[];
  beforeOpening: SkippedImportRow[];
  invalid: { line: number; message: string }[];
  inflow: Cents;
  outflow: Cents;
  firstDate: IsoDate | null;
  lastDate: IsoDate | null;
  /** True when 70%+ of amounts are positive: a card export may need `flip`. */
  mostlyPositive: boolean;
  /** New inflows an income rule marks as Income. */
  markedIncome: number;
}

const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const DATE_LIKE = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})/;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const NAMED_DATE = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i;

const looksLikeDate = (text: string) => DATE_LIKE.test(text.trim()) || NAMED_DATE.test(text.trim());

/**
 * Finds the transaction table: skips any lines a bank puts above it (account
 * name, date range) by starting at the first row with the most common number
 * of cells, and decides whether that row is a header.
 */
export function readTable(rows: CsvRow[]): CsvTable {
  if (rows.length === 0) throw new CsvError("The file is empty.");
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.cells.length, (counts.get(row.cells.length) ?? 0) + 1);
  const columnCount = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]![0];
  const start = rows.findIndex((row) => row.cells.length === columnCount);
  const first = rows[start]!;
  const hasHeader = !first.cells.some((cell) => looksLikeDate(cell));
  const data = rows.slice(hasHeader ? start + 1 : start);
  if (data.length === 0) throw new CsvError("The file has a header but no transactions.");
  if (data.length > MAX_IMPORT_ROWS) {
    throw new CsvError(`A file can have at most ${MAX_IMPORT_ROWS} transactions.`);
  }
  return {
    header: hasHeader ? first.cells.map((c) => c.trim()) : null,
    rows: data,
    columnCount,
  };
}

/** "Date (10/12/26)"-style labels for choosing columns. */
export function columnLabels(table: CsvTable): string[] {
  return Array.from({ length: table.columnCount }, (_, i) => {
    const name = table.header?.[i] || `Column ${i + 1}`;
    const sample = table.rows.map((r) => (r.cells[i] ?? "").trim()).find((v) => v !== "");
    const short = sample && sample.length > 24 ? `${sample.slice(0, 24)}…` : sample;
    return short ? `${name} (${short})` : name;
  });
}

/** Reads a date in the given order. Two-digit years are 20xx. */
export function parseImportDate(text: string, order: DateOrder): IsoDate | null {
  const value = text.trim();
  let year: number;
  let month: number;
  let day: number;
  const named = NAMED_DATE.exec(value);
  const numeric = DATE_LIKE.exec(value);
  if (named) {
    month = MONTHS.indexOf(named[1]!.toLowerCase()) + 1;
    day = Number(named[2]);
    year = Number(named[3]);
    if (month === 0) return null;
  } else if (numeric) {
    const [a, b, c] = [numeric[1]!, numeric[2]!, numeric[3]!];
    if (order === "YMD") [year, month, day] = [Number(a), Number(b), Number(c)];
    else if (order === "DMY") [day, month, year] = [Number(a), Number(b), Number(c)];
    else [month, day, year] = [Number(a), Number(b), Number(c)];
    const yearText = order === "YMD" ? a : c;
    if (yearText.length === 2) year += 2000;
    else if (yearText.length !== 4) return null;
  } else {
    return null;
  }
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Reads a bank amount: "-$18.62", "1,234.56", "+5", "(18.62)" (negative). */
export function parseImportAmount(text: string): Cents | null {
  let value = text.trim().replace(/\s/g, "").replace(/−/g, "-");
  let negative = false;
  const parens = /^\((.*)\)$/.exec(value);
  if (parens) {
    negative = true;
    value = parens[1]!;
  }
  value = value.replace(/^\+/, "");
  const cents = parseCents(value);
  if (cents === null) return null;
  return negative ? -Math.abs(cents) : cents;
}

const findColumn = (names: string[], options: string[], exclude: number[] = []) => {
  for (const option of options) {
    const i = names.findIndex((n, index) => n === option && !exclude.includes(index));
    if (i >= 0) return i;
  }
  return -1;
};

/** Guesses the format from header names, or from the values without a header. */
export function detectFormat(table: CsvTable): ImportFormat {
  const values = (i: number) =>
    table.rows.map((r) => (r.cells[i] ?? "").trim()).filter((v) => v !== "");
  const columns = Array.from({ length: table.columnCount }, (_, i) => i);
  const mostly = (i: number, test: (v: string) => boolean) => {
    const vs = values(i);
    return vs.length > 0 && vs.filter(test).length / vs.length >= 0.8;
  };
  const isDateColumn = (i: number) => mostly(i, looksLikeDate);
  const isAmountColumn = (i: number) =>
    mostly(i, (v) => !looksLikeDate(v) && parseImportAmount(v) !== null);

  const names = table.header?.map(normalize) ?? [];
  let date = findColumn(names, [
    "date",
    "transactiondate",
    "transdate",
    "posteddate",
    "postingdate",
    "postdate",
  ]);
  if (date < 0) date = columns.find(isDateColumn) ?? -1;

  let amount: AmountColumns;
  const signed = findColumn(names, ["amount", "transactionamount", "amountusd"]);
  const outflow = findColumn(names, [
    "debit",
    "debits",
    "withdrawal",
    "withdrawals",
    "moneyout",
    "debitamount",
    "outflow",
  ]);
  const inflow = findColumn(names, [
    "credit",
    "credits",
    "deposit",
    "deposits",
    "moneyin",
    "creditamount",
    "inflow",
  ]);
  if (signed >= 0) amount = { kind: "signed", column: signed, flip: false };
  else if (outflow >= 0 && inflow >= 0) amount = { kind: "split", outflow, inflow };
  else {
    const balance = findColumn(names, ["balance", "runningbalance"]);
    const guess = columns.find((i) => i !== date && i !== balance && isAmountColumn(i));
    amount = { kind: "signed", column: guess ?? -1, flip: false };
  }

  const used = [
    date,
    ...(amount.kind === "signed" ? [amount.column] : [amount.outflow, amount.inflow]),
  ];
  let description = findColumn(
    names,
    [
      "description",
      "payee",
      "name",
      "merchant",
      "details",
      "transactiondescription",
      "originaldescription",
      "merchantname",
    ],
    used,
  );
  if (description < 0) {
    // Without a header: the column with the longest text that is not a date or amount.
    const lengths = columns
      .filter((i) => !used.includes(i) && !isDateColumn(i) && !isAmountColumn(i))
      .map((i) => [i, values(i).join("").length] as const)
      .sort((a, b) => b[1] - a[1]);
    description = lengths[0]?.[0] ?? -1;
  }
  const memo = findColumn(
    names,
    ["memo", "notes", "note", "extendeddescription"],
    [...used, description],
  );
  const bankId = findColumn(
    names,
    [
      "transactionid",
      "referencenumber",
      "reference",
      "refnumber",
      "fitid",
      "transactionnumber",
      "id",
    ],
    [...used, description],
  );

  // Day-first or year-first only when the dates themselves prove it.
  let dateOrder: DateOrder = "MDY";
  for (const v of date >= 0 ? values(date) : []) {
    const m = DATE_LIKE.exec(v);
    if (!m) continue;
    if (m[1]!.length === 4) dateOrder = "YMD";
    else if (Number(m[1]) > 12) dateOrder = "DMY";
    if (dateOrder !== "MDY") break;
  }

  return {
    version: 1,
    hasHeader: table.header !== null,
    headers: names,
    columnCount: table.columnCount,
    date,
    dateOrder,
    description,
    memo,
    amount,
    bankId,
  };
}

/** Whether a saved format fits this file (same headers, or same column count without one). */
export function formatMatches(format: ImportFormat, table: CsvTable): boolean {
  if (format.columnCount !== table.columnCount) return false;
  if (format.hasHeader !== (table.header !== null)) return false;
  if (!table.header) return true;
  const names = table.header.map(normalize);
  return names.length === format.headers.length && names.every((n, i) => n === format.headers[i]);
}

/** The saved format when it fits the file, else a fresh guess. */
export function formatFor(account: Account | undefined, table: CsvTable) {
  const saved = account?.importFormat;
  if (saved && formatMatches(saved, table)) return { format: saved, saved: true };
  return { format: detectFormat(table), saved: false };
}

/** What still has to be chosen before the file can be read, or null. */
export function formatProblem(format: ImportFormat): string | null {
  const valid = (i: number) => i >= 0 && i < format.columnCount;
  if (!valid(format.date)) return "Choose the column with the date.";
  if (format.amount.kind === "signed" && !valid(format.amount.column)) {
    return "Choose the column with the amount.";
  }
  if (
    format.amount.kind === "split" &&
    (!valid(format.amount.outflow) || !valid(format.amount.inflow))
  ) {
    return "Choose both the money-out and the money-in columns.";
  }
  if (format.amount.kind === "split" && format.amount.outflow === format.amount.inflow) {
    return "Money out and money in must be different columns.";
  }
  return null;
}

/** Checks a format loaded from the database; returns null if it is not one. */
export function asImportFormat(value: unknown): ImportFormat | null {
  if (!value || typeof value !== "object") return null;
  const f = value as Partial<ImportFormat>;
  const int = (n: unknown) => Number.isInteger(n);
  const amountOk =
    (f.amount?.kind === "signed" && int(f.amount.column) && typeof f.amount.flip === "boolean") ||
    (f.amount?.kind === "split" && int(f.amount.outflow) && int(f.amount.inflow));
  const ok =
    f.version === 1 &&
    typeof f.hasHeader === "boolean" &&
    Array.isArray(f.headers) &&
    f.headers.every((h) => typeof h === "string") &&
    int(f.columnCount) &&
    int(f.date) &&
    int(f.description) &&
    int(f.memo) &&
    int(f.bankId) &&
    ["MDY", "DMY", "YMD"].includes(f.dateOrder as string) &&
    amountOk;
  return ok ? (f as ImportFormat) : null;
}

const cleanText = (text: string) => text.replace(/\s+/g, " ").trim();

function readAmount(row: CsvRow, amount: AmountColumns): Cents | string {
  const cell = (i: number) => (row.cells[i] ?? "").trim();
  if (amount.kind === "signed") {
    const text = cell(amount.column);
    if (!text) return "Amount is missing";
    const value = parseImportAmount(text);
    if (value === null) return `Amount "${text}" is not a number`;
    return amount.flip ? -value : value;
  }
  const outText = cell(amount.outflow);
  const inText = cell(amount.inflow);
  if (!outText && !inText) return "Amount is missing";
  const out = outText ? parseImportAmount(outText) : 0;
  const into = inText ? parseImportAmount(inText) : 0;
  if (out === null) return `Money out "${outText}" is not a number`;
  if (into === null) return `Money in "${inText}" is not a number`;
  return Math.abs(into) - Math.abs(out);
}

/**
 * Pairs bank rows with transactions typed into the account (no import key,
 * not voided) of the same amount, dated within IMPORT_MATCH_DAYS. Each side
 * is used once; the closest dates pair first (then file order, then the
 * earlier typed transaction). Returns the typed transaction per row line.
 */
export function findImportMatches(
  data: BudgetData,
  accountId: string,
  rows: Pick<ImportPreviewRow, "line" | "date" | "amount">[],
): Map<number, Transaction> {
  const typed = data.transactions.filter(
    (t) => t.accountId === accountId && t.importKey === null && !t.voided,
  );
  const pairs: { line: number; tx: Transaction; away: number }[] = [];
  for (const row of rows) {
    for (const tx of typed) {
      const away = Math.abs(daysBetween(tx.date, row.date));
      if (tx.amount === row.amount && away <= IMPORT_MATCH_DAYS) {
        pairs.push({ line: row.line, tx, away });
      }
    }
  }
  pairs.sort(
    (a, b) =>
      a.away - b.away ||
      a.line - b.line ||
      a.tx.date.localeCompare(b.tx.date) ||
      a.tx.id.localeCompare(b.tx.id),
  );
  const matches = new Map<number, Transaction>();
  const used = new Set<string>();
  for (const { line, tx } of pairs) {
    if (matches.has(line) || used.has(tx.id)) continue;
    matches.set(line, tx);
    used.add(tx.id);
  }
  return matches;
}

/**
 * Reads every row through the format and sorts it into: new transactions,
 * matches with typed-in transactions, duplicates (already in the account, or
 * repeated in the file), rows dated before the account's opening date
 * (already part of its opening balance), and invalid rows. `separate` lists
 * the lines of matches the user wants imported as new transactions instead.
 */
export function previewTransactionImport(
  data: BudgetData,
  account: Account,
  table: CsvTable,
  format: ImportFormat,
  separate: ReadonlySet<number> = new Set(),
): TransactionImportPreview {
  const existing = new Set(
    data.transactions
      .filter((tx) => tx.accountId === account.id && tx.importKey)
      .map((tx) => tx.importKey!),
  );
  const seenKeys = new Map<string, number>();
  const fingerprints = new Map<string, number>();
  const preview: TransactionImportPreview = {
    rows: [],
    matches: [],
    duplicates: [],
    beforeOpening: [],
    invalid: [],
    inflow: 0,
    outflow: 0,
    firstDate: null,
    lastDate: null,
    mostlyPositive: false,
    markedIncome: 0,
  };
  let positives = 0;
  let amounts = 0;
  const fresh: Omit<ImportPreviewRow, "isIncome" | "matchId">[] = [];

  for (const row of table.rows) {
    const cell = (i: number) => (i >= 0 ? (row.cells[i] ?? "").trim() : "");
    const dateText = cell(format.date);
    const date = parseImportDate(dateText, format.dateOrder);
    if (!date) {
      preview.invalid.push({
        line: row.line,
        message: dateText ? `Date "${dateText}" is not a date` : "Date is missing",
      });
      continue;
    }
    const amount = readAmount(row, format.amount);
    if (typeof amount === "string") {
      preview.invalid.push({ line: row.line, message: amount });
      continue;
    }
    if (amount === 0) {
      preview.invalid.push({ line: row.line, message: "Amount is $0.00" });
      continue;
    }
    if (Math.abs(amount) > MAX_AMOUNT) {
      preview.invalid.push({ line: row.line, message: "Amount is too large" });
      continue;
    }
    amounts++;
    if (amount > 0) positives++;

    const description = cleanText(cell(format.description));
    const payee = description.slice(0, MAX_PAYEE);
    const memo = [cleanText(cell(format.memo)), description.length > MAX_PAYEE ? description : ""]
      .filter(Boolean)
      .join(" · ")
      .slice(0, MAX_MEMO);

    const bankId = cell(format.bankId);
    let importKey: string;
    if (bankId) {
      importKey = `id:${bankId}`.slice(0, 300);
    } else {
      const print = `${date}|${amount}|${description.toLowerCase().slice(0, 200)}`;
      const n = fingerprints.get(print) ?? 0;
      fingerprints.set(print, n + 1);
      importKey = `fp:${print}|${n}`;
    }

    const skipped = { line: row.line, date, amount, payee };
    const firstLine = seenKeys.get(importKey);
    if (firstLine !== undefined) {
      preview.duplicates.push({ ...skipped, reason: `Same bank ID as line ${firstLine}` });
      continue;
    }
    seenKeys.set(importKey, row.line);
    if (existing.has(importKey)) {
      preview.duplicates.push({ ...skipped, reason: "Already imported" });
      continue;
    }
    if (date < account.openingDate) {
      preview.beforeOpening.push({
        ...skipped,
        reason: `Before the account's opening date (${account.openingDate})`,
      });
      continue;
    }

    fresh.push({ line: row.line, date, amount, payee, memo, importKey });
  }

  const matched = findImportMatches(data, account.id, fresh);
  for (const row of fresh) {
    const tx = matched.get(row.line);
    if (tx) {
      const isSeparate = separate.has(row.line);
      preview.matches.push({
        row: { ...row, isIncome: false, matchId: tx.id },
        tx,
        separate: isSeparate,
      });
      if (!isSeparate) continue;
    }
    const { amount, payee, date } = row;
    // A tracking account never has Income.
    const isIncome =
      account.onBudget &&
      incomeRuleFor(data.incomeRules, { accountId: account.id, amount, payee }) !== null;
    if (isIncome) preview.markedIncome++;
    preview.rows.push({ ...row, isIncome, matchId: null });
    if (amount > 0) preview.inflow += amount;
    else preview.outflow -= amount;
    if (!preview.firstDate || date < preview.firstDate) preview.firstDate = date;
    if (!preview.lastDate || date > preview.lastDate) preview.lastDate = date;
  }

  preview.mostlyPositive = amounts >= 3 && positives / amounts >= 0.7;
  return preview;
}
