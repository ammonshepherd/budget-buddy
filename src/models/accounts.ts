import type { Cents } from "./money";
import { accountBalance } from "./budgetMath";
import type { Account, AccountType, BudgetData, IsoDate } from "./types";

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

/** A card's payment envelope is named after it (the database trigger does the same). */
export function paymentEnvelopeName(cardName: string): string {
  return `${cardName} payment`.slice(0, 100);
}

/**
 * What every credit card owes as of a day (positive when owed; a card in
 * credit lowers it). Display only: the app shows it at the top of each page.
 */
export function cardDebt(
  data: Pick<BudgetData, "accounts" | "transactions">,
  today: IsoDate,
): Cents {
  return data.accounts
    .filter((a) => a.type === "credit_card")
    .reduce((owed, card) => owed - accountBalance(card.id, data, { through: today }), 0);
}

/** The Accounts list's groups, in order. Tracking accounts are off budget. */
export type AccountGroupName = "Checking" | "Credit cards" | "Tracking";

/**
 * Accounts under their group (Checking, Credit cards, Tracking), each by
 * name; empty groups are left out. Pass open or closed accounts as needed.
 */
export function groupAccounts<A extends Pick<Account, "name" | "type" | "onBudget">>(
  accounts: A[],
): { name: AccountGroupName; accounts: A[] }[] {
  const groupOf = (a: A): AccountGroupName =>
    !a.onBudget ? "Tracking" : a.type === "credit_card" ? "Credit cards" : "Checking";
  const order: AccountGroupName[] = ["Checking", "Credit cards", "Tracking"];
  return order
    .map((name) => ({
      name,
      accounts: accounts
        .filter((a) => groupOf(a) === name)
        .sort((x, y) => x.name.localeCompare(y.name)),
    }))
    .filter((group) => group.accounts.length > 0);
}
