import { useMemo } from "react";
import {
  buildBudgetMonth,
  checkTransactionSpend,
  coverSources,
  type SpendCheck,
} from "../models/budgetMath";
import { UserFacingError, type DataStore, type TransactionInput } from "../models/dataStore";
import { monthOf, todayIso, type Month } from "../models/month";
import { formatCents } from "../models/money";
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

/** What the transaction form holds, as typed. */
export interface TransactionForm {
  id?: string;
  accountId: string;
  date: string;
  direction: "outflow" | "inflow";
  amount: string;
  payee: string;
  memo: string;
  /** An envelope id, "" for Uncategorized, or TRANSFER. */
  category: string;
  /** For a transfer: the other account ("" = the first one that fits). */
  transferAccountId: string;
  /** For a transfer: which transaction is the other side (see OtherSideChoice). */
  transferMatch: OtherSideChoice;
}

/** What saving will do: one transaction, or both sides of a transfer. */
export type PendingSave =
  { kind: "transaction"; input: TransactionInput } | { kind: "transfer"; input: TransferInput };

/** The cover prompt shown when a transaction would overdraw its envelope. */
export interface CoverPlan extends SpendCheck {
  save: PendingSave;
  envelopeId: string;
  /** A card's payment envelope: a payment it cannot cover is never Uncategorized. */
  isCardPayment: boolean;
  envelopeName: string;
  month: Month;
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
    category: tx.isTransfer ? TRANSFER : (tx.allocations[0]?.envelopeId ?? ""),
    transferAccountId: transferPartner(data, tx)?.accountId ?? "",
    transferMatch: "auto",
  };
}

/** An empty form for a new transaction: today, in the first open account. */
export function blankTransactionForm(data: BudgetData): TransactionForm {
  return {
    accountId: data.accounts.find((a) => !a.closedAt)?.id ?? "",
    date: todayIso(),
    direction: "outflow",
    amount: "",
    payee: "",
    memo: "",
    category: "",
    transferAccountId: "",
    transferMatch: "auto",
  };
}

/**
 * Adding or editing one transaction, wherever the form is shown (the Add
 * transaction dialog, or a row on Activity): saves it, or returns the cover
 * prompt when its envelope would go negative.
 */
export function useTransactionEntry(budget: Budget, data: BudgetData) {
  const envelopeNames = useMemo(() => new Map(data.envelopes.map((e) => [e.id, e.name])), [data]);
  const householdId = data.household.id;

  const openAccounts = data.accounts.filter((a) => !a.closedAt);

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
    return {
      id: form.id,
      accountId: form.accountId,
      date: form.date,
      amount: form.direction === "outflow" ? -cents : cents,
      payee: form.payee.trim(),
      memo: form.memo.trim(),
      envelopeId: form.category && form.category !== TRANSFER ? form.category : null,
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

  /** The first envelope saving would overdraw (see checkTransactionSpend), with its month. */
  const shortfallOf = (save: PendingSave) => {
    const pending =
      save.kind === "transaction"
        ? [{ ...save.input, isTransfer: false }]
        : save.input.sides.map((side) => ({ ...side, envelopeId: null, isTransfer: true }));
    for (const tx of pending) {
      const check = checkTransactionSpend(data, tx);
      if (check) return { check, month: monthOf(tx.date) };
    }
    return null;
  };

  /** Saves a pending transaction or transfer with the given store. */
  const store = (save: PendingSave) => (s: DataStore) =>
    save.kind === "transaction"
      ? s.saveTransaction(householdId, save.input)
      : s.saveTransfer(save.input);

  return {
    openAccounts,
    otherAccounts,
    transferAccountOf,

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
      const short = shortfallOf(save);
      if (!short) {
        await budget.change(store(save));
        return { kind: "saved" };
      }
      const { check, month } = short;
      const view = buildBudgetMonth(data, month);
      return {
        kind: "cover",
        plan: {
          ...check,
          save,
          envelopeId: check.envelopeId,
          isCardPayment: Boolean(
            data.envelopes.find((e) => e.id === check.envelopeId)?.cardAccountId,
          ),
          envelopeName: envelopeNames.get(check.envelopeId) ?? "This envelope",
          month,
          sources:
            check.stillShort > 0
              ? coverSources(view, check.envelopeId, check.stillShort).map((e) => ({
                  id: e.id,
                  name: e.name,
                  remaining: e.remaining,
                }))
              : [],
          canUseAvailable: check.stillShort > 0 && check.stillShort <= view.assignable,
          available: view.assignable,
        },
      };
    },

    /**
     * Covers the shortfall in CLAUDE.md order — release this envelope's Saved,
     * then move from another envelope or assign from Available to Assign —
     * and saves the transaction.
     */
    coverAndSave: async (plan: CoverPlan, choice: CoverChoice) => {
      if (plan.stillShort > 0 && !choice) {
        throw new UserFacingError("Choose where the rest of the money comes from.");
      }
      await budget.change(async (s) => {
        if (plan.fromSaved > 0) {
          await s.adjustEnvelopeMonth(plan.envelopeId, plan.month, {
            released: plan.fromSaved,
          });
        }
        if (plan.stillShort > 0) {
          if (choice === "available") {
            await s.adjustEnvelopeMonth(plan.envelopeId, plan.month, {
              assigned: plan.stillShort,
            });
          } else if (choice) {
            await s.moveBetweenEnvelopes(
              choice.fromEnvelopeId,
              plan.envelopeId,
              plan.month,
              plan.stillShort,
            );
          }
        }
        await store(plan.save)(s);
      });
    },
  };
}
