/**
 * Searching and sorting an open account's transactions (Accounts page).
 * One search field: typed words match payee and memo (or an amount), and a
 * choice from its drop-down (an envelope, or a kind such as Income) keeps
 * only those transactions. Pure and display only: no budget math here.
 */
import type { ActivityDay, ActivityRow } from "./activity";
import type { Cents } from "./money";
import type { PickerOption } from "./envelopeSearch";
import type { BudgetData, IsoDate } from "./types";

/** Kinds of transaction the drop-down offers besides envelopes. */
export type SearchKind = "uncategorized" | "income" | "transfer" | "card-credit";

/** A drop-down choice: one envelope, or one kind. */
export type SearchFilter = { envelopeId: string } | { kind: SearchKind };

export type SortOrder =
  "newest" | "oldest" | "amount-large" | "amount-small" | "payee" | "envelope";

export const SORT_ORDERS: { value: SortOrder; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "amount-large", label: "Largest" },
  { value: "amount-small", label: "Smallest" },
  { value: "payee", label: "Payee A–Z" },
  { value: "envelope", label: "Envelope A–Z" },
];

/** Whether the order keeps the day headings (dates) or lists rows with their date. */
export const sortsByDate = (order: SortOrder) => order === "newest" || order === "oldest";

const KINDS: { kind: SearchKind; label: string }[] = [
  { kind: "uncategorized", label: "Uncategorized" },
  { kind: "income", label: "Income" },
  { kind: "transfer", label: "Transfer" },
  { kind: "card-credit", label: "Card credit" },
];

/** A matching row with its date, and the part of it that matched. */
export interface FoundRow {
  date: IsoDate;
  row: ActivityRow;
  /**
   * Signed. The row's amount, except a split with an envelope chosen: only
   * that envelope's part, so the total is what the envelope got here.
   */
  amount: Cents;
}

/** The drop-down value of a choice ("envelope:<id>" or "kind:<kind>"). */
export function filterValue(filter: SearchFilter): string {
  return "envelopeId" in filter ? `envelope:${filter.envelopeId}` : `kind:${filter.kind}`;
}

/** The choice a drop-down value stands for. */
export function filterFromValue(value: string): SearchFilter | null {
  const [type, id] = [value.slice(0, value.indexOf(":")), value.slice(value.indexOf(":") + 1)];
  if (type === "envelope" && id) return { envelopeId: id };
  const kind = KINDS.find((k) => k.kind === id);
  return type === "kind" && kind ? { kind: kind.kind } : null;
}

/** What a chip for the choice says. */
export function filterLabel(filter: SearchFilter, data: BudgetData): string {
  if ("envelopeId" in filter)
    return data.envelopes.find((e) => e.id === filter.envelopeId)?.name ?? "Unknown envelope";
  return KINDS.find((k) => k.kind === filter.kind)!.label;
}

function isKind(row: ActivityRow, kind: SearchKind): boolean {
  switch (kind) {
    case "uncategorized":
      return row.toReview;
    case "income":
      return row.tx.isIncome;
    case "transfer":
      return row.kind === "transfer";
    case "card-credit":
      return row.category === "Card credit";
  }
}

/** The row's amount that the choice keeps, or null when the choice leaves it out. */
function chosenAmount(row: ActivityRow, filter: SearchFilter | null): Cents | null {
  if (!filter) return row.amount;
  if ("kind" in filter) return isKind(row, filter.kind) ? row.amount : null;
  if (row.kind === "transfer") return null;
  const part = row.tx.allocations.find((a) => a.envelopeId === filter.envelopeId);
  if (!part) return null;
  return row.portions.length > 0 ? part.amount : row.amount;
}

const fold = (text: string) => text.toLocaleLowerCase().replace(/\s+/g, " ").trim();

/**
 * Typed text as an amount: "45" is $45.00–$45.99, "45.2" is $45.20–$45.29,
 * "45.20" or "$45" is exactly that (in or out). Null when it is not a number.
 */
export function amountQuery(text: string): ((cents: Cents) => boolean) | null {
  const typed = text
    .trim()
    .replace(/^[+−-]/, "")
    .trim();
  const match = /^(\$)?\s*(\d[\d,]*)?(?:\.(\d{0,2}))?$/.exec(typed);
  if (!match || (!match[2] && !match[3])) return null;
  const exact = match[1] !== undefined;
  const whole = Number((match[2] ?? "0").replace(/,/g, ""));
  const fraction = match[3] ?? "";
  if (exact || fraction.length === 2) {
    const cents = whole * 100 + Number(fraction.padEnd(2, "0"));
    return (amount) => Math.abs(amount) === cents;
  }
  if (fraction.length === 1) {
    const dimes = whole * 10 + Number(fraction);
    return (amount) => Math.floor(Math.abs(amount) / 10) === dimes;
  }
  return (amount) => Math.floor(Math.abs(amount) / 100) === whole;
}

/** Whether the typed text matches the row: every word in payee, memo or transfer line, or its amount. */
function textMatches(row: ActivityRow, text: string): boolean {
  const words = fold(text).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const transferLine = row.kind === "transfer" ? row.accountLine : "";
  const haystack = fold(`${row.tx.payee} ${row.tx.memo} ${transferLine}`);
  if (words.every((word) => haystack.includes(word))) return true;
  const amount = amountQuery(text);
  return (
    amount !== null && (amount(row.amount) || row.portions.some((part) => amount(part.amount)))
  );
}

/** The rows (newest first, as given) that the choice and typed text keep. */
export function findRows(
  days: ActivityDay[],
  filter: SearchFilter | null,
  text: string,
): FoundRow[] {
  const found: FoundRow[] = [];
  for (const day of days)
    for (const row of day.rows) {
      const amount = chosenAmount(row, filter);
      if (amount !== null && textMatches(row, text)) found.push({ date: day.date, row, amount });
    }
  return found;
}

/** What "Envelope A–Z" sorts a row by: its envelope, or a split's first part. */
const envelopeOf = (row: ActivityRow) => row.category || row.portions[0]?.envelopeName || "";

const compareText = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "base" });

/** The rows in the order chosen. Ties keep the order given (newest first). */
export function sortRows(found: FoundRow[], order: SortOrder): FoundRow[] {
  const rows = [...found];
  switch (order) {
    case "newest":
      return rows;
    case "oldest":
      return rows.reverse();
    case "amount-large":
      return rows.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    case "amount-small":
      return rows.sort((a, b) => Math.abs(a.amount) - Math.abs(b.amount));
    case "payee":
      return rows.sort((a, b) => compareText(a.row.tx.payee, b.row.tx.payee));
    case "envelope":
      return rows.sort((a, b) => compareText(envelopeOf(a.row), envelopeOf(b.row)));
  }
}

/**
 * Rows in date order back under day headings. A day's net adds the parts
 * that matched, transfers left out (as in the account's own list).
 */
export function regroupDays(found: FoundRow[]): ActivityDay[] {
  const days: ActivityDay[] = [];
  for (const { date, row, amount } of found) {
    let day = days[days.length - 1];
    if (day?.date !== date) {
      day = { date, net: 0, rows: [] };
      days.push(day);
    }
    day.rows.push(row);
    if (row.kind !== "transfer") day.net += amount;
  }
  return days;
}

/** The matches added up, signed (transfers too: it is what the list shows). */
export function foundTotal(found: FoundRow[]): Cents {
  return found.reduce((sum, f) => sum + f.amount, 0);
}

const countLabel = (n: number) => `${n} transaction${n === 1 ? "" : "s"}`;

/**
 * The drop-down's choices for an account's rows: the kinds, then envelopes
 * by group, each with how many of the rows it would keep. Only choices that
 * keep at least one row are offered.
 */
export function searchChoices(days: ActivityDay[], data: BudgetData): PickerOption[] {
  const rows = days.flatMap((day) => day.rows);
  const kinds = KINDS.map(({ kind, label }) => ({
    value: filterValue({ kind }),
    label,
    count: rows.filter((row) => isKind(row, kind)).length,
  }));

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.kind === "transfer") continue;
    for (const part of row.tx.allocations)
      counts.set(part.envelopeId, (counts.get(part.envelopeId) ?? 0) + 1);
  }
  const groups = new Map(data.groups.map((g) => [g.id, g]));
  const envelopes = data.envelopes
    .filter((e) => counts.has(e.id))
    .sort(
      (a, b) =>
        (groups.get(a.groupId)?.position ?? 0) - (groups.get(b.groupId)?.position ?? 0) ||
        a.position - b.position,
    )
    .map((e) => ({
      value: filterValue({ envelopeId: e.id }),
      label: e.name,
      group: groups.get(e.groupId)?.name ?? "Envelopes",
      count: counts.get(e.id)!,
    }));

  return [...kinds, ...envelopes]
    .filter((choice) => choice.count > 0)
    .map(({ count, ...choice }) => ({ ...choice, detail: countLabel(count) }));
}
