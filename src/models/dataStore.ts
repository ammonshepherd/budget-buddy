/**
 * The contract between controllers and wherever data lives. Controllers only
 * use this interface, so the real Supabase store and the in-memory store used
 * by UI tests are interchangeable ("dependency injection").
 */
import type { EnvelopePlanRow, PlannedAmount } from "./envelopePlan";
import type { Cents } from "./money";
import type { Month } from "./month";
import type { ImportedTransaction, ImportFormat } from "./transactionImport";
import type { NewIncomeRule } from "./incomeRules";
import type { TransferInput } from "./transfers";
import type { AccountType, Allocation, BudgetData, IsoDate } from "./types";

export interface UserSession {
  userId: string;
  email: string;
}

/** The account details that can be edited after it is added. */
export interface AccountDetails {
  name: string;
  openingBalance: Cents;
  openingDate: IsoDate;
}

/** The type is chosen once, when the account is added. */
export interface NewAccount extends AccountDetails {
  type: AccountType;
}

export interface TransactionInput {
  /** Omit to create; set to update. */
  id?: string;
  accountId: string;
  date: IsoDate;
  amount: Cents;
  payee: string;
  memo: string;
  /** An inflow to Available to Assign (needs no allocations and a positive amount). */
  isIncome: boolean;
  /**
   * One line per envelope, each with the transaction's sign, summing to the
   * amount (several = a split; see splits.ts). Empty = Uncategorized.
   * Transfers are saved with saveTransfer.
   */
  allocations: Allocation[];
}

export interface DataStore {
  getSession(): Promise<UserSession | null>;
  /** Calls back on sign-in and sign-out; returns an unsubscribe function. */
  onSessionChange(callback: (session: UserSession | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;

  /** The signed-in user's whole budget, or null if they have no household yet. */
  load(): Promise<BudgetData | null>;
  createHousehold(name: string): Promise<void>;

  addAccount(householdId: string, account: NewAccount): Promise<void>;
  /** Changes an account's name, opening balance and opening date. */
  updateAccount(accountId: string, account: AccountDetails): Promise<void>;
  closeAccount(accountId: string): Promise<void>;

  addGroup(householdId: string, name: string, position: number): Promise<void>;
  addEnvelope(householdId: string, groupId: string, name: string, position: number): Promise<void>;
  deleteEnvelope(envelopeId: string): Promise<void>;
  deleteGroup(groupId: string): Promise<void>;
  renameGroup(groupId: string, name: string): Promise<void>;
  /** A card's payment envelope cannot be renamed: it is named after its card. */
  renameEnvelope(envelopeId: string, name: string): Promise<void>;
  /**
   * Moves an envelope to another group, at `position` there. A card's payment
   * envelope stays in its group.
   */
  moveEnvelope(envelopeId: string, groupId: string, position: number): Promise<void>;
  /** Saves a new order. The list names every group of the household once, top first. */
  reorderGroups(householdId: string, groupIds: string[]): Promise<void>;
  /** Saves a new order. The list names every envelope of the group once, top first. */
  reorderEnvelopes(groupId: string, envelopeIds: string[]): Promise<void>;

  /** Adds to (not replaces) an envelope's Assigned and Released for a month. */
  adjustEnvelopeMonth(
    envelopeId: string,
    month: Month,
    change: { assigned?: Cents; released?: Cents },
  ): Promise<void>;
  moveBetweenEnvelopes(fromId: string, toId: string, month: Month, amount: Cents): Promise<void>;
  setPlanned(householdId: string, envelopeId: string, month: Month, planned: Cents): Promise<void>;
  /** All or nothing: sets Planned for several envelopes in one month. */
  setPlannedAmounts(householdId: string, month: Month, rows: PlannedAmount[]): Promise<void>;
  /**
   * All or nothing: creates the groups and envelopes a plan names that do not
   * exist yet (matching names ignoring case) and sets each one's Planned for
   * the month.
   */
  importEnvelopePlan(householdId: string, month: Month, rows: EnvelopePlanRow[]): Promise<void>;

  saveTransaction(householdId: string, input: TransactionInput): Promise<void>;
  /**
   * Saves both sides of a transfer at once. Sides with an id update that
   * transaction (e.g. link an imported bank row); others are added. When
   * editing, a side the transfer no longer has is released: deleted if it
   * was typed in, kept as an Uncategorized row if it was imported.
   */
  saveTransfer(input: TransferInput): Promise<void>;
  /**
   * Marks Uncategorized inflows as Income in one step; anything else in the
   * list is left alone. Resolves to how many were marked.
   */
  markIncome(transactionIds: string[]): Promise<number>;

  addIncomeRule(householdId: string, rule: NewIncomeRule): Promise<void>;
  deleteIncomeRule(ruleId: string): Promise<void>;
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
