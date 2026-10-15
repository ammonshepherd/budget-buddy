import type { BudgetData } from "../models/types";
import { requireName } from "./input";
import type { Budget } from "./useBudget";
import { envelopeEdits, nextPosition } from "./envelopeEdits";

const byPosition = <T extends { position: number; name: string }>(a: T, b: T) =>
  a.position - b.position || a.name.localeCompare(b.name);

/** Gives each listed item its place in `ids` as its position (for showing a new order at once). */
function withOrder<T extends { id: string; position: number }>(items: T[], ids: string[]): T[] {
  return items.map((item) =>
    ids.includes(item.id) ? { ...item, position: ids.indexOf(item.id) } : item,
  );
}

/**
 * Settings → Envelope groups: add, rename, reorder, and delete empty groups;
 * rename, reorder and move envelopes.
 */
export function useEnvelopeGroups(budget: Budget, data: BudgetData) {
  return {
    ...envelopeEdits(budget, data),

    groups: [...data.groups].sort(byPosition).map((group) => ({
      ...group,
      envelopes: data.envelopes.filter((e) => e.groupId === group.id).sort(byPosition),
    })),

    addGroup: async (name: string) => {
      const groupName = requireName(name, "Group name");
      await budget.change((store) =>
        store.addGroup(data.household.id, groupName, nextPosition(data.groups)),
      );
    },

    renameGroup: async (groupId: string, name: string) => {
      const groupName = requireName(name, "Group name");
      await budget.change((store) => store.renameGroup(groupId, groupName));
    },

    /** `groupIds`: every group, top first. Shown at once, then saved. */
    reorderGroups: async (groupIds: string[]) => {
      await budget.change(
        (store) => store.reorderGroups(data.household.id, groupIds),
        (d) => ({ ...d, groups: withOrder(d.groups, groupIds) }),
      );
    },

    /** `envelopeIds`: every envelope of the group, top first. Shown at once, then saved. */
    reorderEnvelopes: async (groupId: string, envelopeIds: string[]) => {
      await budget.change(
        (store) => store.reorderEnvelopes(groupId, envelopeIds),
        (d) => ({ ...d, envelopes: withOrder(d.envelopes, envelopeIds) }),
      );
    },

    /** Only an empty group can be deleted; its envelopes keep their history. */
    deleteGroup: async (groupId: string) => {
      await budget.change((store) => store.deleteGroup(groupId));
    },
  };
}
