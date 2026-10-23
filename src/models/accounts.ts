import type { Cents } from "./money";
import { accountBalance } from "./budgetMath";
import type { Account, AccountType, BudgetData, IsoDate } from "./types";

export const ACCOUNT_TYPE_NAMES: Record<AccountType, string> = {
  checking: "Checking",
  credit_card: "Credit card",
};

/**
 * What the Add account form offers. A tracking account is stored as a
 * checking-type account that is off budget (`onBudget: false`): it stands
 * alone, outside Available to Assign, envelopes and transfers.
 */
export type AccountKind = AccountType | "tracking";

export const ACCOUNT_KIND_NAMES: Record<AccountKind, string> = {
  checking: "Checking",
  credit_card: "Credit card",
  tracking: "Tracking",
};

export function accountKind(account: Pick<Account, "type" | "onBudget">): AccountKind {
  return account.onBudget ? account.type : "tracking";
}

/** How an account of this kind is stored. */
export function accountFromKind(kind: AccountKind): { type: AccountType; onBudget: boolean } {
  return kind === "tracking"
    ? { type: "checking", onBudget: false }
    : { type: kind, onBudget: true };
}

/** A tracking account: off budget, standalone. */
export function isTracking(account: Pick<Account, "onBudget"> | undefined): boolean {
  return account !== undefined && !account.onBudget;
}

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

/**
 * The desktop sidebar's account links: open budget accounts (Checking, then
 * Credit cards) and, kept apart, open tracking accounts; each by name.
 */
export function sidebarAccounts<A extends Pick<Account, "name" | "type" | "onBudget" | "closedAt">>(
  accounts: A[],
): { budget: A[]; tracking: A[] } {
  const groups = groupAccounts(accounts.filter((a) => !a.closedAt));
  return {
    budget: groups.filter((g) => g.name !== "Tracking").flatMap((g) => g.accounts),
    tracking: groups.find((g) => g.name === "Tracking")?.accounts ?? [],
  };
}
