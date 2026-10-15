import { useState, type KeyboardEvent } from "react";
import { messageOf } from "../controllers/errors";
import { useAsyncAction } from "../controllers/useAsyncAction";
import type { useBudgetPage } from "../controllers/useBudgetPage";
import type { RemainingPart } from "../models/envelopeDetail";
import { centsToInput } from "../models/money";
import { formatShortDay } from "../models/month";
import { EditableTitle, ErrorMessage, Money, SingleFieldForm } from "./components";

type Page = ReturnType<typeof useBudgetPage>;
type Detail = NonNullable<ReturnType<Page["detail"]>>;

const STAR = "M12 1l2.6 8.4L23 12l-8.4 2.6L12 23l-2.6-8.4L1 12l8.4-2.6z";

/**
 * Everything about one envelope this month, in a sheet at the bottom of the
 * screen: its group (to move it) and name (to rename), what is left and how it adds up, the plan, Planned and Assigned to
 * edit, Saved with "Move some into Remaining…", and its transactions.
 */
export function EnvelopeSheet({
  detail,
  page,
  onClose,
}: {
  detail: Detail;
  page: Page;
  onClose: () => void;
}) {
  const { row } = detail;
  const [error, setError] = useState<string | null>(null);
  const move = useAsyncAction(page.moveEnvelope);
  const remove = useAsyncAction(async () => {
    await page.deleteEnvelope(row.id);
    onClose();
  });

  /** Saves a typed amount; false (with the reason shown) when it was refused. */
  const save =
    (action: (id: string, text: string) => Promise<void>) =>
    async (text: string): Promise<boolean> => {
      setError(null);
      try {
        await action(row.id, text);
        return true;
      } catch (e) {
        setError(messageOf(e));
        return false;
      }
    };

  return (
    <div className="envelope-sheet">
      <div className="sheet-handle" aria-hidden="true" />
      <header className="sheet-header">
        <div>
          {row.card ? (
            <span className="sheet-eyebrow">{detail.groupName}</span>
          ) : (
            <span className="group-picker">
              <select
                className="sheet-eyebrow"
                aria-label={`Group for ${row.name}`}
                value={detail.groupId}
                disabled={move.pending}
                onChange={(event) => void move.run(row.id, event.target.value)}
              >
                {page.allGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
              <span aria-hidden="true">▾</span>
            </span>
          )}
          {row.card ? (
            <h2>{row.name}</h2>
          ) : (
            <EditableTitle
              name={row.name}
              label="Envelope name"
              onSave={(name) => page.renameEnvelope(row.id, name)}
            />
          )}
        </div>
        <button className="sheet-close" type="button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <ErrorMessage error={move.error} />

      {row.card ? (
        <>
          <div className="sheet-hero">
            <span className="sheet-hero-label">Available to pay</span>
            <strong className="sheet-hero-amount">
              <Money cents={row.envelopeMoney} />
            </strong>
            <span className="sheet-hero-parts">
              Owed <Money cents={row.card.owed} /> · Remaining debt{" "}
              <Money cents={row.card.uncovered} />
            </span>
          </div>
          {row.shortfall > 0 && (
            <p className="short sheet-short">
              Short <Money cents={row.shortfall} />
            </p>
          )}
          <SingleFieldForm
            label="Assign (negative to take back)"
            button="Assign"
            placeholder="0.00"
            onSubmit={(text) => page.assign(row.id, text)}
          />
          <SavedPanel saved={row.saved} onMove={(text) => page.release(row.id, text)} />
          <p className="empty-state">
            Card purchases move money in here from their envelopes; payments to the card (a Transfer
            on both accounts) take it out. Assign here to pay down the remaining debt.
          </p>
        </>
      ) : (
        <>
          <div className="sheet-hero">
            <span className="sheet-hero-label">Remaining this month</span>
            <strong
              className={row.remaining === 0 ? "sheet-hero-amount zero" : "sheet-hero-amount"}
            >
              <Money cents={row.remaining} />
            </strong>
            <span className="sheet-hero-parts">
              <RemainingParts parts={detail.parts} />
            </span>
          </div>
          {row.shortfall > 0 && (
            <p className="short sheet-short">
              Short <Money cents={row.shortfall} />
            </p>
          )}

          <PlanLine plan={detail.plan} />

          <div className="sheet-fields">
            <AmountField
              className="sheet-field planned"
              label="Planned"
              envelopeName={row.name}
              cents={row.planned}
              onSave={save(page.setPlanned)}
            />
            <AmountField
              className="sheet-field"
              label="Assigned"
              envelopeName={row.name}
              cents={row.assigned}
              onSave={save(page.setAssigned)}
            />
            <div className="sheet-field">
              <span className="sheet-field-label">Spent</span>
              <span className="sheet-field-value">
                <Money cents={row.outflow} />
              </span>
            </div>
          </div>
          <ErrorMessage error={error} />

          <SavedPanel saved={row.saved} onMove={(text) => page.release(row.id, text)} />

          <section className="sheet-activity" aria-label={`${row.name} transactions`}>
            <h3>This month&apos;s transactions</h3>
            {detail.activity.length === 0 ? (
              <p className="empty-state">No transactions in this envelope this month.</p>
            ) : (
              <ul>
                {detail.activity.map((item) => (
                  <li key={item.id}>
                    <span className="activity-what">
                      {formatShortDay(item.date)} · {item.payee || "(no payee)"}
                      <small>
                        {item.accountName}
                        {item.splitTotal !== null && (
                          <>
                            {" "}
                            · part of a <Money cents={item.splitTotal} /> split
                          </>
                        )}
                      </small>
                    </span>
                    <strong>
                      <Money cents={item.amount} />
                    </strong>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <button
            className="text-button danger sheet-delete"
            type="button"
            disabled={remove.pending}
            onClick={() => {
              if (
                window.confirm(
                  `Delete the ${row.name} envelope? Money assigned to it returns to Available to Assign.`,
                )
              )
                void remove.run();
            }}
          >
            Delete envelope
          </button>
          <ErrorMessage error={remove.error} />
        </>
      )}
    </div>
  );
}

/** "$300.00 assigned + $20.00 released − $187.06 spent" */
function RemainingParts({ parts }: { parts: RemainingPart[] }) {
  return (
    <>
      {parts.map((part, i) => (
        <span key={part.label}>
          {i > 0 && (part.subtract ? " − " : " + ")}
          <Money cents={part.amount} /> {part.label}
        </span>
      ))}
    </>
  );
}

function PlanLine({ plan }: { plan: Detail["plan"] }) {
  if (plan.status === "none") {
    return (
      <p className="plan-line">
        <span>
          Spent <Money cents={plan.spent} /> · nothing planned this month
        </span>
      </p>
    );
  }
  return (
    <p className={plan.status === "over" ? "plan-line over" : "plan-line"}>
      <span>
        Spent <Money cents={plan.spent} /> of{" "}
        <strong>
          <Money cents={plan.planned} />
        </strong>{" "}
        planned
      </span>
      <strong className="plan-status">
        {plan.status === "on" ? (
          "On plan"
        ) : (
          <>
            <Money cents={plan.difference} /> {plan.status}
          </>
        )}
      </strong>
    </p>
  );
}

/**
 * A Planned or Assigned amount to type over. Leaving the field or Enter saves
 * (when it changed); Escape puts the current amount back.
 */
function AmountField({
  className,
  label,
  envelopeName,
  cents,
  onSave,
}: {
  className: string;
  label: string;
  envelopeName: string;
  cents: number;
  onSave: (text: string) => Promise<boolean>;
}) {
  const current = centsToInput(cents);
  const [text, setText] = useState(current);
  // Show a new amount when the budget changes (after a save, or elsewhere).
  const [shown, setShown] = useState(current);
  if (shown !== current) {
    setShown(current);
    setText(current);
  }

  const commit = async () => {
    if (text.trim() === current) return;
    if (!(await onSave(text))) setText(current);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    } else if (event.key === "Escape") {
      // Only undo the typing; do not close the sheet.
      event.preventDefault();
      setText(current);
    }
  };

  return (
    <label className={className}>
      <span className="sheet-field-label">{label}</span>
      <input
        className="sheet-field-value"
        aria-label={`${label} amount for ${envelopeName}`}
        inputMode="decimal"
        value={text}
        onFocus={(event) => event.target.select()}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => void commit()}
      />
    </label>
  );
}

/** Saved: purple with sparkles once above $0.00, with "Move some into Remaining…". */
function SavedPanel({ saved, onMove }: { saved: number; onMove: (text: string) => Promise<void> }) {
  const [moving, setMoving] = useState(false);
  if (saved <= 0) {
    return (
      <section className="saved-panel empty" aria-label="Saved">
        <span className="saved-panel-label">Saved</span>
        <strong className="saved-panel-amount">
          <Money cents={saved} />
        </strong>
        <p>Nothing saved yet. Whatever is left at the end of a month is saved here.</p>
      </section>
    );
  }
  return (
    <section className="saved-panel" aria-label="Saved">
      <svg
        className="saved-panel-star"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d={STAR} fill="#F3D36B" />
      </svg>
      <svg
        className="saved-panel-star small"
        width="10"
        height="10"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d={STAR} fill="#B48BE0" />
      </svg>
      <span className="saved-panel-label">Saved</span>
      <strong className="saved-panel-amount">
        <Money cents={saved} />
      </strong>
      <p>Left over from earlier months. It keeps growing until you choose to use it.</p>
      {moving ? (
        <SingleFieldForm
          label="Amount to move into Remaining"
          button="Move"
          placeholder="0.00"
          onSubmit={onMove}
        />
      ) : (
        <button className="saved-panel-move" type="button" onClick={() => setMoving(true)}>
          Move some into Remaining…
        </button>
      )}
    </section>
  );
}
