import { describe, expect, it } from "vitest";
import { CsvError } from "./csv";
import { buildBudgetMonth } from "./budgetMath";
import { monthHasPlan, planToCopy, previewEnvelopePlan } from "./envelopePlan";
import type { BudgetData, Transaction } from "./types";

function household(): BudgetData {
  return {
    household: { id: "h", name: "Home" },
    incomeRules: [],
    accounts: [],
    groups: [{ id: "bills", name: "Bills", position: 0 }],
    envelopes: [{ id: "rent", groupId: "bills", name: "Rent", position: 0, cardAccountId: null }],
    envelopeMonths: [
      { envelopeId: "rent", month: "2026-10", assigned: 0, released: 0, planned: 100_000 },
    ],
    transactions: [],
  };
}

describe("previewEnvelopePlan", () => {
  it("matches existing names ignoring case, and marks what is new", () => {
    const preview = previewEnvelopePlan(
      household(),
      "2026-10",
      "category,group,planned amount\n rent ,BILLS,1200\nWater,Bills,$45.50\nGroceries,Everyday,450",
    );
    expect(preview.invalid).toEqual([]);
    expect(preview.rows).toEqual([
      expect.objectContaining({
        envelope: "rent",
        planned: 120_000,
        newGroup: false,
        newEnvelope: false,
        previousPlanned: 100_000,
      }),
      expect.objectContaining({
        envelope: "Water",
        planned: 4_550,
        newGroup: false,
        newEnvelope: true,
        previousPlanned: null,
      }),
      expect.objectContaining({ group: "Everyday", newGroup: true, newEnvelope: true }),
    ]);
    expect(preview.newGroups).toBe(1);
    expect(preview.newEnvelopes).toBe(2);
  });

  it("compares Planned with the chosen month only", () => {
    const [rent] = previewEnvelopePlan(household(), "2026-11", "Rent,Bills,1000").rows;
    expect(rent?.previousPlanned).toBe(0);
  });

  it("uses header names in any order, or the column order without a header", () => {
    const withHeader = previewEnvelopePlan(
      household(),
      "2026-10",
      "Planned,Group,Envelope\n5,Fun,Games",
    );
    const without = previewEnvelopePlan(household(), "2026-10", "Games,Fun,5");
    for (const preview of [withHeader, without]) {
      expect(preview.rows).toEqual([
        expect.objectContaining({
          envelope: "Games",
          group: "Fun",
          planned: 500,
          line: preview === without ? 1 : 2,
        }),
      ]);
    }
  });

  it("reads a first row that names an envelope like a column as data", () => {
    expect(previewEnvelopePlan(household(), "2026-10", "Plan,Savings,25").rows).toEqual([
      expect.objectContaining({ envelope: "Plan", group: "Savings", planned: 2_500 }),
    ]);
  });

  it("treats a blank planned amount as zero", () => {
    expect(previewEnvelopePlan(household(), "2026-10", "Gifts,Fun,").rows[0]?.planned).toBe(0);
  });

  it("reports invalid rows with their line and keeps the valid ones", () => {
    const preview = previewEnvelopePlan(
      household(),
      "2026-10",
      [
        "category,group,planned amount",
        ",Bills,10",
        "Power,,10",
        "Power,Bills,ten",
        "Power,Bills,-5",
        "Power,Bills,1.234",
        "Power,Bills,20",
        "power,bills,30",
        `${"x".repeat(101)},Bills,1`,
      ].join("\n"),
    );
    expect(preview.rows.map((r) => r.line)).toEqual([7]);
    expect(preview.invalid).toEqual([
      { line: 2, message: "Category is missing" },
      { line: 3, message: "Group is missing" },
      { line: 4, message: 'Planned amount "ten" is not an amount like 12.34' },
      { line: 5, message: "Planned amount cannot be negative" },
      { line: 6, message: 'Planned amount "1.234" is not an amount like 12.34' },
      { line: 8, message: "Same group and category as line 7" },
      { line: 9, message: "Category must be 100 characters or fewer" },
    ]);
  });

  it("rejects files it cannot use at all", () => {
    expect(() => previewEnvelopePlan(household(), "2026-10", "\n\n")).toThrow("The file is empty.");
    expect(() => previewEnvelopePlan(household(), "2026-10", "category,group,planned\n")).toThrow(
      "header but no rows",
    );
    expect(() => previewEnvelopePlan(household(), "2026-10", "category,group\nRent,Bills")).toThrow(
      CsvError,
    );
    const tooMany = Array.from({ length: 501 }, (_, i) => `E${i},G,1`).join("\n");
    expect(() => previewEnvelopePlan(household(), "2026-10", tooMany)).toThrow("at most 500");
  });
});

describe("copying a month's plan", () => {
  const spend = (id: string, envelopeId: string, date: string, amount: number): Transaction => ({
    id,
    accountId: "checking",
    date,
    amount,
    payee: "Shop",
    memo: "",
    isTransfer: false,
    isIncome: false,
    transferId: null,
    voided: false,
    allocations: [{ envelopeId, amount }],
    importKey: null,
    reconciled: false,
  });

  function twoMonths(): BudgetData {
    const data = household();
    return {
      ...data,
      accounts: [
        {
          id: "checking",
          name: "Checking",
          type: "checking",
          openingBalance: 500_000,
          openingDate: "2026-01-01",
          onBudget: true,
          closedAt: null,
          importFormat: null,
        },
        {
          id: "visa",
          name: "Visa",
          type: "credit_card",
          openingBalance: 0,
          openingDate: "2026-01-01",
          onBudget: true,
          closedAt: null,
          importFormat: null,
        },
      ],
      groups: [...data.groups, { id: "cards", name: "Credit card payments", position: 1 }],
      envelopes: [
        ...data.envelopes,
        { id: "food", groupId: "bills", name: "Food", position: 1, cardAccountId: null },
        { id: "fun", groupId: "bills", name: "Fun", position: 2, cardAccountId: null },
        { id: "visa-pay", groupId: "cards", name: "Visa", position: 0, cardAccountId: "visa" },
      ],
      envelopeMonths: [
        ...data.envelopeMonths,
        { envelopeId: "food", month: "2026-10", assigned: 40_000, released: 0, planned: 0 },
      ],
      transactions: [
        spend("t1", "food", "2026-10-03", -12_345),
        // A refund nets against the month's spending.
        spend("t2", "food", "2026-10-09", 2_345),
        // Refunds beyond the spending: Spent shows $0.00, so nothing to copy.
        spend("t3", "fun", "2026-10-11", 1_000),
        // Next month's spending is not last month's.
        spend("t4", "rent", "2026-11-01", -100_000),
        { ...spend("t5", "food", "2026-10-12", -5_000), accountId: "visa" },
      ],
    };
  }

  it("copies last month's Planned, leaving out envelopes at $0.00", () => {
    expect(planToCopy(twoMonths(), "2026-11", "planned")).toEqual([
      { envelopeId: "rent", planned: 100_000 },
    ]);
  });

  it("copies last month's Spent as shown, refunds netted, card payment envelopes left out", () => {
    expect(planToCopy(twoMonths(), "2026-11", "spent")).toEqual([
      { envelopeId: "food", planned: 15_000 },
    ]);
  });

  it("never overwrites a Planned already set in the month", () => {
    const data = twoMonths();
    data.envelopeMonths.push(
      { envelopeId: "food", month: "2026-11", assigned: 0, released: 0, planned: 9_900 },
      // A stored $0.00 is still empty, so it is filled.
      { envelopeId: "rent", month: "2026-11", assigned: 0, released: 0, planned: 0 },
    );
    expect(planToCopy(data, "2026-11", "spent")).toEqual([]);
    expect(planToCopy(data, "2026-11", "planned")).toEqual([
      { envelopeId: "rent", planned: 100_000 },
    ]);
  });

  it("a month has a plan once some envelope's Planned is above $0.00", () => {
    const data = twoMonths();
    expect(monthHasPlan(buildBudgetMonth(data, "2026-10"))).toBe(true);
    // A stored record with Planned $0.00 is not a plan.
    expect(monthHasPlan(buildBudgetMonth(data, "2026-11"))).toBe(false);
    const zeroed = {
      ...data,
      envelopeMonths: data.envelopeMonths.map((r) => ({ ...r, planned: 0 })),
    };
    expect(monthHasPlan(buildBudgetMonth(zeroed, "2026-10"))).toBe(false);
  });
});
