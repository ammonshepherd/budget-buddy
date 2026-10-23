import {
  accountFromKind,
  accountKind,
  groupAccounts,
  openingBalanceFromEntry,
  openingBalanceToEntry,
  type AccountKind,
} from "../models/accounts";
import { activityMonth } from "../models/activity";
import { accountBalance } from "../models/budgetMath";
import { UserFacingError, type NewAccount } from "../models/dataStore";
import { centsToInput } from "../models/money";
import type { Month } from "../models/month";
import type { BudgetData, IsoDate } from "../models/types";
import { requireCents, requireName } from "./input";
import type { Budget } from "./useBudget";

export interface AccountForm {
  /** Checking, Credit card or Tracking; chosen only when adding. */
  kind: AccountKind;
  name: string;
  /** As typed; for a card, the amount owed. */
  openingBalance: string;
  openingDate: IsoDate;
}

/** Checks the account form and turns it into what the store saves. */
function readAccountForm(form: AccountForm): NewAccount {
  const name = requireName(form.name, "Account name");
  const { type, onBudget } = accountFromKind(form.kind);
  const entered = requireCents(
    form.openingBalance || "0",
    type === "credit_card" ? "Amount owed" : "Opening balance",
  );
  if (!form.openingDate) throw new UserFacingError("Opening date is required");
  return {
    type,
    onBudget,
    name,
    openingBalance: openingBalanceFromEntry(type, entered),
    openingDate: form.openingDate,
  };
}

/**
 * The Accounts page: accounts with their computed balances (grouped for the
 * list), the month's money in and out across all accounts, plus add, edit
 * and close.
 */
export function useAccountsPage(budget: Budget, data: BudgetData, month: Month) {
  const withBalances = data.accounts.map((account) => ({
    ...account,
    kind: accountKind(account),
    balance: accountBalance(account.id, data),
    /** Opening balance as the edit form shows it (the amount owed, for a card). */
    openingBalanceInput: centsToInput(openingBalanceToEntry(account.type, account.openingBalance)),
  }));

  const openAccounts = withBalances.filter((a) => !a.closedAt);
  const closedAccounts = withBalances.filter((a) => a.closedAt);

  return {
    openAccounts,
    closedAccounts,
    /** The list: Checking, Credit cards, then Tracking (off budget), each by name. */
    openGroups: groupAccounts(openAccounts),
    closedGroups: groupAccounts(closedAccounts),
    /** All accounts' money in and out this month (display only; transfers left out). */
    monthTotals: activityMonth(data, month).totals,

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
      const account = data.accounts.find((a) => a.id === accountId);
      if (!account) throw new UserFacingError("Account not found");
      // The kind is fixed once added: it decides what the opening balance means.
      const { name, openingBalance, openingDate } = readAccountForm({
        ...form,
        kind: accountKind(account),
      });
      const changes = { name, openingBalance, openingDate };
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
