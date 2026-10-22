import { useState } from "react";
import { messageOf } from "../../controllers/errors";
import type { BudgetPageState as Page } from "../../controllers/useBudgetPage";
import { envelopeLeft, type EnvelopeRow } from "../../models/budgetMath";
import { formatCents, formatSignedCents } from "../../models/money";
import { PadAmount } from "../AssignPad";
import { ErrorMessage, Money } from "../components";
import { EnvelopeIcon } from "../icons";
import { EditableCell } from "./EditableCell";
import { SavedChip } from "./SavedChip";

/**
 * One envelope: name, Saved and what is left; then Planned (tap to edit in
 * place), Assigned (tap for the number pad) and Spent. Tapping the top line opens its sheet.
 * On a desktop it is one table row (name and Saved, Planned, Assigned,
 * Spent, Remaining) and the name shows the envelope in the panel.
 * Tapping what is left opens the move dialog (when some can be moved).
 */
export function EnvelopeItem({
  envelope,
  page,
  onOpen,
  onMove,
  desktop,
  selected,
}: {
  envelope: EnvelopeRow;
  page: Page;
  onOpen: () => void;
  onMove: () => void;
  desktop: boolean;
  selected: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const card = envelope.card;
  const left = envelopeLeft(envelope);

  const save = (action: (id: string, text: string) => Promise<void>) => async (text: string) => {
    setError(null);
    try {
      await action(envelope.id, text);
    } catch (e) {
      setError(messageOf(e));
    }
  };

  const leftClass = left === 0 ? "envelope-left zero" : "envelope-left";
  const leftContent = (
    <>
      <span className="envelope-remaining">
        <Money cents={left} />
      </span>
      <span className="visually-hidden">{card ? " available to pay" : " remaining"}</span>
    </>
  );
  // A button when some can be moved out (not a card's envelope, not a past month).
  const leftAmount =
    page.movable(envelope.id) > 0 ? (
      <button
        className={`${leftClass} movable`}
        type="button"
        aria-haspopup="dialog"
        aria-label={`Move money from ${envelope.name}: ${formatCents(left)} remaining`}
        onClick={onMove}
      >
        {leftContent}
      </button>
    ) : (
      <span className={leftClass}>{leftContent}</span>
    );
  const classes = ["envelope", envelope.inUse ? "" : "unused", selected ? "selected" : ""];

  return (
    <div className={classes.join(" ").trim()}>
      <div className="envelope-head">
        <button
          className="envelope-top"
          type="button"
          aria-haspopup={desktop ? undefined : "dialog"}
          aria-expanded={desktop ? selected : undefined}
          onClick={onOpen}
        >
          <EnvelopeIcon />
          <span className="envelope-title">
            <span className="envelope-name">
              {envelope.name}
              {!envelope.inUse && <small> · not used this month</small>}
            </span>
            {!card && <SavedChip cents={envelope.saved} />}
          </span>
        </button>
        {/* On a desktop, what is left is the row's last column instead. */}
        {!desktop && leftAmount}
      </div>

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
          {desktop ? (
            // Typed in place; "+50" or "120 + 50" adds to what is there.
            <EditableCell
              className="cell assigned"
              label="Assigned"
              what="assigned"
              envelopeName={envelope.name}
              cents={envelope.assigned}
              onSave={save(page.setAssigned)}
            />
          ) : (
            // A phone: the number pad, with + and − to add to or take from it.
            <PadAmount
              className="cell assigned"
              labelClassName="cell-label"
              label="Assigned"
              envelopeName={envelope.name}
              cents={envelope.assigned}
              onSave={(text) => page.setAssigned(envelope.id, text)}
            />
          )}
          <span className={envelope.overPlan ? "cell spent over" : "cell spent"}>
            {/* Orange when over Planned; screen readers hear it in words. */}
            <span className="cell-label">
              Spent{envelope.overPlan && <span className="visually-hidden"> (over Planned)</span>}
            </span>{" "}
            {/* Money out of the envelope, so shown with a minus (not red). */}
            <span className="money">{formatSignedCents(-envelope.outflow)}</span>
          </span>
        </div>
      )}
      {desktop && leftAmount}

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
