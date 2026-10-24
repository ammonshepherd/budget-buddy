import { describe, expect, it } from "vitest";
import {
  BackupError,
  backupFileName,
  isEmptyHousehold,
  parseBackup,
  summarizeBackup,
  validateBackup,
  withFreshIds,
  type Backup,
} from "./backup";

/** A small valid backup: checking, a card with its payment envelope, a split, a transfer. */
function sample(): Backup {
  return {
    format: "budget-buddy-backup",
    version: 1,
    exported_at: "2030-02-01T12:00:00Z",
    household: { name: "Home" },
    accounts: [
      {
        id: "chk",
        name: "Checking",
        type: "checking",
        opening_balance: 100_000,
        opening_date: "2030-01-01",
        on_budget: true,
        closed_at: null,
        import_format: { dateColumn: 0 },
        created_at: "2030-01-01T00:00:00Z",
      },
      {
        id: "visa",
        name: "Visa",
        type: "credit_card",
        opening_balance: -5_000,
        opening_date: "2030-01-01",
        on_budget: true,
        closed_at: null,
        import_format: null,
        created_at: "2030-01-01T00:00:01Z",
      },
    ],
    category_groups: [
      { id: "g1", name: "Everyday", position: 0, created_at: null },
      { id: "g2", name: "Cards", position: 1, created_at: null },
    ],
    categories: [
      {
        id: "food",
        group_id: "g1",
        name: "Food",
        position: 0,
        card_account_id: null,
        created_at: null,
      },
      {
        id: "fun",
        group_id: "g1",
        name: "Fun",
        position: 1,
        card_account_id: null,
        created_at: null,
      },
      {
        id: "pay",
        group_id: "g2",
        name: "Visa payment",
        position: 0,
        card_account_id: "visa",
        created_at: null,
      },
    ],
    category_months: [
      { category_id: "food", month: "2030-01", assigned: 20_000, released: 0, planned: 25_000 },
      { category_id: "fun", month: "2030-03", assigned: 0, released: 0, planned: 0 },
    ],
    transactions: [
      tx({ id: "pay1", amount: 300_000, is_income: true, date: "2030-01-02" }),
      tx({ id: "split", amount: -3_000, reconciled: true, import_key: "bank-1", source: "csv" }),
      tx({ id: "out", amount: -10_000, is_transfer: true, transfer_id: "t1" }),
      tx({ id: "in", account_id: "visa", amount: 10_000, is_transfer: true, transfer_id: "t1" }),
      tx({ id: "credit", account_id: "visa", amount: 500, date: "2030-02-03" }),
    ],
    transaction_allocations: [
      { transaction_id: "split", category_id: "food", amount: -1_000 },
      { transaction_id: "split", category_id: "fun", amount: -2_000 },
    ],
    income_rules: [{ pattern: "payroll", account_id: "chk", created_at: null }],
  };
}

function tx(fields: Partial<Backup["transactions"][number]>): Backup["transactions"][number] {
  return {
    id: "x",
    account_id: "chk",
    date: "2030-01-05",
    amount: -1,
    payee: "Shop",
    memo: "",
    is_transfer: false,
    is_income: false,
    transfer_id: null,
    voided: false,
    import_key: null,
    reconciled: false,
    source: "manual",
    created_at: null,
    ...fields,
  };
}

/** Expects the changed sample to be refused with a message containing `text`. */
function refuses(change: (b: Backup) => void, text: string) {
  const b = sample();
  change(b);
  expect(() => validateBackup(b)).toThrow(BackupError);
  expect(() => validateBackup(b)).toThrow(text);
}

describe("validateBackup", () => {
  it("accepts a valid backup", () => {
    expect(validateBackup(sample())).toEqual(sample());
  });

  it("refuses files that are not a backup this version can read", () => {
    expect(() => parseBackup("not json")).toThrow("not a JSON file");
    expect(() => parseBackup('{"format":"other"}')).toThrow("not an Enough Money backup");
    expect(() => parseBackup(JSON.stringify({ ...sample(), version: 2 }))).toThrow("version");
    refuses((b) => delete (b as Partial<Backup>).transactions, "transactions list is missing");
    refuses((b) => (b.household.name = " "), "household name");
  });

  it("checks each field's type and limits", () => {
    refuses((b) => (b.transactions[0]!.amount = 0), "bad amount");
    refuses((b) => (b.transactions[0]!.amount = 1.5), "bad amount");
    refuses((b) => (b.transactions[0]!.date = "2030-13-01"), "bad date");
    refuses((b) => (b.category_months[0]!.planned = -1), "bad planned");
    refuses((b) => (b.category_months[0]!.month = "2030-1"), "bad month");
    refuses((b) => ((b.accounts[0] as { type: string }).type = "savings"), "bad type");
    refuses((b) => ((b.transactions[0] as { source: string }).source = "api"), "bad source");
    refuses((b) => (b.income_rules[0]!.pattern = "x"), "bad pattern");
  });

  it("checks what the database keeps unique", () => {
    refuses((b) => (b.categories[1]!.id = "food"), "envelope id appears twice");
    refuses(
      (b) => b.category_months.push({ ...b.category_months[0]! }),
      "envelope month appears twice",
    );
    refuses((b) => (b.transaction_allocations[1]!.category_id = "food"), "envelope in one split");
    refuses(
      (b) => (b.transactions[0]!.import_key = "bank-1"),
      "bank import key in one account appears twice",
    );
    // The same import key in another account is fine.
    const b = sample();
    b.transactions[4]!.import_key = "bank-1";
    expect(() => validateBackup(b)).not.toThrow();
  });

  it("checks every link points at something in the file", () => {
    refuses((b) => (b.categories[0]!.group_id = "nope"), "missing group");
    refuses((b) => (b.category_months[0]!.category_id = "nope"), "has no envelope");
    refuses((b) => (b.transactions[0]!.account_id = "nope"), "missing account");
    refuses((b) => (b.transaction_allocations[0]!.category_id = "nope"), "missing envelope");
    refuses((b) => (b.transaction_allocations[0]!.transaction_id = "nope"), "missing transaction");
    refuses((b) => (b.income_rules[0]!.account_id = "nope"), "missing account");
  });

  it("needs exactly one payment envelope per card, and nothing allocated to it", () => {
    refuses((b) => b.categories.pop(), "has no payment envelope");
    refuses(
      (b) => b.categories.push({ ...b.categories[2]!, id: "pay2", position: 1 }),
      "two payment envelopes",
    );
    refuses((b) => (b.categories[0]!.card_account_id = "chk"), "pays a missing card");
    refuses((b) => (b.transaction_allocations[0]!.category_id = "pay"), "payment envelope");
  });

  it("checks transfers come in cancelling pairs", () => {
    refuses((b) => (b.transactions[3]!.amount = 9_000), "two sides");
    refuses((b) => (b.transactions[3]!.account_id = "chk"), "two sides");
    refuses((b) => b.transactions.splice(3, 1), "two sides");
    refuses((b) => (b.transactions[2]!.transfer_id = null), "half marked");
  });

  it("checks splits, Income and card credits like the database", () => {
    refuses((b) => (b.transaction_allocations[0]!.amount = -500), "do not add up");
    refuses((b) => (b.transaction_allocations[0]!.amount = 1_000), "other way");
    refuses((b) => (b.transactions[1]!.is_income = true), "marked Income but cannot be");
    refuses((b) => (b.transactions[4]!.is_income = true), "marked Income but cannot be");
    refuses(
      (b) =>
        b.transaction_allocations.push({
          transaction_id: "pay1",
          category_id: "food",
          amount: 300_000,
        }),
      "Income on",
    );
    refuses(
      (b) =>
        b.transaction_allocations.push({
          transaction_id: "credit",
          category_id: "food",
          amount: 500,
        }),
      "card credit",
    );
    refuses(
      (b) =>
        b.transaction_allocations.push({
          transaction_id: "out",
          category_id: "food",
          amount: -10_000,
        }),
      "transfer on",
    );
  });
});

describe("withFreshIds", () => {
  it("replaces every id and keeps every link", () => {
    let n = 0;
    const fresh = withFreshIds(sample(), () => `new-${++n}`);
    const text = JSON.stringify(fresh);
    for (const old of ["chk", "visa", "g1", "g2", "food", "fun", "pay", "split", "t1"]) {
      expect(text).not.toContain(`"${old}"`);
    }
    expect(() => validateBackup(fresh)).not.toThrow();
    const visa = fresh.accounts[1]!.id;
    expect(fresh.categories[2]!.card_account_id).toBe(visa);
    expect(fresh.transactions[3]!.account_id).toBe(visa);
    expect(fresh.transactions[2]!.transfer_id).toBe(fresh.transactions[3]!.transfer_id);
    expect(fresh.income_rules[0]!.account_id).toBe(fresh.accounts[0]!.id);
    // Everything else is kept.
    expect(fresh.transactions[1]).toMatchObject({
      reconciled: true,
      import_key: "bank-1",
      source: "csv",
    });
  });

  it("does not change the original", () => {
    const original = sample();
    withFreshIds(original);
    expect(original).toEqual(sample());
  });
});

describe("summarizeBackup", () => {
  it("lists the months with transactions or stored amounts", () => {
    expect(summarizeBackup(sample())).toEqual({
      householdName: "Home",
      exportedAt: "2030-02-01T12:00:00Z",
      accounts: 2,
      envelopes: 3,
      transactions: 5,
      incomeRules: 1,
      // March has only an all-zero record, so it is left out.
      months: ["2030-01", "2030-02"],
    });
  });
});

describe("helpers", () => {
  it("names the file after the day", () => {
    expect(backupFileName("2030-02-01")).toBe("enough-money-backup-2030-02-01.json");
  });

  it("calls a household empty only with no budget data", () => {
    const empty = {
      household: { id: "h", name: "Home" },
      accounts: [],
      groups: [],
      envelopes: [],
      envelopeMonths: [],
      transactions: [],
      incomeRules: [],
    };
    expect(isEmptyHousehold(empty)).toBe(true);
    expect(isEmptyHousehold({ ...empty, groups: [{ id: "g", name: "G", position: 0 }] })).toBe(
      false,
    );
  });
});
