import { useMemo, useState } from "react";
import {
  accountFigures,
  accountHistory,
  activityBalance,
  activityMonth,
  daysByMonth,
  firstRows,
  selectionTotal,
} from "../models/activity";
import { isToReview, transactionsToReview } from "../models/budgetMath";
import { inflowsMatchingRules } from "../models/incomeRules";
import { addMonths, formatMonth, todayIso, type Month } from "../models/month";
import { accountsHref } from "../models/routes";
import {
  addFilter,
  filterFromValue,
  filterLabel,
  filterValue,
  findRows,
  foundTotal,
  regroupDays,
  searchChoices,
  sortRows,
  sortsByDate,
  type SearchFilter,
  type SortOrder,
} from "../models/transactionSearch";
import type { BudgetData, Transaction } from "../models/types";
import type { Budget } from "./useBudget";

const NOTHING: ReadonlySet<string> = new Set();

interface SearchState {
  accountId: string | null;
  text: string;
  /** The chips, "what" first (see addFilter). */
  filters: SearchFilter[];
  sort: SortOrder;
}
const NO_SEARCH: SearchState = { accountId: null, text: "", filters: [], sort: "newest" };

/** Rows shown at first, and added by each "Show more". */
export const ROWS_PER_PAGE = 100;

/**
 * What the Accounts page shows with something open. All accounts (the old
 * Activity page): one month's transactions by day, its totals and today's
 * balance. One account: all its transactions, any month, under month
 * dividers, plus its info pane figures for the month. Either way: the
 * transactions still to review (from any month), "Mark as Income", rows
 * shown 100 at a time, and ticking rows to mark them reconciled with the
 * bank. Adding and editing go through useTransactionEntry. An open account
 * can also be searched and sorted (transactionSearch.ts); that starts over
 * when another account opens, and stays when the month changes.
 */
export function useAccountView(
  budget: Budget,
  data: BudgetData,
  month: Month,
  /** The open account's id; null for All accounts. */
  accountId: string | null,
) {
  const account = data.accounts.find((a) => a.id === accountId) ?? null;
  const accountNames = useMemo(() => new Map(data.accounts.map((a) => [a.id, a.name])), [data]);
  const cards = new Set(data.accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  const reviewRow = (tx: Transaction) => ({
    tx,
    accountName: accountNames.get(tx.accountId) ?? "Unknown account",
    /** An inflow outside a credit card: one tap can mark it Income. */
    canBeIncome: tx.amount > 0 && !cards.has(tx.accountId) && isToReview(tx, false),
  });

  // All accounts follows the month; an open account lists every month.
  const allDays = useMemo(
    () => (accountId === null ? activityMonth(data, month).days : accountHistory(data, accountId)),
    [data, month, accountId],
  );
  const monthTotals = useMemo(() => activityMonth(data, month).totals, [data, month]);
  const balance = useMemo(() => activityBalance(data, null, todayIso()), [data]);
  const figures = useMemo(
    () => (account ? accountFigures(data, account.id, month) : null),
    [data, account, month],
  );
  const review = transactionsToReview(data, accountId);

  // Rows shown: 100, then 100 more each time. Edits keep what is loaded.
  const [limit, setLimit] = useState(ROWS_PER_PAGE);

  // Search and sort, open account only. They belong to the account open.
  const [searchState, setSearchState] = useState<SearchState>({ ...NO_SEARCH, accountId });
  const search =
    accountId !== null && searchState.accountId === accountId ? searchState : NO_SEARCH;
  const updateSearch = (change: Partial<Omit<SearchState, "accountId">>) => {
    setSearchState({ ...search, ...change, accountId });
    setLimit(ROWS_PER_PAGE);
  };
  const searching = search.text.trim() !== "" || search.filters.length > 0;
  const choices = useMemo(
    () => (accountId === null ? [] : searchChoices(allDays, data, search.filters)),
    [allDays, data, accountId, search.filters],
  );
  const found = useMemo(
    () =>
      searching || search.sort !== "newest"
        ? sortRows(findRows(allDays, search.filters, search.text), search.sort)
        : null,
    [allDays, searching, search.filters, search.text, search.sort],
  );
  /** Sorted other than by date: one list, each row with its date. */
  const flat = found && !sortsByDate(search.sort) ? found : null;
  const listDays = useMemo(
    () => (found && !flat ? regroupDays(found) : allDays),
    [found, flat, allDays],
  );
  const page = useMemo(() => firstRows(listDays, limit), [listDays, limit]);
  const flatRows = flat ? flat.slice(0, limit) : null;

  // Ticked rows, by transaction id. They belong to what is open (and on All
  // accounts to the month): changing it starts empty, so nothing ticked is
  // ever out of sight.
  const view = accountId ?? `all|${month}`;
  const [ticked, setTicked] = useState({ view, ids: NOTHING });
  const rows = flatRows ? flatRows.map((f) => f.row) : page.days.flatMap((day) => day.rows);
  const selected = new Set(
    ticked.view === view ? rows.filter((r) => ticked.ids.has(r.tx.id)).map((r) => r.tx.id) : [],
  );
  const selectedRows = rows.filter((r) => selected.has(r.tx.id));
  const clearSelection = () => setTicked({ view, ids: NOTHING });

  return {
    monthLabel: formatMonth(month),
    previousHref: accountsHref(accountId ?? "all", addMonths(month, -1)),
    nextHref: accountsHref(accountId ?? "all", addMonths(month, 1)),
    /** The open account (null: All accounts). */
    account,
    /** All accounts: the month's money in and out, and today's balance (display only). */
    totals: monthTotals,
    balance,
    /** An open account's info pane figures; the month ones follow the month picked. */
    figures,
    /** The rows shown so far, by day (and by month for an open account), newest first. */
    days: page.days,
    months: daysByMonth(page.days),
    /** Sorted by amount, payee or envelope: the rows shown so far, each with its date (else null). */
    flatRows,
    shownCount: flatRows ? flatRows.length : page.shown,
    /** Rows not shown yet. */
    leftCount: flat ? flat.length - flatRows!.length : page.total - page.shown,
    showMore: () => setLimit((n) => n + ROWS_PER_PAGE),
    /** Uncategorized transactions from any month: they count toward nothing until decided. */
    toReview: review.list.map(reviewRow),
    toReviewIn: review.inflow,
    toReviewOut: review.outflow,
    /** Inflows to review that an income rule matches (see Settings → Income rules). */
    ruleMatches: inflowsMatchingRules(data)
      .filter((tx) => accountId === null || tx.accountId === accountId)
      .map((tx) => tx.id),
    hasOpenAccounts: data.accounts.some((a) => !a.closedAt),

    /** Searching an open account: what is typed, the chosen envelope or kind, and the order. */
    search: {
      text: search.text,
      /** The chips: each choice's drop-down value and name. */
      chips: search.filters.map((f) => ({ value: filterValue(f), label: filterLabel(f, data) })),
      /** The envelope chosen, so a split's matching part can stand out. */
      envelopeId:
        search.filters.flatMap((f) => ("envelopeId" in f ? [f.envelopeId] : []))[0] ?? null,
      sort: search.sort,
      /** Envelopes and kinds this account has, with counts. */
      choices,
      /** Something typed or chosen: To review steps aside and the matches add up. */
      searching,
      matchCount: found?.length ?? 0,
      /** The matches added up, signed; a split counts only the chosen envelope's part. */
      matchTotal: found ? foundTotal(found) : 0,
      setText: (text: string) => updateSearch({ text }),
      /** Adds a chip (by drop-down value), replacing one of its group. */
      choose: (value: string) => {
        const filter = filterFromValue(value);
        if (filter) updateSearch({ filters: addFilter(search.filters, filter), text: "" });
      },
      /** Removes a chip (by drop-down value). */
      remove: (value: string) =>
        updateSearch({ filters: search.filters.filter((f) => filterValue(f) !== value) }),
      setSort: (sort: SortOrder) => updateSearch({ sort }),
      clear: () => updateSearch({ text: "", filters: [] }),
    },

    /** Ticked rows (by transaction id), their count and their total, signed. */
    selected: selected as ReadonlySet<string>,
    selectedCount: selectedRows.length,
    selectedTotal: selectionTotal(rows, selected),
    /** Whether some ticked row is not reconciled yet / already is. */
    canReconcile: selectedRows.some((r) => !r.reconciled),
    canUnreconcile: selectedRows.some((r) => r.reconciled),
    toggleSelected: (id: string) => {
      const ids = new Set(selected);
      if (!ids.delete(id)) ids.add(id);
      setTicked({ view, ids });
    },
    clearSelection,
    /** Marks the ticked rows reconciled with the bank (or not), then unticks them. */
    setReconciled: async (reconciled: boolean) => {
      const ids = selectedRows.flatMap((r) => r.sideIds);
      const marked = new Set(ids);
      await budget.change(
        async (store) => {
          await store.setReconciled(ids, reconciled);
        },
        (d) => ({
          ...d,
          transactions: d.transactions.map((t) => (marked.has(t.id) ? { ...t, reconciled } : t)),
        }),
      );
      clearSelection();
    },

    deleteTransaction: async (id: string) => {
      await budget.change((store) => store.deleteTransaction(id));
    },

    /** Marks these inflows as Income, so they count toward Available to Assign. */
    markIncome: async (ids: string[]) => {
      await budget.change(async (store) => {
        await store.markIncome(ids);
      });
    },
  };
}
