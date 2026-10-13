import { useState } from "react";
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
    <section className="page-view budget-page" aria-labelledby="budget-title">
      {/* Read by screen readers; the envelopes get the screen space. */}
      <h1 id="budget-title" className="visually-hidden">
        Budget
      </h1>

      <div className="budget-month month-nav">
        <a href={page.previousHref} aria-label="Previous month">
          ‹
        </a>
        <span>{page.monthLabel}</span>
        <a href={page.nextHref} aria-label="Next month">
          ›
        </a>
      </div>

      {/* Stays at the top while the envelopes scroll under it; hidden when
          there is nothing left to assign (but shown when over assigned). */}
      {view.availableToAssign !== 0 && (
        <section className="assign-bar" aria-label="Available to Assign">
          <span className="assign-label">Available to Assign</span>
          <strong className="assign-amount money">
            <Money cents={view.availableToAssign} />
          </strong>
          <span className="assign-helper">
            {view.overAssigned > 0 ? (
              <>
                Over assigned by <Money cents={view.overAssigned} />
              </>
            ) : (
              <>
                Income this month <Money cents={view.income} />
              </>
            )}
          </span>
        </section>
      )}

      {view.toReview.count > 0 && (
        <p className="notice compact">
          {view.toReview.count} {view.toReview.count === 1 ? "transaction" : "transactions"} to
          review (<Money cents={view.toReview.inflow} /> in, <Money cents={view.toReview.outflow} />{" "}
          out) {view.toReview.count === 1 ? "is" : "are"} not in Available to Assign yet.{" "}
          <a href="#activity">Review them on Activity</a>.
        </p>
      )}

      {data.accounts.length === 0 && (
        <p className="notice compact">
          Start by <a href="#accounts">adding an account</a>; its balance becomes money to assign.
        </p>
      )}

      {view.groups.length === 0 && (
        <p className="notice compact">
          No envelopes yet. <a href="#settings">Add an envelope group in Settings</a>, then add
          envelopes to it here with its + button.
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
    </section>
  );
}

function GroupCard({ group, page }: { group: GroupRows; page: Page }) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="group-card" aria-label={group.name}>
      <div className="group-heading">
        <h2>{group.name}</h2>
        <button
          className="add-envelope-button"
          type="button"
          aria-label={adding ? `Stop adding to ${group.name}` : `Add envelope to ${group.name}`}
          aria-expanded={adding}
          onClick={() => setAdding((open) => !open)}
        >
          {adding ? "×" : "+"}
        </button>
      </div>
      {adding && (
        <SingleFieldForm
          label="New envelope"
          button="Add envelope"
          inputMode="text"
          onSubmit={(name) => page.addEnvelope(group.id, name)}
        />
      )}
      {group.envelopes.length > 0 ? (
        <ul className="envelope-list">
          {group.envelopes.map((envelope) => (
            <li key={envelope.id}>
              <EnvelopeItem envelope={envelope} page={page} />
            </li>
          ))}
        </ul>
      ) : (
        !adding && <p className="empty-state">No envelopes yet. Tap + to add one.</p>
      )}
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
        {envelope.card ? (
          // A card's payment envelope: what can be paid now, and what is left after that.
          <>
            <span className="envelope-remaining">
              <Money cents={envelope.envelopeMoney} />
            </span>
            <span className="envelope-figures">
              <span>
                Available to pay <Money cents={envelope.envelopeMoney} />
              </span>
              <span className={envelope.card.uncovered > 0 ? "short" : undefined}>
                Remaining debt <Money cents={envelope.card.uncovered} />
              </span>
              {envelope.shortfall > 0 && (
                <span className="short">
                  Short <Money cents={envelope.shortfall} />
                </span>
              )}
            </span>
          </>
        ) : (
          <>
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
              {/* Refunds are not spending: they only raise Remaining. */}
              <span>
                Spent <Money cents={envelope.outflow} />
              </span>
              <SavedAmount cents={envelope.saved} />
              {envelope.shortfall > 0 && (
                <span className="short">
                  Short <Money cents={envelope.shortfall} />
                </span>
              )}
            </span>
          </>
        )}
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
            on both accounts) take it out. Assign here to pay down the remaining debt.
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

/** Saved stands out (bigger, purple, and sparkling when there is some) to encourage saving. */
function SavedAmount({ cents }: { cents: number }) {
  return (
    <span className={cents > 0 ? "saved-amount sparkle" : "saved-amount"}>
      {cents > 0 && (
        <span className="sparkle-icon" aria-hidden="true">
          ✨
        </span>
      )}
      Saved <Money cents={cents} />
    </span>
  );
}
