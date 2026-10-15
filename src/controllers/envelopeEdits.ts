import { UserFacingError } from "../models/dataStore";
import type { BudgetData, Envelope } from "../models/types";
import { requireName } from "./input";
import type { Budget } from "./useBudget";

export const nextPosition = (items: { position: number }[]) =>
  items.reduce((max, item) => Math.max(max, item.position + 1), 0);

/** The envelope, unless it is a card's payment envelope (named after, and grouped with, its card). */
function ordinaryEnvelope(data: BudgetData, envelopeId: string, refusal: string): Envelope {
  const envelope = data.envelopes.find((e) => e.id === envelopeId);
  if (!envelope) throw new UserFacingError("Envelope not found");
  if (envelope.cardAccountId) throw new UserFacingError(refusal);
  return envelope;
}

/**
 * Renaming and moving an envelope, shared by the envelope sheet (Budget) and
 * the group sheet (Settings). Both show the change at once, then save it.
 */
export function envelopeEdits(budget: Budget, data: BudgetData) {
  return {
    renameEnvelope: async (envelopeId: string, name: string) => {
      const envelopeName = requireName(name, "Envelope name");
      ordinaryEnvelope(data, envelopeId, "A card's payment envelope is named after its card.");
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

    /** Moves an envelope to the bottom of another group. Its money and history go with it. */
    moveEnvelope: async (envelopeId: string, groupId: string) => {
      const envelope = ordinaryEnvelope(
        data,
        envelopeId,
        "A card's payment envelope stays with the other card payments.",
      );
      if (envelope.groupId === groupId) return;
      if (!data.groups.some((g) => g.id === groupId)) throw new UserFacingError("Group not found");
      const position = nextPosition(data.envelopes.filter((e) => e.groupId === groupId));
      await budget.change(
        (store) => store.moveEnvelope(envelopeId, groupId, position),
        (current) => ({
          ...current,
          envelopes: current.envelopes.map((e) =>
            e.id === envelopeId ? { ...e, groupId, position } : e,
          ),
        }),
      );
    },
  };
}
