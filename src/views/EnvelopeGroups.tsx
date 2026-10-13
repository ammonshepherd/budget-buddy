import { useAsyncAction } from "../controllers/useAsyncAction";
import type { Budget } from "../controllers/useBudget";
import { useEnvelopeGroups } from "../controllers/useEnvelopeGroups";
import type { BudgetData } from "../models/types";
import { ErrorMessage, SingleFieldForm } from "./components";

/** Settings card: the groups that hold envelopes on the Budget page. */
export function EnvelopeGroups({ budget, data }: { budget: Budget; data: BudgetData }) {
  const page = useEnvelopeGroups(budget, data);
  const remove = useAsyncAction(page.deleteGroup);

  return (
    <section className="list-card" aria-labelledby="groups-title">
      <div className="section-heading">
        <h2 id="groups-title">Envelope groups</h2>
        <span className="section-count">{page.groups.length}</span>
      </div>
      <p className="empty-state">
        Groups hold envelopes, for example “Bills” or “Everyday”. Add envelopes to a group with its
        + button on the Budget page.
      </p>
      {page.groups.length > 0 && (
        <ul className="item-list" aria-label="Envelope groups">
          {page.groups.map((group) => (
            <li className="item" key={group.id}>
              <span className="item-title">{group.name}</span>
              {group.envelopeCount === 0 ? (
                <button
                  className="text-button danger"
                  type="button"
                  disabled={remove.pending}
                  onClick={() => void remove.run(group.id)}
                >
                  Delete
                </button>
              ) : (
                <span />
              )}
              <span className="item-detail">
                {group.envelopeCount === 0
                  ? "No envelopes"
                  : `${group.envelopeCount} ${group.envelopeCount === 1 ? "envelope" : "envelopes"}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <ErrorMessage error={remove.error} />
      <SingleFieldForm
        label="Group name"
        button="Add group"
        inputMode="text"
        onSubmit={page.addGroup}
      />
    </section>
  );
}
