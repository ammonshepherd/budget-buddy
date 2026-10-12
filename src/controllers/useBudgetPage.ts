import { useMemo } from "react";
import { buildBudgetMonth, type EnvelopeRow } from "../models/budgetMath";
import { UserFacingError } from "../models/dataStore";
import { formatCents } from "../models/money";
import { addMonths, formatMonth, type Month } from "../models/month";
import { budgetHref } from "../models/routes";
import type { BudgetData } from "../models/types";
import { requireCents, requireName } from "./input";
import type { Budget } from "./useBudget";

const nextPosition = (items: { position: number }[]) =>
  items.reduce((max, item) => Math.max(max, item.position + 1), 0);

/** The Budget page for one month: the numbers to show and what the user can do. */
export function useBudgetPage(budget: Budget, data: BudgetData, month: Month) {
  const view = useMemo(() => buildBudgetMonth(data, month), [data, month]);
  const householdId = data.household.id;

  const envelope = (id: string): EnvelopeRow => {
    const row = view.groups.flatMap((g) => g.envelopes).find((e) => e.id === id);
    if (!row) throw new UserFacingError("Envelope not found");
    return row;
  };

  return {
    view,
    monthLabel: formatMonth(month),
    previousHref: budgetHref(addMonths(month, -1)),
    nextHref: budgetHref(addMonths(month, 1)),

    /** Positive assigns from Available to Assign; negative takes money back. */
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

    setPlanned: async (envelopeId: string, text: string) => {
      const planned = requireCents(text, "Planned");
      if (planned < 0) throw new UserFacingError("Planned cannot be negative.");
      await budget.change((store) => store.setPlanned(householdId, envelopeId, month, planned));
    },

    addGroup: async (name: string) => {
      const groupName = requireName(name, "Group name");
      await budget.change((store) =>
        store.addGroup(householdId, groupName, nextPosition(data.groups)),
      );
    },

    addEnvelope: async (groupId: string, name: string) => {
      const envelopeName = requireName(name, "Envelope name");
      const siblings = data.envelopes.filter((e) => e.groupId === groupId);
      await budget.change((store) =>
        store.addEnvelope(householdId, groupId, envelopeName, nextPosition(siblings)),
      );
    },

    deleteEnvelope: async (envelopeId: string) => {
      await budget.change((store) => store.deleteEnvelope(envelopeId));
    },

    deleteGroup: async (groupId: string) => {
      await budget.change((store) => store.deleteGroup(groupId));
    },
  };
}
