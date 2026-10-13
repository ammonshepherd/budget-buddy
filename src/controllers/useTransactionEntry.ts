import { useMemo } from "react";
import {
  buildBudgetMonth,
  checkTransactionSpend,
  coverSources,
  type SpendCheck,
} from "../models/budgetMath";
import { UserFacingError, type TransactionInput } from "../models/dataStore";
import { monthOf, todayIso, type Month } from "../models/month";
import type { BudgetData, Transaction } from "../models/types";
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
}

/** The cover prompt shown when a transaction would overdraw its envelope. */
export interface CoverPlan extends SpendCheck {
  input: TransactionInput;
  envelopeId: string;
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

export function formFromTransaction(tx: Transaction): TransactionForm {
  return {
    id: tx.id,
    accountId: tx.accountId,
    date: tx.date,
    direction: tx.amount < 0 ? "outflow" : "inflow",
    amount: (Math.abs(tx.amount) / 100).toFixed(2),
    payee: tx.payee,
    memo: tx.memo,
    category: tx.isTransfer ? TRANSFER : (tx.allocations[0]?.envelopeId ?? ""),
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
      isTransfer: form.category === TRANSFER,
      envelopeId: form.category && form.category !== TRANSFER ? form.category : null,
    };
  };

  return {
    openAccounts: data.accounts.filter((a) => !a.closedAt),
    groups: [...data.groups]
      .sort((a, b) => a.position - b.position)
      .map((g) => ({
        ...g,
        envelopes: data.envelopes
          .filter((e) => e.groupId === g.id)
          .sort((a, b) => a.position - b.position),
      })),

    /** Saves the transaction, or returns a cover plan if its envelope would go negative. */
    prepare: async (form: TransactionForm): Promise<PrepareResult> => {
      const input = toInput(form);
      const check = checkTransactionSpend(data, { ...input, envelopeId: input.envelopeId });
      if (!check || check.shortfall === 0 || !input.envelopeId) {
        await budget.change((store) => store.saveTransaction(householdId, input));
        return { kind: "saved" };
      }
      const month = monthOf(input.date);
      const view = buildBudgetMonth(data, month);
      return {
        kind: "cover",
        plan: {
          ...check,
          input,
          envelopeId: input.envelopeId,
          envelopeName: envelopeNames.get(input.envelopeId) ?? "This envelope",
          month,
          sources:
            check.stillShort > 0
              ? coverSources(view, input.envelopeId, check.stillShort).map((e) => ({
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
      await budget.change(async (store) => {
        if (plan.fromSaved > 0) {
          await store.adjustEnvelopeMonth(plan.envelopeId, plan.month, {
            released: plan.fromSaved,
          });
        }
        if (plan.stillShort > 0) {
          if (choice === "available") {
            await store.adjustEnvelopeMonth(plan.envelopeId, plan.month, {
              assigned: plan.stillShort,
            });
          } else if (choice) {
            await store.moveBetweenEnvelopes(
              choice.fromEnvelopeId,
              plan.envelopeId,
              plan.month,
              plan.stillShort,
            );
          }
        }
        await store.saveTransaction(householdId, plan.input);
      });
    },
  };
}
