import type { Cents } from "./money";
import type { AccountType } from "./types";

export const ACCOUNT_TYPE_NAMES: Record<AccountType, string> = {
  checking: "Checking",
  credit_card: "Credit card",
};

/**
 * Cards are entered as the amount owed (positive), but stored signed like
 * every balance: owing $50 is -5000. A negative entry on a card is a credit.
 */
export function openingBalanceFromEntry(type: AccountType, entered: Cents): Cents {
  return type === "credit_card" ? -entered : entered;
}

/** The reverse of openingBalanceFromEntry, for the edit form. */
export function openingBalanceToEntry(type: AccountType, openingBalance: Cents): Cents {
  return type === "credit_card" ? -openingBalance : openingBalance;
}
