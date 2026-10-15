/**
 * Envelope plan import: a CSV of category (envelope), group and planned amount
 * for one month. Reading the file and checking it happen here, before anything
 * is saved, so the user sees a preview and every invalid row first.
 *
 * Names match existing groups and envelopes ignoring case and surrounding
 * spaces; anything not found is created. Planned is replaced for that month
 * only; envelopes missing from the file are left as they are.
 */
import { buildBudgetMonth, type BudgetMonthView } from "./budgetMath";
import { parseCents, type Cents } from "./money";
import { addMonths, type Month } from "./month";
import { CsvError, parseCsv, type CsvRow } from "./csv";
import type { BudgetData } from "./types";

export const MAX_PLAN_ROWS = 500;
const MAX_NAME = 100;
const MAX_PLANNED: Cents = 999_999_999_999;

/** One envelope's line in a plan, as saved. */
export interface EnvelopePlanRow {
  group: string;
  envelope: string;
  planned: Cents;
}

export interface PlanPreviewRow extends EnvelopePlanRow {
  line: number;
  newGroup: boolean;
  newEnvelope: boolean;
  /** Planned already stored for this month; null for a new envelope. */
  previousPlanned: Cents | null;
}

export interface InvalidPlanRow {
  line: number;
  message: string;
}

export interface PlanPreview {
  month: Month;
  rows: PlanPreviewRow[];
  invalid: InvalidPlanRow[];
  newGroups: number;
  newEnvelopes: number;
}

/** The key two names are compared by. */
export const nameKey = (name: string) => name.trim().toLocaleLowerCase();

type Columns = { envelope: number; group: number; planned: number };
const POSITIONAL: Columns = { envelope: 0, group: 1, planned: 2 };

/** Column order from a header row, or null when the first row is data. */
function headerColumns(row: CsvRow): Columns | null {
  const names = row.cells.map((c) => c.toLowerCase().replace(/[^a-z]/g, ""));
  const find = (...options: string[]) => names.findIndex((n) => options.includes(n));
  const columns = {
    envelope: find("category", "envelope"),
    group: find("group", "categorygroup", "envelopegroup"),
    planned: find("plannedamount", "planned", "plan", "amount"),
  };
  const found = Object.values(columns).filter((i) => i >= 0).length;
  // A first row ending in an amount is data, even if an envelope is named "Plan".
  const lastIsAmount = parseCents(row.cells[2] ?? "") !== null;
  if (found === 0 || (found < 3 && lastIsAmount)) return null;
  if (found < 3) {
    throw new CsvError("The header row needs three columns: category, group and planned amount.");
  }
  return columns;
}

function readRow(row: CsvRow, columns: Columns): EnvelopePlanRow | string {
  const cell = (i: number) => (row.cells[i] ?? "").trim();
  const envelope = cell(columns.envelope);
  const group = cell(columns.group);
  const plannedText = cell(columns.planned);

  if (!envelope) return "Category is missing";
  if (!group) return "Group is missing";
  if (envelope.length > MAX_NAME) return `Category must be ${MAX_NAME} characters or fewer`;
  if (group.length > MAX_NAME) return `Group must be ${MAX_NAME} characters or fewer`;
  const planned = plannedText === "" ? 0 : parseCents(plannedText);
  if (planned === null) return `Planned amount "${plannedText}" is not an amount like 12.34`;
  if (planned < 0) return "Planned amount cannot be negative";
  if (planned > MAX_PLANNED) return "Planned amount is too large";
  return { envelope, group, planned };
}

/**
 * Reads a plan CSV and compares it with the household's current envelopes.
 * Throws CsvError when the whole file is unusable; otherwise each bad row is
 * listed in `invalid` and left out of `rows`.
 */
export function previewEnvelopePlan(data: BudgetData, month: Month, text: string): PlanPreview {
  const csv = parseCsv(text);
  if (csv.length === 0) throw new CsvError("The file is empty.");
  const columns = headerColumns(csv[0]!);
  const dataRows = columns ? csv.slice(1) : csv;
  if (dataRows.length === 0) throw new CsvError("The file has a header but no rows.");
  if (dataRows.length > MAX_PLAN_ROWS) {
    throw new CsvError(`A plan can have at most ${MAX_PLAN_ROWS} rows.`);
  }

  // Existing names; the first by position wins if two share a name.
  const byPosition = <T extends { position: number }>(items: T[]) =>
    [...items].sort((a, b) => a.position - b.position);
  const groupIds = new Map<string, string>();
  for (const g of byPosition(data.groups)) {
    if (!groupIds.has(nameKey(g.name))) groupIds.set(nameKey(g.name), g.id);
  }
  const envelopeIds = new Map<string, string>();
  for (const e of byPosition(data.envelopes)) {
    const key = `${e.groupId}\n${nameKey(e.name)}`;
    if (!envelopeIds.has(key)) envelopeIds.set(key, e.id);
  }
  const plannedNow = new Map(
    data.envelopeMonths.filter((r) => r.month === month).map((r) => [r.envelopeId, r.planned]),
  );

  const rows: PlanPreviewRow[] = [];
  const invalid: InvalidPlanRow[] = [];
  const seen = new Map<string, number>();
  const newGroupKeys = new Set<string>();

  for (const row of dataRows) {
    const read = readRow(row, columns ?? POSITIONAL);
    if (typeof read === "string") {
      invalid.push({ line: row.line, message: read });
      continue;
    }
    const groupKey = nameKey(read.group);
    const rowKey = `${groupKey}\n${nameKey(read.envelope)}`;
    const firstLine = seen.get(rowKey);
    if (firstLine !== undefined) {
      invalid.push({ line: row.line, message: `Same group and category as line ${firstLine}` });
      continue;
    }
    seen.set(rowKey, row.line);

    const groupId = groupIds.get(groupKey);
    const envelopeId = groupId && envelopeIds.get(`${groupId}\n${nameKey(read.envelope)}`);
    if (!groupId) newGroupKeys.add(groupKey);
    rows.push({
      ...read,
      line: row.line,
      newGroup: !groupId,
      newEnvelope: !envelopeId,
      previousPlanned: envelopeId ? (plannedNow.get(envelopeId) ?? 0) : null,
    });
  }

  return {
    month,
    rows,
    invalid,
    newGroups: newGroupKeys.size,
    newEnvelopes: rows.filter((r) => r.newEnvelope).length,
  };
}

/** One envelope's Planned for a month, by id (what copying a month saves). */
export interface PlannedAmount {
  envelopeId: string;
  planned: Cents;
}

/** What a new month's plan can be copied from. */
export type PlanSource = "planned" | "spent";

/**
 * Whether the month has a plan: some envelope's Planned is above $0.00.
 * Planned is stored per envelope and month, so a month with every Planned at
 * $0.00 has no plan yet. Card payment envelopes have no Planned to set.
 */
export function monthHasPlan(view: BudgetMonthView): boolean {
  return view.groups.some((g) => g.envelopes.some((e) => !e.card && e.planned > 0));
}

/**
 * What copying last month into `month` sets: each envelope's Planned, or
 * Spent as shown (refunds netted, never below zero), in the month before.
 * Only envelopes whose Planned in `month` is still $0.00 are filled, so a
 * copy never overwrites a typed plan. Amounts of $0.00 and card payment
 * envelopes are left out.
 */
export function planToCopy(data: BudgetData, month: Month, source: PlanSource): PlannedAmount[] {
  const plannedNow = new Map(
    data.envelopeMonths.filter((r) => r.month === month).map((r) => [r.envelopeId, r.planned]),
  );
  return buildBudgetMonth(data, addMonths(month, -1))
    .groups.flatMap((g) => g.envelopes)
    .filter((e) => !e.card && !plannedNow.get(e.id))
    .map((e) => ({ envelopeId: e.id, planned: source === "planned" ? e.planned : e.outflow }))
    .filter((row) => row.planned > 0);
}
