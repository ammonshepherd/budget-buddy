/**
 * Linked transfers: one entry moves money out of one account and into
 * another, saved as two transactions that share a transferId. Both sides are
 * marked Transfer, so neither counts as spending or income.
 *
 * When the other account already has a matching bank row (imported, not yet
 * categorized, the opposite amount, within TRANSFER_MATCH_DAYS), the transfer
 * links to that row instead of adding a second copy.
 */
import { UserFacingError } from "./dataStore";
import { formatCents, type Cents } from "./money";
import type { BudgetData, IsoDate, Transaction } from "./types";

export const TRANSFER_MATCH_DAYS = 7;

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

const dayNumber = (date: IsoDate) =>
  Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86_400_000;

/** The other side of a transfer, or null for an ordinary transaction. */
export function transferPartner(data: BudgetData, tx: Transaction): Transaction | null {
  if (!tx.transferId) return null;
  return data.transactions.find((t) => t.transferId === tx.transferId && t.id !== tx.id) ?? null;
}

/**
 * An existing transaction in `accountId` that is the other side of this
 * transfer: not yet linked, not categorized, exactly `amount`, and dated
 * within TRANSFER_MATCH_DAYS of `date` (the closest wins).
 */
export function findTransferMatch(
  data: BudgetData,
  wanted: { accountId: string; amount: Cents; date: IsoDate; excludeIds: (string | undefined)[] },
): Transaction | null {
  const day = dayNumber(wanted.date);
  const candidates = data.transactions.filter(
    (t) =>
      t.accountId === wanted.accountId &&
      !t.voided &&
      !t.transferId &&
      t.allocations.length === 0 &&
      t.amount === wanted.amount &&
      Math.abs(dayNumber(t.date) - day) <= TRANSFER_MATCH_DAYS &&
      !wanted.excludeIds.includes(t.id),
  );
  candidates.sort(
    (a, b) =>
      Math.abs(dayNumber(a.date) - day) - Math.abs(dayNumber(b.date) - day) ||
      a.date.localeCompare(b.date),
  );
  return candidates[0] ?? null;
}

/**
 * Both sides of a transfer from what the user entered for one of them.
 * `existing` is the transaction being edited, if any. The other side is this
 * transfer's current partner when it is still in `otherAccountId`, otherwise
 * a matching bank row, otherwise a new transaction mirroring this one.
 * An imported other side keeps the bank's own date and description.
 */
export function planTransfer(
  data: BudgetData,
  side: TransferSide,
  otherAccountId: string,
  existing?: Transaction,
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
  const partner = existing ? transferPartner(data, existing) : null;
  const transferId = existing?.transferId ?? null;
  const input = (other: TransferSide): TransferInput => ({ transferId, sides: [side, other] });

  if (partner && partner.accountId === otherAccountId) {
    if (partner.importKey === null) {
      return { input: input(mirror(partner.id)), other: { kind: "partner", tx: partner } };
    }
    if (partner.amount !== amount) {
      throw new UserFacingError(
        `The other side was imported from the bank as ${formatCents(partner.amount)}, so this side must be ${formatCents(0 - partner.amount)}.`,
      );
    }
    return { input: input(fromBank(partner)), other: { kind: "partner", tx: partner } };
  }
  const match = findTransferMatch(data, {
    accountId: otherAccountId,
    amount,
    date: side.date,
    excludeIds: [existing?.id, partner?.id],
  });
  if (match) return { input: input(fromBank(match)), other: { kind: "match", tx: match } };
  return { input: input(mirror()), other: { kind: "new" } };
}
