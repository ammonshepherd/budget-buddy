import { useState } from "react";
import { useAsyncAction } from "../controllers/useAsyncAction";
import type { Budget } from "../controllers/useBudget";
import { useEnvelopeGroups } from "../controllers/useEnvelopeGroups";
import type { BudgetData } from "../models/types";
import { EditableTitle, ErrorMessage, Sheet, SingleFieldForm } from "./components";
import { SortableList } from "./SortableList";

type Page = ReturnType<typeof useEnvelopeGroups>;
type Group = Page["groups"][number];

const countEnvelopes = (count: number) =>
  count === 0 ? "No envelopes" : `${count} ${count === 1 ? "envelope" : "envelopes"}`;

/**
 * Settings card: the groups that hold envelopes on the Budget page. Drag a
 * group's handle to reorder; tap it to rename it and reorder its envelopes.
 */
export function EnvelopeGroups({ budget, data }: { budget: Budget; data: BudgetData }) {
  const page = useEnvelopeGroups(budget, data);
  const reorder = useAsyncAction(page.reorderGroups);
  // The group open in the sheet; it closes by itself if the group goes.
  const [openId, setOpenId] = useState<string | null>(null);
  const open = page.groups.find((g) => g.id === openId);

  return (
    <section className="list-card" aria-labelledby="groups-title">
      <div className="section-heading">
        <h2 id="groups-title">Envelope groups</h2>
        <span className="section-count">{page.groups.length}</span>
      </div>
      <p className="empty-state">
        Groups hold envelopes, for example “Bills” or “Everyday”. Add envelopes to a group with its
        + button on the Budget page. Drag the dots to change the order; tap a group to rename it or
        organize its envelopes.
      </p>
      {page.groups.length > 0 && (
        <SortableList
          label="Envelope groups"
          items={page.groups}
          onReorder={(ids) => void reorder.run(ids)}
        >
          {(group) => (
            <button
              className="item item-button"
              type="button"
              aria-haspopup="dialog"
              onClick={() => setOpenId(group.id)}
            >
              <span className="item-title">{group.name}</span>
              <span className="item-detail">{countEnvelopes(group.envelopes.length)}</span>
            </button>
          )}
        </SortableList>
      )}
      <ErrorMessage error={reorder.error} />
      <SingleFieldForm
        label="Group name"
        button="Add group"
        inputMode="text"
        onSubmit={page.addGroup}
      />

      <Sheet
        open={open !== undefined}
        label={open?.name ?? "Envelope group"}
        className="sheet bottom"
        onClose={() => setOpenId(null)}
      >
        {() => <GroupSheet group={open!} page={page} onClose={() => setOpenId(null)} />}
      </Sheet>
    </section>
  );
}

/**
 * One group: its name to edit; its envelopes to reorder, rename and move to
 * another group; and Delete when empty.
 */
function GroupSheet({ group, page, onClose }: { group: Group; page: Page; onClose: () => void }) {
  const reorder = useAsyncAction((ids: string[]) => page.reorderEnvelopes(group.id, ids));
  // What the last move did, read out and shown: the envelope leaves this list.
  const [moved, setMoved] = useState<string | null>(null);
  const move = useAsyncAction(async (envelopeId: string, name: string, groupId: string) => {
    setMoved(null);
    await page.moveEnvelope(envelopeId, groupId);
    setMoved(`Moved ${name} to ${page.groups.find((g) => g.id === groupId)?.name ?? "its group"}.`);
  });
  const otherGroups = page.groups.filter((g) => g.id !== group.id);
  const remove = useAsyncAction(async () => {
    await page.deleteGroup(group.id);
    onClose();
  });

  return (
    <div className="envelope-sheet">
      <div className="sheet-handle" aria-hidden="true" />
      <header className="sheet-header">
        <div>
          <span className="sheet-eyebrow">Envelope group</span>
          <EditableTitle
            name={group.name}
            label="Group name"
            onSave={(name) => page.renameGroup(group.id, name)}
          />
        </div>
        <button className="sheet-close" type="button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>

      <section className="group-envelopes" aria-labelledby="group-envelopes-title">
        <h3 id="group-envelopes-title">Envelopes</h3>
        {group.envelopes.length === 0 ? (
          <p className="empty-state">
            No envelopes yet. Add them with the group&apos;s + button on the Budget page.
          </p>
        ) : (
          <>
            <SortableList
              label={`Envelopes in ${group.name}`}
              items={group.envelopes}
              onReorder={(ids) => void reorder.run(ids)}
            >
              {(envelope) =>
                envelope.cardAccountId ? (
                  // Named after its card, and kept with the other card payments.
                  <span className="item item-title">{envelope.name}</span>
                ) : (
                  <div className="group-envelope">
                    <EditableTitle
                      row
                      name={envelope.name}
                      label="Envelope name"
                      onSave={(name) => page.renameEnvelope(envelope.id, name)}
                    />
                    {otherGroups.length > 0 && (
                      <span className="move-picker">
                        <select
                          aria-label={`Move ${envelope.name} to another group`}
                          value=""
                          disabled={move.pending}
                          onChange={(event) =>
                            void move.run(envelope.id, envelope.name, event.target.value)
                          }
                        >
                          <option value="" disabled>
                            Move to…
                          </option>
                          {otherGroups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                        <span aria-hidden="true">▾</span>
                      </span>
                    )}
                  </div>
                )
              }
            </SortableList>
            <p className="empty-state">
              Drag the dots to change the order on the Budget page. Tap a name to rename it; use
              Move to… to put it in another group (its money and history go with it).
            </p>
          </>
        )}
        <ErrorMessage error={reorder.error} />
        <ErrorMessage error={move.error} />
        <p className="move-status" role="status">
          {moved}
        </p>
      </section>

      {group.envelopes.length === 0 ? (
        <button
          className="text-button danger sheet-delete"
          type="button"
          disabled={remove.pending}
          onClick={() => {
            if (window.confirm(`Delete the ${group.name} group?`)) void remove.run();
          }}
        >
          Delete group
        </button>
      ) : (
        <p className="empty-state">Only an empty group can be deleted.</p>
      )}
      <ErrorMessage error={remove.error} />
    </div>
  );
}
