import { accountBalance } from "../models/budgetMath";
import { UserFacingError } from "../models/dataStore";
import type { BudgetData, IsoDate } from "../models/types";
import { requireCents, requireName } from "./input";
import type { Budget } from "./useBudget";

/** The Accounts page: accounts with their computed balances, plus add and close. */
export function useAccountsPage(budget: Budget, data: BudgetData) {
  const withBalances = data.accounts.map((account) => ({
    ...account,
    balance: accountBalance(account.id, data),
  }));

  return {
    openAccounts: withBalances.filter((a) => !a.closedAt),
    closedAccounts: withBalances.filter((a) => a.closedAt),

    addAccount: async (form: { name: string; openingBalance: string; openingDate: IsoDate }) => {
      const name = requireName(form.name, "Account name");
      const openingBalance = requireCents(form.openingBalance || "0", "Opening balance");
      if (!form.openingDate) throw new UserFacingError("Opening date is required");
      await budget.change((store) =>
        store.addAccount(data.household.id, {
          name,
          openingBalance,
          openingDate: form.openingDate,
        }),
      );
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
