import { describe, expect, it } from "vitest";
import { CsvError, parseCsv } from "./csv";
import {
  asImportFormat,
  columnLabels,
  detectFormat,
  formatFor,
  findImportMatches,
  formatProblem,
  parseImportAmount,
  parseImportDate,
  previewTransactionImport,
  readTable,
  type ImportFormat,
} from "./transactionImport";
import type { Account, BudgetData, Transaction } from "./types";

// Made-up rows in the layouts of a few common bank exports.
const CHECKING = [
  "Account ID,Transaction ID,Date,Description,Check Number,Category,Tags,Amount,Balance",
  'X-1,20261012:1,10/12/26,Withdrawal Debit Card HARDWARE STORE #12,,,,"-$18.62","$8,412.17"',
  'X-1,20261011:2,10/11/26,Deposit ACH PAYROLL,,,,"$2,000.00","$8,430.79"',
  'X-1,20261002:3,10/02/26,Withdrawal ACH CARD PAYMENT,,,,"-$300.00","$6,430.79"',
].join("\n");

const SPLIT = [
  "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit",
  "2026-10-03,2026-10-04,1234,COFFEE SHOP,Dining,4.50,",
  "2026-10-05,2026-10-06,1234,PAYMENT THANK YOU,Payment,,250.00",
].join("\n");

const NO_HEADER = [
  '"10/12/2026","-18.62","*","","HARDWARE STORE"',
  '"10/11/2026","2000.00","*","","PAYROLL"',
].join("\n");

const CARD_POSITIVE = [
  "Trans. Date,Post Date,Description,Amount,Category",
  "10/01/2026,10/02/2026,GROCERY,45.10,Supermarkets",
  "10/03/2026,10/04/2026,GAS,30.00,Gasoline",
  "10/05/2026,10/06/2026,BOOKS,12.00,Merchandise",
  "10/07/2026,10/07/2026,PAYMENT,-87.10,Payments",
].join("\n");

const table = (text: string) => readTable(parseCsv(text));

function account(partial: Partial<Account> = {}): Account {
  return {
    id: "checking",
    name: "Checking",
    type: "checking",
    openingBalance: 0,
    openingDate: "2026-10-01",
    onBudget: true,
    closedAt: null,
    importFormat: null,
    ...partial,
  };
}

function budget(transactions: BudgetData["transactions"] = []): BudgetData {
  return {
    household: { id: "h", name: "Home" },
    incomeRules: [],
    accounts: [account()],
    groups: [],
    envelopes: [],
    envelopeMonths: [],
    transactions,
  };
}

/** A transaction typed into Checking (no import key). */
function typed(partial: Partial<Transaction> & Pick<Transaction, "id" | "date" | "amount">) {
  return {
    accountId: "checking",
    payee: "Typed",
    memo: "",
    isTransfer: false,
    isIncome: false,
    transferId: null,
    voided: false,
    allocations: [],
    importKey: null,
    reconciled: false,
    ...partial,
  };
}

describe("parseImportDate", () => {
  it("reads month-first, day-first and year-first dates", () => {
    expect(parseImportDate("10/12/26", "MDY")).toBe("2026-10-12");
    expect(parseImportDate("10/12/2026 00:00:00", "MDY")).toBe("2026-10-12");
    expect(parseImportDate("12/10/2026", "DMY")).toBe("2026-10-12");
    expect(parseImportDate("2026-10-12", "YMD")).toBe("2026-10-12");
    expect(parseImportDate("Oct 12, 2026", "MDY")).toBe("2026-10-12");
  });

  it("rejects impossible or unreadable dates", () => {
    expect(parseImportDate("02/30/2026", "MDY")).toBeNull();
    expect(parseImportDate("13/01/2026", "MDY")).toBeNull();
    expect(parseImportDate("pending", "MDY")).toBeNull();
    expect(parseImportDate("1/2/026", "MDY")).toBeNull();
  });
});

describe("parseImportAmount", () => {
  it("reads signs, dollar signs, thousands and accounting parentheses", () => {
    expect(parseImportAmount("-$18.62")).toBe(-1_862);
    expect(parseImportAmount("$2,000.00")).toBe(200_000);
    expect(parseImportAmount("+5")).toBe(500);
    expect(parseImportAmount("(18.62)")).toBe(-1_862);
    expect(parseImportAmount("−18.62")).toBe(-1_862);
    expect(parseImportAmount("abc")).toBeNull();
  });
});

describe("readTable", () => {
  it("skips lines above the header", () => {
    const t = table(`Account: Everyday Checking\nFrom 10/01/2026 to 10/12/2026\n\n${CHECKING}`);
    expect(t.header?.[2]).toBe("Date");
    expect(t.rows).toHaveLength(3);
    expect(t.rows[0]?.line).toBe(5);
  });

  it("recognises a file with no header", () => {
    const t = table(NO_HEADER);
    expect(t.header).toBeNull();
    expect(t.rows).toHaveLength(2);
    expect(columnLabels(t)[0]).toBe("Column 1 (10/12/2026)");
  });

  it("rejects empty and header-only files", () => {
    expect(() => readTable([])).toThrow(CsvError);
    expect(() => table("Date,Description,Amount")).toThrow("no transactions");
  });
});

describe("detectFormat", () => {
  it("finds the columns of a signed-amount export with bank IDs", () => {
    const f = detectFormat(table(CHECKING));
    expect(f).toMatchObject({
      hasHeader: true,
      date: 2,
      dateOrder: "MDY",
      description: 3,
      memo: -1,
      amount: { kind: "signed", column: 7, flip: false },
      bankId: 1,
    });
  });

  it("finds separate debit and credit columns and year-first dates", () => {
    const f = detectFormat(table(SPLIT));
    expect(f).toMatchObject({
      date: 0,
      dateOrder: "YMD",
      description: 3,
      amount: { kind: "split", outflow: 5, inflow: 6 },
      bankId: -1,
    });
  });

  it("guesses from the values when there is no header", () => {
    expect(detectFormat(table(NO_HEADER))).toMatchObject({
      hasHeader: false,
      date: 0,
      amount: { kind: "signed", column: 1 },
      description: 4,
    });
  });

  it("detects day-first dates when a day is above 12", () => {
    const f = detectFormat(table("Date,Description,Amount\n03/10/2026,A,1\n25/10/2026,B,2"));
    expect(f.dateOrder).toBe("DMY");
  });
});

describe("formatFor", () => {
  it("reuses the account's saved format only when the file matches it", () => {
    const saved: ImportFormat = { ...detectFormat(table(CHECKING)), dateOrder: "DMY" };
    expect(formatFor(account({ importFormat: saved }), table(CHECKING))).toEqual({
      format: saved,
      saved: true,
    });
    expect(formatFor(account({ importFormat: saved }), table(SPLIT)).saved).toBe(false);
  });

  it("validates a format loaded from the database", () => {
    const f = detectFormat(table(CHECKING));
    expect(asImportFormat(JSON.parse(JSON.stringify(f)))).toEqual(f);
    expect(asImportFormat({ ...f, version: 2 })).toBeNull();
    expect(asImportFormat({ ...f, amount: { kind: "signed" } })).toBeNull();
    expect(asImportFormat("nope")).toBeNull();
  });
});

describe("formatProblem", () => {
  it("asks for the columns it cannot do without", () => {
    const f = detectFormat(table(CHECKING));
    expect(formatProblem(f)).toBeNull();
    expect(formatProblem({ ...f, date: -1 })).toMatch(/date/);
    expect(formatProblem({ ...f, amount: { kind: "signed", column: -1, flip: false } })).toMatch(
      /amount/,
    );
    expect(formatProblem({ ...f, amount: { kind: "split", outflow: 7, inflow: 7 } })).toMatch(
      /different/,
    );
  });
});

describe("previewTransactionImport", () => {
  it("reads every row as an Uncategorized transaction with a bank-ID key", () => {
    const t = table(CHECKING);
    const preview = previewTransactionImport(budget(), account(), t, detectFormat(t));
    expect(preview.rows).toEqual([
      {
        line: 2,
        date: "2026-10-12",
        amount: -1_862,
        payee: "Withdrawal Debit Card HARDWARE STORE #12",
        memo: "",
        importKey: "id:20261012:1",
        isIncome: false,
        matchId: null,
      },
      expect.objectContaining({ date: "2026-10-11", amount: 200_000 }),
      expect.objectContaining({ date: "2026-10-02", amount: -30_000 }),
    ]);
    expect(preview).toMatchObject({
      inflow: 200_000,
      outflow: 31_862,
      firstDate: "2026-10-02",
      lastDate: "2026-10-12",
      mostlyPositive: false,
    });
  });

  it("marks inflows matching an income rule as Income", () => {
    const t = table(CHECKING);
    const rule = (accountId: string | null) => ({ id: "r", pattern: "payroll", accountId });
    const withRule = { ...budget(), incomeRules: [rule(null)] };
    const preview = previewTransactionImport(withRule, account(), t, detectFormat(t));
    expect(preview.rows.map((r) => r.isIncome)).toEqual([false, true, false]);
    expect(preview.markedIncome).toBe(1);
    // A rule for another account does not apply.
    const elsewhere = { ...budget(), incomeRules: [rule("savings")] };
    expect(previewTransactionImport(elsewhere, account(), t, detectFormat(t)).markedIncome).toBe(0);
  });

  it("combines debit and credit columns", () => {
    const t = table(SPLIT);
    const amounts = previewTransactionImport(budget(), account(), t, detectFormat(t)).rows.map(
      (r) => r.amount,
    );
    expect(amounts).toEqual([-450, 25_000]);
  });

  it("flags card exports that show spending as positive, and flips them on request", () => {
    const t = table(CARD_POSITIVE);
    const f = detectFormat(t);
    expect(previewTransactionImport(budget(), account(), t, f).mostlyPositive).toBe(true);
    const flipped = previewTransactionImport(budget(), account(), t, {
      ...f,
      amount: { kind: "signed", column: 3, flip: true },
    });
    expect(flipped.rows.map((r) => r.amount)).toEqual([-4_510, -3_000, -1_200, 8_710]);
  });

  it("skips rows already imported into this account, and repeated bank IDs", () => {
    const t = table(`${CHECKING}\nX-1,20261012:1,10/12/26,Same ID again,,,,-1.00,`);
    const data = budget([
      {
        id: "old",
        accountId: "checking",
        date: "2026-10-11",
        amount: 200_000,
        payee: "Deposit",
        memo: "",
        isTransfer: false,
        isIncome: false,
        transferId: null,
        voided: false,
        allocations: [],
        importKey: "id:20261011:2",
        reconciled: false,
      },
    ]);
    const preview = previewTransactionImport(data, account(), t, detectFormat(t));
    expect(preview.rows.map((r) => r.line)).toEqual([2, 4]);
    expect(preview.duplicates.map((d) => [d.line, d.reason])).toEqual([
      [3, "Already imported"],
      [5, "Same bank ID as line 2"],
    ]);
    // Another account's keys do not count.
    const elsewhere = previewTransactionImport(
      data,
      account({ id: "savings" }),
      t,
      detectFormat(t),
    );
    expect(elsewhere.duplicates).toHaveLength(1);
  });

  it("fingerprints rows without a bank ID, counting identical rows apart", () => {
    const text = "Date,Description,Amount\n10/05/2026,Coffee,-4.50\n10/05/2026,Coffee,-4.50";
    const t = table(text);
    const first = previewTransactionImport(budget(), account(), t, detectFormat(t));
    expect(first.rows.map((r) => r.importKey)).toEqual([
      "fp:2026-10-05|-450|coffee|0",
      "fp:2026-10-05|-450|coffee|1",
    ]);
    // Re-importing a longer file with the same two coffees adds only the new row.
    const imported = first.rows.map((r, i) => ({
      id: `t${i}`,
      accountId: "checking",
      date: r.date,
      amount: r.amount,
      payee: r.payee,
      memo: r.memo,
      isTransfer: false,
      isIncome: false,
      transferId: null,
      voided: false,
      allocations: [],
      importKey: r.importKey,
      reconciled: false,
    }));
    const t2 = table(`${text}\n10/05/2026,Coffee,-4.50`);
    const again = previewTransactionImport(budget(imported), account(), t2, detectFormat(t2));
    expect(again.rows.map((r) => r.line)).toEqual([4]);
    expect(again.duplicates).toHaveLength(2);
  });

  it("skips rows before the account's opening date, already in its opening balance", () => {
    const t = table(CHECKING);
    const preview = previewTransactionImport(
      budget(),
      account({ openingDate: "2026-10-05" }),
      t,
      detectFormat(t),
    );
    expect(preview.rows).toHaveLength(2);
    expect(preview.beforeOpening.map((r) => r.date)).toEqual(["2026-10-02"]);
  });

  it("reports invalid rows with their line, and moves long descriptions to the memo", () => {
    const long = "X".repeat(250);
    const t = table(
      [
        "Date,Description,Amount",
        "pending,A,-1",
        ",B,-1",
        "10/05/2026,C,",
        "10/05/2026,D,abc",
        "10/05/2026,E,0.00",
        `10/05/2026,${long},-1`,
      ].join("\n"),
    );
    const preview = previewTransactionImport(budget(), account(), t, detectFormat(t));
    expect(preview.invalid).toEqual([
      { line: 2, message: 'Date "pending" is not a date' },
      { line: 3, message: "Date is missing" },
      { line: 4, message: "Amount is missing" },
      { line: 5, message: 'Amount "abc" is not a number' },
      { line: 6, message: "Amount is $0.00" },
    ]);
    expect(preview.rows[0]?.payee).toHaveLength(200);
    expect(preview.rows[0]?.memo).toBe(long);
  });
});

describe("matching typed transactions to imported ones", () => {
  const rows = [
    { line: 2, date: "2026-10-12", amount: -1_862 },
    { line: 3, date: "2026-10-11", amount: 200_000 },
  ];

  it("matches the same amount in the same account within IMPORT_MATCH_DAYS", () => {
    const data = budget([
      typed({ id: "near", date: "2026-10-10", amount: -1_862 }),
      typed({ id: "far", date: "2026-09-30", amount: 200_000 }), // 11 days away
      typed({ id: "cents", date: "2026-10-11", amount: 199_999 }),
      typed({ id: "other", date: "2026-10-11", amount: 200_000, accountId: "savings" }),
      typed({ id: "voided", date: "2026-10-11", amount: 200_000, voided: true }),
      typed({ id: "bank", date: "2026-10-11", amount: 200_000, importKey: "id:x" }),
    ]);
    const matches = findImportMatches(data, "checking", rows);
    expect([...matches].map(([line, tx]) => [line, tx.id])).toEqual([[2, "near"]]);
  });

  it("uses each side once, pairing the closest dates first", () => {
    const data = budget([
      typed({ id: "a", date: "2026-10-05", amount: -500 }),
      typed({ id: "b", date: "2026-10-09", amount: -500 }),
    ]);
    const matches = findImportMatches(data, "checking", [
      { line: 2, date: "2026-10-06", amount: -500 },
      { line: 3, date: "2026-10-09", amount: -500 },
      { line: 4, date: "2026-10-09", amount: -500 },
    ]);
    // Line 3 takes b (same day), line 2 takes a; line 4 has nothing left.
    expect([...matches].map(([line, tx]) => [line, tx.id]).sort()).toEqual([
      [2, "a"],
      [3, "b"],
    ]);
  });

  it("previews matches apart from new rows, and imports a kept-separate row as new", () => {
    const t = table(CHECKING);
    const withRule = {
      ...budget([typed({ id: "pay", date: "2026-10-10", amount: 200_000, payee: "Salary" })]),
      incomeRules: [{ id: "r", pattern: "payroll", accountId: null }],
    };
    const preview = previewTransactionImport(withRule, account(), t, detectFormat(t));
    expect(preview.rows.map((r) => r.line)).toEqual([2, 4]);
    expect(preview.matches).toEqual([
      {
        row: expect.objectContaining({ line: 3, importKey: "id:20261011:2", matchId: "pay" }),
        tx: expect.objectContaining({ id: "pay" }),
        separate: false,
      },
    ]);
    // A matched row is not new: no totals, no income rule.
    expect(preview).toMatchObject({ inflow: 0, outflow: 31_862, markedIncome: 0 });

    const kept = previewTransactionImport(withRule, account(), t, detectFormat(t), new Set([3]));
    expect(kept.matches[0]?.separate).toBe(true);
    expect(kept.rows.map((r) => [r.line, r.matchId, r.isIncome])).toEqual([
      [2, null, false],
      [3, null, true],
      [4, null, false],
    ]);
    expect(kept.inflow).toBe(200_000);
  });

  it("never matches a row already imported", () => {
    const t = table(CHECKING);
    const data = budget([
      typed({ id: "pay", date: "2026-10-11", amount: 200_000 }),
      typed({ id: "old", date: "2026-10-11", amount: 200_000, importKey: "id:20261011:2" }),
    ]);
    const preview = previewTransactionImport(data, account(), t, detectFormat(t));
    expect(preview.matches).toEqual([]);
    expect(preview.duplicates.map((d) => d.line)).toEqual([3]);
  });
});
