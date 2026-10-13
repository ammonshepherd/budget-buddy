import { useAsyncAction } from "../../controllers/useAsyncAction";
import type { Budget } from "../../controllers/useBudget";
import { useBudgetPage } from "../../controllers/useBudgetPage";
import type { EnvelopeRow, GroupRows } from "../../models/budgetMath";
import type { Month } from "../../models/month";
import type { BudgetData } from "../../models/types";
import { ErrorMessage, Money, SingleFieldForm } from "../components";

type Page = ReturnType<typeof useBudgetPage>;

export function BudgetPage({
  budget,
  data,
  month,
}: {
  budget: Budget;
  data: BudgetData;
  month: Month;
}) {
  const page = useBudgetPage(budget, data, month);
  const { view } = page;

  return (
    <section className="page-view stack" aria-labelledby="budget-title">
      <header className="page-heading">
        <div className="month-nav eyebrow">
          <a href={page.previousHref} aria-label="Previous month">
            ‹
          </a>
          <span>{page.monthLabel}</span>
          <a href={page.nextHref} aria-label="Next month">
            ›
          </a>
        </div>
        <h1 id="budget-title">Budget</h1>
        <p>Give every dollar a job before the month gets busy.</p>
      </header>

      <section className="hero-card" aria-label="Available to Assign">
        <span className="card-label">Available to Assign</span>
        <strong className="hero-amount money">
          <Money cents={view.availableToAssign} />
        </strong>
        <span className="card-helper">
          {view.overAssigned > 0 ? (
            <>
              Over assigned by <Money cents={view.overAssigned} />
            </>
          ) : (
            "Ready to give a job"
          )}
        </span>
      </section>

      <section className="summary-grid four" aria-label="Budget summary">
        {(
          [
            ["Assigned", view.totals.assigned],
            ["Spent", view.totals.spent],
            ["Remaining", view.totals.remaining],
            ["Saved", view.totals.saved],
          ] as const
        ).map(([label, cents]) => (
          <article className="summary-card" key={label}>
            <span>{label}</span>
            <strong>
              <Money cents={cents} />
            </strong>
          </article>
        ))}
      </section>

      {data.accounts.length === 0 && (
        <p className="notice">
          Start by <a href="#accounts">adding an account</a>; its balance becomes money to assign.
        </p>
      )}

      {page.groups.map((group) => (
        <GroupCard key={group.id} group={group} page={page} />
      ))}

      {view.unusedCount > 0 && (
        <p className="unused-toggle">
          <button className="text-button" type="button" onClick={page.toggleUnused}>
            {page.showUnused
              ? "Hide envelopes not used this month"
              : `Show ${view.unusedCount} ${view.unusedCount === 1 ? "envelope" : "envelopes"} not used this month`}
          </button>
        </p>
      )}

      <section className="list-card">
        <div className="section-heading">
          <h2>Add a group</h2>
        </div>
        {view.groups.length === 0 && (
          <p className="empty-state">Groups hold envelopes, for example “Bills” or “Everyday”.</p>
        )}
        <SingleFieldForm
          label="Group name"
          button="Add group"
          inputMode="text"
          onSubmit={page.addGroup}
        />
      </section>
    </section>
  );
}

function GroupCard({ group, page }: { group: GroupRows; page: Page }) {
  const remove = useAsyncAction(() => page.deleteGroup(group.id));
  return (
    <section className="list-card" aria-label={group.name}>
      <div className="section-heading">
        <h2>{group.name}</h2>
        <span className="section-count">{group.envelopes.length}</span>
      </div>
      {group.envelopes.length > 0 ? (
        <ul className="envelope-list">
          {group.envelopes.map((envelope) => (
            <li key={envelope.id}>
              <EnvelopeItem envelope={envelope} page={page} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="button-row">
          <p className="empty-state">No envelopes yet.</p>
          <button
            className="text-button danger"
            type="button"
            disabled={remove.pending}
            onClick={() => remove.run()}
          >
            Delete group
          </button>
        </div>
      )}
      <ErrorMessage error={remove.error} />
      <SingleFieldForm
        label="New envelope"
        button="Add envelope"
        inputMode="text"
        onSubmit={(name) => page.addEnvelope(group.id, name)}
      />
    </section>
  );
}

function EnvelopeItem({ envelope, page }: { envelope: EnvelopeRow; page: Page }) {
  const remove = useAsyncAction(() => page.deleteEnvelope(envelope.id));
  return (
    <details className={envelope.inUse ? "envelope" : "envelope unused"}>
      <summary>
        <span className="envelope-name">
          {envelope.name}
          {!envelope.inUse && <small> · not used this month</small>}
        </span>
        <span className="envelope-remaining">
          <Money cents={envelope.remaining} />
        </span>
        <span className="envelope-figures">
          <span>
            Plan <Money cents={envelope.planned} />
          </span>
          <span>
            Assigned <Money cents={envelope.assigned} />
          </span>
          {envelope.card?.open ? (
            // Card purchases move money in (negative Spent); payments take it out.
            <span>
              From card <Money cents={-envelope.spent} />
            </span>
          ) : (
            <span>
              Spent <Money cents={envelope.spent} />
            </span>
          )}
          <span>
            Saved <Money cents={envelope.saved} />
          </span>
          {envelope.card && (
            <>
              <span>
                Owed <Money cents={envelope.card.owed} />
              </span>
              {envelope.card.uncovered > 0 && (
                <span className="short">
                  Uncovered <Money cents={envelope.card.uncovered} />
                </span>
              )}
            </>
          )}
          {envelope.shortfall > 0 && (
            <span className="short">
              Short <Money cents={envelope.shortfall} />
            </span>
          )}
        </span>
      </summary>
      <div className="envelope-actions">
        <SingleFieldForm
          label="Assign (negative to take back)"
          button="Assign"
          placeholder="0.00"
          onSubmit={(text) => page.assign(envelope.id, text)}
        />
        {envelope.saved > 0 && (
          <SingleFieldForm
            label="Release from Saved"
            button="Release"
            placeholder="0.00"
            onSubmit={(text) => page.release(envelope.id, text)}
          />
        )}
        <SingleFieldForm
          label="Planned"
          button="Set plan"
          placeholder="0.00"
          onSubmit={(text) => page.setPlanned(envelope.id, text)}
        />
        {envelope.card ? (
          <p className="empty-state">
            Card purchases move money in here from their envelopes; payments to the card (a Transfer
            on both accounts) take it out. Assign here to pay down what is uncovered.
          </p>
        ) : (
          <div className="button-row">
            <button
              className="text-button danger"
              type="button"
              disabled={remove.pending}
              onClick={() => {
                if (
                  window.confirm(
                    `Delete the ${envelope.name} envelope? Money assigned to it returns to Available to Assign.`,
                  )
                )
                  void remove.run();
              }}
            >
              Delete envelope
            </button>
          </div>
        )}
        <ErrorMessage error={remove.error} />
      </div>
    </details>
  );
}
