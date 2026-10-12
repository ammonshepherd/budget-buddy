/**
 * The app's own shapes for budget data. They mirror the database tables but
 * use camelCase and leave out columns the app does not need. The data stores
 * (supabaseStore.ts, memoryStore.ts) convert to and from these.
 */
import type { Cents } from "./money";

/** "YYYY-MM-DD" in the household's local calendar. */
export type IsoDate = string;

export interface Household {
  id: string;
  name: string;
}

export interface Account {
  id: string;
  name: string;
  openingBalance: Cents;
  openingDate: IsoDate;
  onBudget: boolean;
  /** Set when the account is closed; accounts are never deleted. */
  closedAt: string | null;
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
  isTransfer: boolean;
  voided: boolean;
  /** Empty = Uncategorized. */
  allocations: Allocation[];
}

/** Everything one household's budget needs, loaded at once. */
export interface BudgetData {
  household: Household;
  accounts: Account[];
  groups: EnvelopeGroup[];
  envelopes: Envelope[];
  envelopeMonths: EnvelopeMonthRecord[];
  transactions: Transaction[];
}
