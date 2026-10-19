/**
 * The app's own shapes for budget data. They mirror the database tables but
 * use camelCase and leave out columns the app does not need. The data stores
 * (supabaseStore.ts, memoryStore.ts) convert to and from these.
 */
import type { Cents } from "./money";
import type { IncomeRule } from "./incomeRules";
import type { ImportFormat } from "./transactionImport";

/** "YYYY-MM-DD" in the household's local calendar. */
export type IsoDate = string;

export interface Household {
  id: string;
  name: string;
}

/** Checking holds money; a credit card's balance is normally negative (money owed). */
export type AccountType = "checking" | "credit_card";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  /** Signed like every amount: a card that owes $50 opens at -5000. */
  openingBalance: Cents;
  openingDate: IsoDate;
  onBudget: boolean;
  /** Set when the account is closed; accounts are never deleted. */
  closedAt: string | null;
  /** Column mapping from this account's last CSV import. */
  importFormat: ImportFormat | null;
}

export interface EnvelopeGroup {
  id: string;
  name: string;
  position: number;
}

export interface Envelope {
  id: string;
  groupId: string;
  name: string;
  position: number;
  /**
   * Set on a credit card's payment envelope: the card it pays. Card activity
   * fills and empties it; transactions are never categorized to it.
   */
  cardAccountId: string | null;
}

/** What was stored for one envelope in one month. */
export interface EnvelopeMonthRecord {
  envelopeId: string;
  month: string;
  assigned: Cents;
  released: Cents;
  planned: Cents;
}

/** The part of a transaction given to one envelope. */
export interface Allocation {
  envelopeId: string;
  amount: Cents;
}

export interface Transaction {
  id: string;
  accountId: string;
  date: IsoDate;
  /** Signed: inflow positive, outflow negative. */
  amount: Cents;
  payee: string;
  memo: string;
  /** Both sides of a transfer are marked; neither is spending or income. */
  isTransfer: boolean;
  /**
   * Marked Income: an inflow that goes to Available to Assign. An inflow
   * that is neither Income, in an envelope nor a transfer is "to review" and
   * does not count yet.
   */
  isIncome: boolean;
  /** Shared by the two sides of a transfer (see transfers.ts); null otherwise. */
  transferId: string | null;
  voided: boolean;
  /** Empty = Uncategorized. */
  allocations: Allocation[];
  /** Set on imported transactions, to recognise the same bank row again. */
  importKey: string | null;
  /**
   * Ticked off against the bank (Activity's colored bank icon). Only a mark:
   * it changes no budget math and does not lock the transaction.
   */
  reconciled: boolean;
}

/** Everything one household's budget needs, loaded at once. */
export interface BudgetData {
  household: Household;
  accounts: Account[];
  groups: EnvelopeGroup[];
  envelopes: Envelope[];
  envelopeMonths: EnvelopeMonthRecord[];
  transactions: Transaction[];
  /** Rules that mark matching inflows as Income (see incomeRules.ts). */
  incomeRules: IncomeRule[];
}
