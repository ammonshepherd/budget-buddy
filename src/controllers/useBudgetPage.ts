import { useMemo, useState } from "react";
import {
  buildBudgetMonth,
  visibleGroups,
  withEnvelopeMonth,
  type EnvelopeRow,
} from "../models/budgetMath";
import { UserFacingError } from "../models/dataStore";
import { envelopeActivity, planCheck, remainingParts } from "../models/envelopeDetail";
import { formatCents, roundMoney } from "../models/money";
import { addMonths, formatMonth, type Month } from "../models/month";
import { budgetHref } from "../models/routes";
import type { BudgetData } from "../models/types";
import { requireCents, requireName } from "./input";
import type { Budget } from "./useBudget";

/** A typed Planned or Assigned amount: a number of dollars, zero or more, rounded to the cent. */
function amountTyped(text: string, label: string) {
  const cents = roundMoney(text);
  if (cents === null) throw new UserFacingError(`${label}: enter an amount like 12.34`);
  if (cents < 0) throw new UserFacingError(`${label} cannot be negative.`);
  return cents;
}

export const nextPosition = (items: { position: number }[]) =>
  items.reduce((max, item) => Math.max(max, item.position + 1), 0);

/** The Budget page for one month: the numbers to show and what the user can do. */
export function useBudgetPage(budget: Budget, data: BudgetData, month: Month) {
  const view = useMemo(() => buildBudgetMonth(data, month), [data, month]);
  const [showUnused, setShowUnused] = useState(false);
  const householdId = data.household.id;

  const envelope = (id: string): EnvelopeRow => {
    const row = view.groups.flatMap((g) => g.envelopes).find((e) => e.id === id);
    if (!row) throw new UserFacingError("Envelope not found");
    return row;
  };

  return {
    view,
    /** Groups and envelopes to show: only those in use this month, unless toggled. */
    groups: visibleGroups(view, showUnused),
    showUnused,
    toggleUnused: () => setShowUnused((show) => !show),
    monthLabel: formatMonth(month),
    previousHref: budgetHref(addMonths(month, -1)),
    nextHref: budgetHref(addMonths(month, 1)),

    /** What the envelope sheet shows; null once the envelope is gone (deleted). */
    detail: (envelopeId: string) => {
      const group = view.groups.find((g) => g.envelopes.some((e) => e.id === envelopeId));
      const row = group?.envelopes.find((e) => e.id === envelopeId);
      if (!group || !row) return null;
      return {
        row,
        groupName: group.name,
        plan: planCheck(row),
        parts: remainingParts(row),
        activity: envelopeActivity(data, envelopeId, month),
      };
    },

    /**
     * Adds to Assigned (negative takes money back). Used where there is no
     * Assigned cell to edit: a card's payment envelope.
     */
    assign: async (envelopeId: string, text: string) => {
      const amount = requireCents(text);
      if (amount === 0) return;
      if (amount > view.assignable) {
        throw new UserFacingError(
          `Only ${formatCents(view.assignable)} is available to assign in ${formatMonth(month)}.`,
        );
      }
      const remaining = Math.max(0, envelope(envelopeId).remaining);
      if (-amount > remaining) {
        throw new UserFacingError(`You can take back at most ${formatCents(remaining)}.`);
      }
      await budget.change((store) =>
        store.adjustEnvelopeMonth(envelopeId, month, { assigned: amount }),
      );
    },

    /** Moves money from this envelope's Saved into Remaining. */
    release: async (envelopeId: string, text: string) => {
      const amount = requireCents(text);
      const saved = Math.max(0, envelope(envelopeId).saved);
      if (amount <= 0) throw new UserFacingError("Enter an amount above zero to release.");
      if (amount > saved) throw new UserFacingError(`Only ${formatCents(saved)} is saved.`);
      await budget.change((store) =>
        store.adjustEnvelopeMonth(envelopeId, month, { released: amount }),
      );
    },

    /**
     * Sets this month's Planned (typed in the row; rounded to the cent).
     * Planned is a forecast only: nothing else changes.
     */
    setPlanned: async (envelopeId: string, text: string) => {
      const planned = amountTyped(text, "Planned");
      if (planned === envelope(envelopeId).planned) return;
      await budget.change(
        (store) => store.setPlanned(householdId, envelopeId, month, planned),
        (current) => withEnvelopeMonth(current, envelopeId, month, { planned }),
      );
    },

    /**
     * Sets this month's Assigned to a new total (typed in the row). The
     * difference comes from, or goes back to, Available to Assign.
     */
    setAssigned: async (envelopeId: string, text: string) => {
      const row = envelope(envelopeId);
      const change = amountTyped(text, "Assigned") - row.assigned;
      if (change === 0) return;
      if (change > view.assignable) {
        throw new UserFacingError(
          `Only ${formatCents(Math.max(0, view.assignable))} available to assign.`,
        );
      }
      // Remaining = Assigned + Released − Spent may not drop below zero.
      if (row.remaining + change < 0) {
        const lowest = formatCents(Math.max(0, row.assigned - row.remaining));
        throw new UserFacingError(
          `Some is already spent: Assigned can go no lower than ${lowest}.`,
        );
      }
      await budget.change(
        (store) => store.adjustEnvelopeMonth(envelopeId, month, { assigned: change }),
        (current) => withEnvelopeMonth(current, envelopeId, month, { assigned: change }),
      );
    },

    addEnvelope: async (groupId: string, name: string) => {
      const envelopeName = requireName(name, "Envelope name");
      const siblings = data.envelopes.filter((e) => e.groupId === groupId);
      await budget.change((store) =>
        store.addEnvelope(householdId, groupId, envelopeName, nextPosition(siblings)),
      );
    },

    renameEnvelope: async (envelopeId: string, name: string) => {
      const envelopeName = requireName(name, "Envelope name");
      if (envelope(envelopeId).card) {
        throw new UserFacingError("A card's payment envelope is named after its card.");
      }
      await budget.change(
        (store) => store.renameEnvelope(envelopeId, envelopeName),
        (current) => ({
          ...current,
          envelopes: current.envelopes.map((e) =>
            e.id === envelopeId ? { ...e, name: envelopeName } : e,
          ),
        }),
      );
    },

    deleteEnvelope: async (envelopeId: string) => {
      await budget.change((store) => store.deleteEnvelope(envelopeId));
    },
  };
}
