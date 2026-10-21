import { useMemo } from "react";
import {
  budgetWith,
  buildBudgetMonth,
  coverSources,
  transactionShortfalls,
  type EnvelopeMonthChange,
  type PendingTransaction,
  type TransactionShortfall,
} from "../models/budgetMath";
import { UserFacingError, type DataStore, type TransactionInput } from "../models/dataStore";
import { isMonth, monthOf, type Month, todayIso } from "../models/month";
import { formatCents, parseCents, type Cents } from "../models/money";
import {
  fillRest,
  leftToSplit,
  linesFromAllocations,
  splitAllocations,
  type SplitLine,
} from "../models/splits";
import {
  daysBetween,
  planTransfer,
  transferChoices,
  transferPartner,
  type OtherSide,
  type OtherSideChoice,
  type TransferInput,
} from "../models/transfers";
import type { Account, BudgetData, Transaction } from "../models/types";
import { requireCents } from "./input";
import type { Budget } from "./useBudget";

/** The category choice for a transfer: it is neither spending nor income. */
export const TRANSFER = "transfer";
/** The category choice for income: an inflow to Available to Assign. */
export const INCOME = "income";
/** The category choice for a split: several envelopes, one line each. */
export const SPLIT = "split";

/** What the transaction form holds, as typed. */
export interface TransactionForm {
  id?: string;
  accountId: string;
  date: string;
  direction: "outflow" | "inflow";
  amount: string;
  payee: string;
  memo: string;
  /** An envelope id, "" for Uncategorized, TRANSFER, INCOME or SPLIT. */
  category: string;
  /** For a split: one line per envelope (empty otherwise). */
  split: SplitLine[];
  /** For a transfer: the other account ("" = the first one that fits). */
  transferAccountId: string;
  /** For a transfer: which transaction is the other side (see OtherSideChoice). */
  transferMatch: OtherSideChoice;
}

/** What saving will do: one transaction, or both sides of a transfer. */
export type PendingSave =
  { kind: "transaction"; input: TransactionInput } | { kind: "transfer"; input: TransferInput };

/** How one short envelope was covered, before anything is saved. */
export interface Cover {
  envelopeId: string;
  month: Month;
  fromSaved: Cents;
  stillShort: Cents;
  choice: CoverChoice;
}

/**
 * The cover prompt shown when a transaction would overdraw an envelope. A
 * split can overdraw several: they are covered one at a time, and nothing
 * is saved until the last one is covered.
 */
export interface CoverPlan extends TransactionShortfall {
  save: PendingSave;
  /** Envelopes of this save already covered (applied when saving). */
  covered: Cover[];
  /** How many more envelopes still need covering after this one. */
  moreShort: number;
  /** A card's payment envelope: a payment it cannot cover is never Uncategorized. */
  isCardPayment: boolean;
  envelopeName: string;
  /** Step 2 choices: envelopes with enough Remaining this month. */
  sources: { id: string; name: string; remaining: number }[];
  /** Step 3: Available to Assign can cover what is still short. */
  canUseAvailable: boolean;
  available: number;
}

/** How to cover what Saved could not: another envelope, or Available to Assign. */
export type CoverChoice = { fromEnvelopeId: string } | "available" | null;

export type PrepareResult = { kind: "saved" } | { kind: "cover"; plan: CoverPlan };

export function formFromTransaction(tx: Transaction, data: BudgetData): TransactionForm {
  return {
    id: tx.id,
    accountId: tx.accountId,
    date: tx.date,
    direction: tx.amount < 0 ? "outflow" : "inflow",
    amount: (Math.abs(tx.amount) / 100).toFixed(2),
    payee: tx.payee,
    memo: tx.memo,
    category: tx.isTransfer
      ? TRANSFER
      : tx.isIncome
        ? INCOME
        : tx.allocations.length > 1
          ? SPLIT
          : (tx.allocations[0]?.envelopeId ?? ""),
    split: tx.allocations.length > 1 ? linesFromAllocations(tx.allocations) : [],
    transferAccountId: transferPartner(data, tx)?.accountId ?? "",
    transferMatch: "auto",
  };
}

/**
 * An empty form for a new transaction: today, in `accountId` when that
 * account is open (the account open on Accounts), else the first open account.
 */
export function blankTransactionForm(data: BudgetData, accountId?: string | null): TransactionForm {
  const open = data.accounts.filter((a) => !a.closedAt);
  return {
    accountId: (open.find((a) => a.id === accountId) ?? open[0])?.id ?? "",
    date: todayIso(),
    direction: "outflow",
    amount: "",
    payee: "",
    memo: "",
    category: "",
    split: [],
    transferAccountId: "",
    transferMatch: "auto",
  };
}

/** The amount a split must add up to: what is typed, or 0 until it is a number. */
const splitTotal = (form: TransactionForm): Cents => Math.max(0, parseCents(form.amount) ?? 0);

/** Month changes that make the given covers (see coverAndSave). */
function coverChanges(covers: readonly Cover[]): EnvelopeMonthChange[] {
  return covers.flatMap(({ envelopeId, month, fromSaved, stillShort, choice }) => {
    const changes: EnvelopeMonthChange[] = [];
    if (fromSaved > 0) changes.push({ envelopeId, month, released: fromSaved });
    if (stillShort === 0 || !choice) return changes;
    if (choice !== "available") {
      changes.push({ envelopeId: choice.fromEnvelopeId, month, assigned: -stillShort });
    }
    changes.push({ envelopeId, month, assigned: stillShort });
    return changes;
  });
}

/**
 * Each envelope's Remaining in the month of `date`, as the Budget page shows
 * it now (before this save), or null while the date is not valid. Shown next
 * to the envelope names in the form's envelope pickers.
 */
export function useEnvelopeRemaining(data: BudgetData, date: string): Map<string, Cents> | null {
  const month = monthOf(date);
  return useMemo(() => {
    if (!isMonth(month)) return null;
    const rows = buildBudgetMonth(data, month).groups.flatMap((g) => g.envelopes);
    return new Map(rows.map((e) => [e.id, e.remaining]));
  }, [data, month]);
}

/**
 * Adding or editing one transaction, wherever the form is shown (the Add
 * transaction dialog, or a new row on Accounts): saves it, or returns the cover
 * prompt when its envelope would go negative.
 */
export function useTransactionEntry(budget: Budget, data: BudgetData) {
  const envelopeNames = useMemo(() => new Map(data.envelopes.map((e) => [e.id, e.name])), [data]);
  const householdId = data.household.id;

  const openAccounts = data.accounts.filter((a) => !a.closedAt);

  /** An inflow on a credit card: a card credit (or a payment, if Transfer). */
  const isCardCredit = (form: TransactionForm) =>
    form.direction === "inflow" &&
    data.accounts.find((a) => a.id === form.accountId)?.type === "credit_card";

  /** Open accounts a transfer from `accountId` can go to (or come from). */
  const otherAccounts = (accountId: string): Account[] =>
    openAccounts.filter((a) => a.id !== accountId);
  /** The form's other account, defaulting to the first that fits. */
  const transferAccountOf = (form: TransactionForm): string => {
    const others = otherAccounts(form.accountId);
    return (others.find((a) => a.id === form.transferAccountId) ?? others[0])?.id ?? "";
  };

  const toInput = (form: TransactionForm): TransactionInput => {
    if (!form.accountId) throw new UserFacingError("Choose an account");
    if (!form.date) throw new UserFacingError("Date is required");
    const cents = requireCents(form.amount);
    if (cents <= 0)
      throw new UserFacingError("Enter an amount above zero, then pick Outflow or Inflow.");
    const isIncome = form.category === INCOME;
    if (isIncome && form.direction === "outflow") {
      throw new UserFacingError("Income is money coming in: choose Inflow, or another envelope.");
    }
    if (isCardCredit(form) && form.category !== "" && form.category !== TRANSFER) {
      throw new UserFacingError(
        "Money coming into a credit card is a card credit: it lowers what you owe, without an envelope.",
      );
    }
    const amount = form.direction === "outflow" ? -cents : cents;
    const envelopeId = form.category === TRANSFER || isIncome ? "" : form.category;
    return {
      id: form.id,
      accountId: form.accountId,
      date: form.date,
      amount,
      payee: form.payee.trim(),
      memo: form.memo.trim(),
      isIncome,
      allocations:
        envelopeId === SPLIT
          ? splitAllocations(amount, form.split)
          : envelopeId
            ? [{ envelopeId, amount }]
            : [],
    };
  };

  /** Both sides of the transfer the form describes, and where the other side comes from. */
  const toTransfer = (form: TransactionForm): { input: TransferInput; other: OtherSide } => {
    const { id, accountId, date, amount, payee, memo } = toInput(form);
    const side = { id, accountId, date, amount, payee, memo };
    const otherAccountId = transferAccountOf(form);
    if (!otherAccountId) throw new UserFacingError("Add another account to transfer to or from.");
    const existing = data.transactions.find((t) => t.id === form.id);
    return planTransfer(data, side, otherAccountId, existing, form.transferMatch);
  };

  /** What saving adds or changes, as the budget math sees it. */
  const pendingOf = (save: PendingSave): PendingTransaction[] =>
    save.kind === "transaction"
      ? [{ ...save.input, isTransfer: false }]
      : save.input.sides.map((side) => ({
          ...side,
          allocations: [],
          isTransfer: true,
          isIncome: false,
        }));

  /**
   * The cover prompt for the next envelope the save would overdraw once the
   * covers so far are made, or null when nothing is short any more. Other
   * envelopes are offered as they would be after the save, so an envelope
   * this split also spends from only offers what it has left.
   */
  const planFor = (save: PendingSave, covered: Cover[]): CoverPlan | null => {
    const pending = pendingOf(save);
    const changes = coverChanges(covered);
    const [short, ...rest] = transactionShortfalls(budgetWith(data, [], changes), pending);
    if (!short) return null;
    const view = buildBudgetMonth(budgetWith(data, pending, changes), short.month);
    return {
      ...short,
      save,
      covered,
      moreShort: rest.length,
      isCardPayment: Boolean(data.envelopes.find((e) => e.id === short.envelopeId)?.cardAccountId),
      envelopeName: envelopeNames.get(short.envelopeId) ?? "This envelope",
      sources:
        short.stillShort > 0
          ? coverSources(view, short.envelopeId, short.stillShort).map((e) => ({
              id: e.id,
              name: e.name,
              remaining: e.remaining,
            }))
          : [],
      canUseAvailable: short.stillShort > 0 && short.stillShort <= view.assignable,
      available: view.assignable,
    };
  };

  /** Saves a pending transaction or transfer with the given store. */
  const store = (save: PendingSave) => (s: DataStore) =>
    save.kind === "transaction"
      ? s.saveTransaction(householdId, save.input)
      : s.saveTransfer(save.input);

  return {
    openAccounts,
    isCardCredit,
    /** Whether the transaction being edited is saved as a transfer (both sides). */
    isTransfer: (form: TransactionForm) =>
      Boolean(data.transactions.find((t) => t.id === form.id)?.transferId),
    otherAccounts,
    transferAccountOf,

    /** The form switched to a split: the chosen envelope (if any) starts the first line. */
    startSplit: (form: TransactionForm): TransactionForm => {
      const envelopeId = [TRANSFER, INCOME, SPLIT].includes(form.category) ? "" : form.category;
      return {
        ...form,
        category: SPLIT,
        split: [
          { envelopeId, amount: "" },
          { envelopeId: "", amount: "" },
        ],
      };
    },
    /** How much of the amount the split lines do not cover yet (negative = over). */
    leftToSplit: (form: TransactionForm): Cents => leftToSplit(splitTotal(form), form.split),
    /** The split lines with what is left added to line `index`. */
    fillRest: (form: TransactionForm, index: number): SplitLine[] =>
      fillRest(splitTotal(form), form.split, index),

    /**
     * For a transfer with more than one possible other side: the choices, and
     * which one saving would use. Null when there is nothing to choose.
     */
    transferOptions: (
      form: TransactionForm,
    ): { selected: string; options: { value: string; label: string }[] } | null => {
      if (form.category !== TRANSFER) return null;
      let side: TransactionInput;
      let other: OtherSide;
      try {
        side = toInput(form);
        other = toTransfer(form).other;
      } catch {
        return null;
      }
      const existing = data.transactions.find((t) => t.id === form.id);
      const choices = transferChoices(data, side, transferAccountOf(form), existing);
      const describe = (tx: Transaction) => {
        const days = daysBetween(side.date, tx.date);
        const when =
          days === 0
            ? "same day"
            : `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} ${days < 0 ? "earlier" : "later"}`;
        return `${tx.date} · ${tx.payee || "no description"} · ${formatCents(tx.amount)} (${when})`;
      };
      const options = [
        ...(choices.partner
          ? [
              {
                value: choices.partner.id,
                label:
                  choices.partner.importKey === null
                    ? "Keep the side you typed in (updated to match)"
                    : `Keep ${describe(choices.partner)}`,
              },
            ]
          : []),
        ...choices.matches.map((tx) => ({ value: tx.id, label: describe(tx) })),
        ...(choices.canAddNew ? [{ value: "new", label: "Add a new transaction instead" }] : []),
      ];
      if (options.length < 2) return null;
      return { selected: other.kind === "new" ? "new" : other.tx.id, options };
    },

    /**
     * For a transfer: what happens to the other account, in words, or null.
     * Shown under the account choice so a matched bank row is no surprise.
     */
    describeTransfer: (form: TransactionForm): string | null => {
      if (form.category !== TRANSFER) return null;
      let other: OtherSide;
      try {
        other = toTransfer(form).other;
      } catch {
        return null;
      }
      const name = openAccounts.find((a) => a.id === transferAccountOf(form))?.name ?? "";
      if (other.kind === "match") {
        return `Links to the ${name} transaction on ${other.tx.date} (${other.tx.payee || "no description"}), so it is not added twice.`;
      }
      if (other.kind === "partner") {
        return other.tx.importKey === null
          ? `Also updates the ${name} side.`
          : `Stays linked to the ${name} bank row from ${other.tx.date}.`;
      }
      return `Also adds the matching ${form.direction === "outflow" ? "inflow" : "outflow"} in ${name}.`;
    },
    groups: [...data.groups]
      .sort((a, b) => a.position - b.position)
      .map((g) => ({
        ...g,
        // A card's payment envelope fills itself, so it is never a choice here.
        envelopes: data.envelopes
          .filter((e) => e.groupId === g.id && !e.cardAccountId)
          .sort((a, b) => a.position - b.position),
      }))
      .filter((g) => g.envelopes.length > 0),

    /** Saves the transaction, or returns a cover plan if its envelope would go negative. */
    prepare: async (form: TransactionForm): Promise<PrepareResult> => {
      const save: PendingSave =
        form.category === TRANSFER
          ? { kind: "transfer", input: toTransfer(form).input }
          : { kind: "transaction", input: toInput(form) };
      const plan = planFor(save, []);
      if (plan) return { kind: "cover", plan };
      await budget.change(store(save));
      return { kind: "saved" };
    },

    /**
     * Covers the shortfall in CLAUDE.md order — release this envelope's Saved,
     * then move from another envelope or assign from Available to Assign.
     * Returns the prompt for the next short envelope of a split, if any;
     * after the last one, makes every cover and saves the transaction.
     */
    coverAndSave: async (plan: CoverPlan, choice: CoverChoice): Promise<PrepareResult> => {
      if (plan.stillShort > 0 && !choice) {
        throw new UserFacingError("Choose where the rest of the money comes from.");
      }
      const { envelopeId, month, fromSaved, stillShort } = plan;
      const covered = [...plan.covered, { envelopeId, month, fromSaved, stillShort, choice }];
      const next = planFor(plan.save, covered);
      if (next) return { kind: "cover", plan: next };
      await budget.change(async (s) => {
        for (const cover of covered) {
          if (cover.fromSaved > 0) {
            await s.adjustEnvelopeMonth(cover.envelopeId, cover.month, {
              released: cover.fromSaved,
            });
          }
          if (cover.stillShort === 0) continue;
          if (cover.choice === "available") {
            await s.adjustEnvelopeMonth(cover.envelopeId, cover.month, {
              assigned: cover.stillShort,
            });
          } else if (cover.choice) {
            await s.moveBetweenEnvelopes(
              cover.choice.fromEnvelopeId,
              cover.envelopeId,
              cover.month,
              cover.stillShort,
            );
          }
        }
        await store(plan.save)(s);
      });
      return { kind: "saved" };
    },
  };
}
