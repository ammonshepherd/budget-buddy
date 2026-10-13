import type { BudgetData } from "../models/types";
import { requireName } from "./input";
import type { Budget } from "./useBudget";
import { nextPosition } from "./useBudgetPage";

/** Settings → Envelope groups: add groups, and delete empty ones. */
export function useEnvelopeGroups(budget: Budget, data: BudgetData) {
  return {
    groups: [...data.groups]
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
      .map((group) => ({
        ...group,
        envelopeCount: data.envelopes.filter((e) => e.groupId === group.id).length,
      })),

    addGroup: async (name: string) => {
      const groupName = requireName(name, "Group name");
      await budget.change((store) =>
        store.addGroup(data.household.id, groupName, nextPosition(data.groups)),
      );
    },

    /** Only an empty group can be deleted; its envelopes keep their history. */
    deleteGroup: async (groupId: string) => {
      await budget.change((store) => store.deleteGroup(groupId));
    },
  };
}
