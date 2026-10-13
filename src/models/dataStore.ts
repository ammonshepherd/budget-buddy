/**
 * The contract between controllers and wherever data lives. Controllers only
 * use this interface, so the real Supabase store and the in-memory store used
 * by UI tests are interchangeable ("dependency injection").
 */
import type { EnvelopePlanRow } from "./envelopePlan";
import type { Cents } from "./money";
import type { Month } from "./month";
import type { ImportedTransaction, ImportFormat } from "./transactionImport";
import type { BudgetData, IsoDate } from "./types";

export interface UserSession {
  userId: string;
  email: string;
}

export interface NewAccount {
  name: string;
  openingBalance: Cents;
  openingDate: IsoDate;
}

export interface TransactionInput {
  /** Omit to create; set to update. */
  id?: string;
  accountId: string;
  date: IsoDate;
  amount: Cents;
  payee: string;
  memo: string;
  isTransfer: boolean;
  /** null = Uncategorized. */
  envelopeId: string | null;
}

export interface DataStore {
  getSession(): Promise<UserSession | null>;
  /** Calls back on sign-in and sign-out; returns an unsubscribe function. */
  onSessionChange(callback: (session: UserSession | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  /** Resolves true when the user must confirm their email before signing in. */
  signUp(email: string, password: string): Promise<boolean>;
  signOut(): Promise<void>;

  /** The signed-in user's whole budget, or null if they have no household yet. */
  load(): Promise<BudgetData | null>;
  createHousehold(name: string): Promise<void>;

  addAccount(householdId: string, account: NewAccount): Promise<void>;
  closeAccount(accountId: string): Promise<void>;

  addGroup(householdId: string, name: string, position: number): Promise<void>;
  addEnvelope(householdId: string, groupId: string, name: string, position: number): Promise<void>;
  deleteEnvelope(envelopeId: string): Promise<void>;
  deleteGroup(groupId: string): Promise<void>;

  /** Adds to (not replaces) an envelope's Assigned and Released for a month. */
  adjustEnvelopeMonth(
    envelopeId: string,
    month: Month,
    change: { assigned?: Cents; released?: Cents },
  ): Promise<void>;
  moveBetweenEnvelopes(fromId: string, toId: string, month: Month, amount: Cents): Promise<void>;
  setPlanned(householdId: string, envelopeId: string, month: Month, planned: Cents): Promise<void>;
  /**
   * All or nothing: creates the groups and envelopes a plan names that do not
   * exist yet (matching names ignoring case) and sets each one's Planned for
   * the month.
   */
  importEnvelopePlan(householdId: string, month: Month, rows: EnvelopePlanRow[]): Promise<void>;

  saveTransaction(householdId: string, input: TransactionInput): Promise<void>;
  /**
   * All or nothing: adds imported rows to an open account as Uncategorized,
   * skipping any whose import key the account already has, and saves the
   * column mapping on the account. Resolves to how many rows were added.
   */
  importTransactions(
    accountId: string,
    format: ImportFormat,
    rows: ImportedTransaction[],
  ): Promise<number>;
  deleteTransaction(transactionId: string): Promise<void>;
}

/** An error whose message is safe and useful to show the user. */
export class UserFacingError extends Error {}
