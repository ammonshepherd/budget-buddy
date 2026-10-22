import { useState } from "react";
import { useAsyncAction } from "../../controllers/useAsyncAction";
import {
  type CoverChoice,
  type CoverPlan,
  type TransactionEntryState as Entry,
} from "../../controllers/useTransactionEntry";
import { formatCents } from "../../models/money";
import { formatMonth } from "../../models/month";
import { ErrorMessage, Money } from "../components";
import { EnvelopePicker } from "../EnvelopePicker";

/** The CoverChoice a "Cover from" option stands for. */
const AVAILABLE = "available";

/**
 * The cover prompt: the transaction would leave its envelope short, so
 * release Saved, then move from another envelope or Available to Assign.
 */
export function CoverCard({
  entry,
  plan,
  onNext,
  onDone,
  onBack,
}: {
  entry: Entry;
  plan: CoverPlan;
  /** A split with another short envelope: show its prompt. */
  onNext: (plan: CoverPlan) => void;
  onDone: () => void;
  onBack: () => void;
}) {
  const [choice, setChoice] = useState<CoverChoice>(() =>
    plan.stillShort === 0
      ? null
      : plan.sources[0]
        ? { fromEnvelopeId: plan.sources[0].id }
        : plan.canUseAvailable
          ? AVAILABLE
          : null,
  );
  const cover = useAsyncAction(entry.coverAndSave);
  const noWayToCover = plan.stillShort > 0 && plan.sources.length === 0 && !plan.canUseAvailable;
  const step = plan.covered.length + 1;
  const steps = step + plan.moreShort;

  return (
    <section className="cover-card" aria-labelledby="cover-title" role="alertdialog">
      {steps > 1 && (
        <p className="cover-step">
          Envelope {step} of {steps} to cover
        </p>
      )}
      <h3 id="cover-title">
        {plan.envelopeName} would be <Money cents={plan.shortfall} /> short in{" "}
        {formatMonth(plan.month)}
      </h3>
      <p className="empty-state">Envelopes can’t go negative. Cover the difference:</p>
      <ol>
        {plan.fromSaved > 0 && (
          <li>
            Release <Money cents={plan.fromSaved} /> from {plan.envelopeName}’s Saved.
          </li>
        )}
        {plan.stillShort > 0 && !noWayToCover && (
          <li>
            <EnvelopePicker
              label={`${plan.fromSaved > 0 ? "Then cover" : "Cover"} ${formatCents(plan.stillShort)} from`}
              value={choice === AVAILABLE ? AVAILABLE : (choice?.fromEnvelopeId ?? "")}
              options={[
                ...plan.sources.map((source) => ({
                  value: source.id,
                  label: source.name,
                  detail: `has ${formatCents(source.remaining)}`,
                })),
                {
                  value: AVAILABLE,
                  label: "Available to Assign",
                  detail: `${formatCents(plan.available)} free`,
                  disabled: !plan.canUseAvailable,
                },
              ]}
              onChange={(value) =>
                setChoice(value === AVAILABLE ? AVAILABLE : { fromEnvelopeId: value })
              }
            />
          </li>
        )}
      </ol>
      {noWayToCover &&
        (plan.isCardPayment ? (
          // Saving a payment as Uncategorized would hide the cash it spent.
          <p className="error-message">
            There isn’t enough money to cover this payment yet. Assign more to {plan.envelopeName}{" "}
            or add income first, then record the payment.
          </p>
        ) : (
          <p className="error-message">
            There isn’t enough money to cover this. Go back and save it as Uncategorized, or add
            income first.
          </p>
        ))}
      <div className="button-row">
        <button
          className="primary-button"
          type="button"
          disabled={cover.pending || noWayToCover}
          onClick={async () => {
            const result = await cover.run(plan, choice);
            if (!result.ok) return;
            if (result.value.kind === "cover") onNext(result.value.plan);
            else onDone();
          }}
        >
          {plan.moreShort > 0 ? "Cover and continue" : "Cover and save"}
        </button>
        <button className="secondary-button" type="button" onClick={onBack}>
          Back
        </button>
      </div>
      <ErrorMessage error={cover.error} />
    </section>
  );
}
