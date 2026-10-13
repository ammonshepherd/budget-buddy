/**
 * Linked transfers: one entry moves money out of one account and into
 * another, saved as two transactions that share a transferId. Both sides are
 * marked Transfer, so neither counts as spending or income.
 *
 * When the other account already has a matching bank row (imported, not yet
 * categorized, the opposite amount, within TRANSFER_MATCH_DAYS), the transfer
 * links to that row instead of adding a second copy. The user can pick a
 * different candidate (up to TRANSFER_PICK_DAYS away) or a new transaction.
 */
import { UserFacingError } from "./dataStore";
import { formatCents, type Cents } from "./money";
import type { BudgetData, IsoDate, Transaction } from "./types";

/** How far apart a bank row may be dated to be linked automatically. */
export const TRANSFER_MATCH_DAYS = 7;
/** How far apart a bank row may be dated to be offered as a choice. */
export const TRANSFER_PICK_DAYS = 31;

/** One side of a transfer as it will be saved. No id = a new transaction. */
export interface TransferSide {
  id?: string;
  accountId: string;
  date: IsoDate;
  /** Signed: the two sides of a transfer cancel out. */
  amount: Cents;
  payee: string;
  memo: string;
}

export interface TransferInput {
  /** Set when editing an existing transfer. */
  transferId: string | null;
  sides: [TransferSide, TransferSide];
}

/** How the other account's side is found. */
export type OtherSide =
  | { kind: "partner"; tx: Transaction } // this transfer's existing other side
  | { kind: "match"; tx: Transaction } // an existing bank row, now linked
  | { kind: "new" }; // a new transaction is added

/**
 * Which transaction becomes the other side: "auto" (the current partner,
 * else the closest match within TRANSFER_MATCH_DAYS, else a new one), "new"
 * (a new transaction), or the id of a partner or candidate to link.
 * A choice that no longer fits (say, after the amount changed) means "auto".
 */
export type OtherSideChoice = "auto" | "new" | (string & {});

export const daysBetween = (from: IsoDate, to: IsoDate) => dayNumber(to) - dayNumber(from);

const dayNumber = (date: IsoDate) =>
  Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86_400_000;

/** The other side of a transfer, or null for an ordinary transaction. */
export function transferPartner(data: BudgetData, tx: Transaction): Transaction | null {
  if (!tx.transferId) return null;
  return data.transactions.find((t) => t.transferId === tx.transferId && t.id !== tx.id) ?? null;
}

/** What to look for: a transaction in `accountId` of exactly `amount` near `date`. */
export interface TransferMatchQuery {
  accountId: string;
  amount: Cents;
  date: IsoDate;
  excludeIds: (string | undefined)[];
}

/**
 * Transactions in `accountId` that could be the other side of this transfer:
 * not yet linked, not categorized, exactly `amount`, dated within
 * `withinDays` of `date`. Closest date first (earlier first on a tie).
 */
export function findTransferMatches(
  data: BudgetData,
  wanted: TransferMatchQuery,
  withinDays = TRANSFER_PICK_DAYS,
): Transaction[] {
  const day = dayNumber(wanted.date);
  const away = (t: Transaction) => Math.abs(dayNumber(t.date) - day);
  return data.transactions
    .filter(
      (t) =>
        t.accountId === wanted.accountId &&
        !t.voided &&
        !t.transferId &&
        t.allocations.length === 0 &&
        t.amount === wanted.amount &&
        away(t) <= withinDays &&
        !wanted.excludeIds.includes(t.id),
    )
    .sort((a, b) => away(a) - away(b) || a.date.localeCompare(b.date));
}

/** The match linked automatically: the closest within TRANSFER_MATCH_DAYS. */
export function findTransferMatch(
  data: BudgetData,
  wanted: TransferMatchQuery,
): Transaction | null {
  return findTransferMatches(data, wanted, TRANSFER_MATCH_DAYS)[0] ?? null;
}

/** What the user can choose as the other side, for the form. */
export interface TransferChoices {
  /** This transfer's current other side, if it is in the chosen account. */
  partner: Transaction | null;
  /** Bank rows that could be linked instead, closest first. */
  matches: Transaction[];
  /** Whether "add a new transaction" is a separate choice (not with a typed-in partner, which is updated instead). */
  canAddNew: boolean;
}

export function transferChoices(
  data: BudgetData,
  side: Pick<TransferSide, "accountId" | "amount" | "date">,
  otherAccountId: string,
  existing?: Transaction,
): TransferChoices {
  const current = existing ? transferPartner(data, existing) : null;
  const partner = current?.accountId === otherAccountId ? current : null;
  const matches = findTransferMatches(data, {
    accountId: otherAccountId,
    amount: 0 - side.amount,
    date: side.date,
    excludeIds: [existing?.id, current?.id],
  });
  return { partner, matches, canAddNew: !partner || partner.importKey !== null };
}

/**
 * Both sides of a transfer from what the user entered for one of them.
 * `existing` is the transaction being edited, if any. The other side is this
 * transfer's current partner when it is still in `otherAccountId`, otherwise
 * a matching bank row, otherwise a new transaction mirroring this one, unless
 * `choice` picks another candidate or a new transaction.
 * An imported other side keeps the bank's own date and description.
 */
export function planTransfer(
  data: BudgetData,
  side: TransferSide,
  otherAccountId: string,
  existing?: Transaction,
  choice: OtherSideChoice = "auto",
): { input: TransferInput; other: OtherSide } {
  if (otherAccountId === side.accountId) {
    throw new UserFacingError("Choose a different account to transfer to or from.");
  }
  const amount = 0 - side.amount;
  const mirror = (id?: string): TransferSide => ({
    ...side,
    id,
    accountId: otherAccountId,
    amount,
  });
  const fromBank = (tx: Transaction): TransferSide => ({
    id: tx.id,
    accountId: tx.accountId,
    date: tx.date,
    amount: tx.amount,
    payee: tx.payee,
    memo: tx.memo,
  });
  const transferId = existing?.transferId ?? null;
  const input = (other: TransferSide): TransferInput => ({ transferId, sides: [side, other] });

  const { partner: current, matches } = transferChoices(data, side, otherAccountId, existing);
  const picked = matches.find((t) => t.id === choice);
  // A typed-in partner is simply updated when "new" is chosen.
  const keepPartner =
    current !== null &&
    (choice === current.id ||
      (choice === "new" && current.importKey === null) ||
      (choice !== "new" && !picked));

  if (current && keepPartner) {
    if (current.importKey === null) {
      return { input: input(mirror(current.id)), other: { kind: "partner", tx: current } };
    }
    if (current.amount !== amount) {
      throw new UserFacingError(
        `The other side was imported from the bank as ${formatCents(current.amount)}, so this side must be ${formatCents(0 - current.amount)}.`,
      );
    }
    return { input: input(fromBank(current)), other: { kind: "partner", tx: current } };
  }
  const match =
    picked ??
    (choice === "new" || current
      ? null
      : (matches.find((t) => Math.abs(daysBetween(t.date, side.date)) <= TRANSFER_MATCH_DAYS) ??
        null));
  if (match) return { input: input(fromBank(match)), other: { kind: "match", tx: match } };
  return { input: input(mirror()), other: { kind: "new" } };
}
