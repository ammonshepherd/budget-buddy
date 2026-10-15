import { useRef, useState, type KeyboardEvent } from "react";
import { messageOf } from "../../controllers/errors";
import type { Budget } from "../../controllers/useBudget";
import { useBudgetPage } from "../../controllers/useBudgetPage";
import type { EnvelopeRow, GroupRows } from "../../models/budgetMath";
import { centsToInput, formatCents } from "../../models/money";
import type { Month } from "../../models/month";
import type { BudgetData } from "../../models/types";
import { ErrorMessage, Money, Sheet, SingleFieldForm } from "../components";
import { EnvelopeSheet } from "../EnvelopeSheet";

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
  // The envelope whose sheet is open; it closes by itself if the envelope goes.
  const [openId, setOpenId] = useState<string | null>(null);
  const detail = openId ? page.detail(openId) : null;
  const over = view.overAssigned > 0;

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
        <div className="assign-wrap">
          <section
            className={over ? "assign-card over" : "assign-card"}
            aria-label="Available to Assign"
          >
            <span className="assign-label">{over ? "Over Assigned" : "Available to Assign"}</span>
            <strong className="assign-amount">
              <Money cents={over ? view.overAssigned : view.availableToAssign} />
            </strong>
            <span className="assign-helper">
              Income this month <Money cents={view.income} />
            </span>
          </section>
        </div>
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
        <GroupSection key={group.id} group={group} page={page} onOpen={setOpenId} />
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

      <Sheet
        open={detail !== null}
        label={`${detail?.row.name ?? "Envelope"} envelope`}
        className="sheet bottom"
        onClose={() => setOpenId(null)}
      >
        {() => <EnvelopeSheet detail={detail!} page={page} onClose={() => setOpenId(null)} />}
      </Sheet>
    </section>
  );
}

function GroupSection({
  group,
  page,
  onOpen,
}: {
  group: GroupRows;
  page: Page;
  onOpen: (envelopeId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="budget-group" aria-label={group.name}>
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
        <div className="group-add">
          <SingleFieldForm
            label="New envelope"
            button="Add envelope"
            inputMode="text"
            onSubmit={(name) => page.addEnvelope(group.id, name)}
          />
        </div>
      )}
      {group.envelopes.length > 0 ? (
        <ul className="envelope-list">
          {group.envelopes.map((envelope) => (
            <li key={envelope.id}>
              <EnvelopeItem envelope={envelope} page={page} onOpen={() => onOpen(envelope.id)} />
            </li>
          ))}
        </ul>
      ) : (
        !adding && <p className="empty-state group-empty">No envelopes yet. Tap + to add one.</p>
      )}
    </section>
  );
}

/**
 * One envelope: name, Saved and what is left; then Planned and Assigned (tap
 * to edit in place) and Spent. Tapping the top line opens its sheet.
 */
function EnvelopeItem({
  envelope,
  page,
  onOpen,
}: {
  envelope: EnvelopeRow;
  page: Page;
  onOpen: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const card = envelope.card;
  const left = card ? envelope.envelopeMoney : envelope.remaining;

  const save = (action: (id: string, text: string) => Promise<void>) => async (text: string) => {
    setError(null);
    try {
      await action(envelope.id, text);
    } catch (e) {
      setError(messageOf(e));
    }
  };

  return (
    <div className={envelope.inUse ? "envelope" : "envelope unused"}>
      <button className="envelope-top" type="button" aria-haspopup="dialog" onClick={onOpen}>
        <span className="envelope-title">
          <span className="envelope-name">
            {envelope.name}
            {!envelope.inUse && <small> · not used this month</small>}
          </span>
          {!card && <SavedChip cents={envelope.saved} />}
        </span>
        <span className={left === 0 ? "envelope-left zero" : "envelope-left"}>
          <span className="envelope-remaining">
            <Money cents={left} />
          </span>
          <span className="envelope-caption">{card ? "available to pay" : "remaining"}</span>
        </span>
      </button>

      {card ? (
        <div className="envelope-cells two">
          <span className="cell">
            <span className="cell-label">Available to pay</span>{" "}
            <Money cents={envelope.envelopeMoney} />
          </span>
          <span className={card.uncovered > 0 ? "cell debt" : "cell"}>
            <span className="cell-label">Remaining debt</span> <Money cents={card.uncovered} />
          </span>
        </div>
      ) : (
        <div className="envelope-cells">
          <EditableCell
            className="cell planned"
            label="Planned"
            what="planned"
            envelopeName={envelope.name}
            cents={envelope.planned}
            onSave={save(page.setPlanned)}
          />
          <EditableCell
            className="cell assigned"
            label="Assigned"
            what="assigned"
            envelopeName={envelope.name}
            cents={envelope.assigned}
            onSave={save(page.setAssigned)}
          />
          <span className={envelope.overPlan ? "cell spent over" : "cell spent"}>
            {/* Orange when over Planned; screen readers hear it in words. */}
            <span className="cell-label">
              Spent{envelope.overPlan && <span className="visually-hidden"> (over Planned)</span>}
            </span>{" "}
            <Money cents={envelope.outflow} />
          </span>
        </div>
      )}

      {(envelope.refunded > 0 || envelope.shortfall > 0) && (
        <p className="envelope-extra">
          {envelope.refunded > 0 && (
            <span>
              Refunded <Money cents={envelope.refunded} />
            </span>
          )}
          {envelope.shortfall > 0 && (
            <span className="short">
              Short <Money cents={envelope.shortfall} />
            </span>
          )}
        </p>
      )}
      <ErrorMessage error={error} />
    </div>
  );
}

/**
 * A Planned or Assigned amount that turns into a text field when tapped.
 * Leaving the field (tapping anywhere else) or Enter saves; Escape cancels.
 */
function EditableCell({
  className,
  label,
  what,
  envelopeName,
  cents,
  onSave,
}: {
  className: string;
  label: string;
  what: string;
  envelopeName: string;
  cents: number;
  onSave: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Enter and Escape end editing themselves; the blur that follows must not save again.
  const finished = useRef(false);

  const finish = (saveIt: boolean, refocus: boolean) => {
    if (finished.current || text === null) return;
    finished.current = true;
    const typed = text;
    setText(null);
    if (saveIt) void onSave(typed);
    // Back to the cell, unless the tap that ended editing went somewhere else.
    if (refocus) requestAnimationFrame(() => button.current?.focus());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true, true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false, true);
    }
  };

  if (text !== null) {
    return (
      <label className={`${className} editing`}>
        <span className="cell-label">{label}</span>
        <input
          aria-label={`${label} amount for ${envelopeName}`}
          inputMode="decimal"
          autoFocus
          value={text}
          onFocus={(event) => event.target.select()}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => finish(true, false)}
        />
      </label>
    );
  }
  return (
    <button
      ref={button}
      className={className}
      type="button"
      aria-label={`Edit ${what} amount for ${envelopeName}, currently ${formatCents(cents)}`}
      onClick={() => {
        finished.current = false;
        setText(centsToInput(cents));
      }}
    >
      <span className="cell-label">{label}</span> <Money cents={cents} />
    </button>
  );
}

const STAR = "M12 1l2.6 8.4L23 12l-8.4 2.6L12 23l-2.6-8.4L1 12l8.4-2.6z";

/**
 * Saved as a pill on the name line. Once money is saved it is solid purple
 * with sparkles, to encourage saving; at $0.00 it is quiet.
 */
function SavedChip({ cents }: { cents: number }) {
  if (cents <= 0) {
    return (
      <span className="saved-chip">
        Saved <Money cents={cents} />
      </span>
    );
  }
  return (
    <span className="saved-chip sparkle">
      <svg className="star" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
        <path d={STAR} fill="#F3D36B" />
      </svg>
      Saved <Money cents={cents} />
      <svg className="star corner" width="9" height="9" viewBox="0 0 24 24" aria-hidden="true">
        <path d={STAR} fill="#B48BE0" />
      </svg>
    </span>
  );
}
