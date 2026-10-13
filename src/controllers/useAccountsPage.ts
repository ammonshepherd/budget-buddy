import { accountBalance } from "../models/budgetMath";
import { UserFacingError, type NewAccount } from "../models/dataStore";
import { centsToInput } from "../models/money";
import type { BudgetData, IsoDate } from "../models/types";
import { requireCents, requireName } from "./input";
import type { Budget } from "./useBudget";

export interface AccountForm {
  name: string;
  openingBalance: string;
  openingDate: IsoDate;
}

/** Checks the account form and turns it into what the store saves. */
function readAccountForm(form: AccountForm): NewAccount {
  const name = requireName(form.name, "Account name");
  const openingBalance = requireCents(form.openingBalance || "0", "Opening balance");
  if (!form.openingDate) throw new UserFacingError("Opening date is required");
  return { name, openingBalance, openingDate: form.openingDate };
}

/** The Accounts page: accounts with their computed balances, plus add, edit and close. */
export function useAccountsPage(budget: Budget, data: BudgetData) {
  const withBalances = data.accounts.map((account) => ({
    ...account,
    balance: accountBalance(account.id, data),
    /** Opening balance as text for the edit form. */
    openingBalanceInput: centsToInput(account.openingBalance),
  }));

  return {
    openAccounts: withBalances.filter((a) => !a.closedAt),
    closedAccounts: withBalances.filter((a) => a.closedAt),

    addAccount: async (form: AccountForm) => {
      const account = readAccountForm(form);
      await budget.change((store) => store.addAccount(data.household.id, account));
    },

    /**
     * Saves new details for an open account. The opening balance is the
     * balance on the opening date, before any of its transactions, so the
     * opening date cannot move past the account's first transaction.
     */
    updateAccount: async (accountId: string, form: AccountForm) => {
      const changes = readAccountForm(form);
      const account = data.accounts.find((a) => a.id === accountId);
      if (!account) throw new UserFacingError("Account not found");
      if (account.closedAt) throw new UserFacingError("A closed account cannot be edited.");
      const first = data.transactions
        .filter((tx) => tx.accountId === accountId && !tx.voided)
        .reduce<IsoDate | null>((min, tx) => (!min || tx.date < min ? tx.date : min), null);
      if (first && changes.openingDate > first) {
        throw new UserFacingError(
          `${account.name} has transactions from ${first}, so its opening date can be ${first} at the latest.`,
        );
      }
      await budget.change((store) => store.updateAccount(accountId, changes));
    },

    /** Closing keeps the account and its history; only a zero balance can be closed. */
    closeAccount: async (accountId: string) => {
      if (accountBalance(accountId, data) !== 0) {
        throw new UserFacingError(
          "Move the balance out first: only a $0.00 account can be closed.",
        );
      }
      await budget.change((store) => store.closeAccount(accountId));
    },
  };
}
