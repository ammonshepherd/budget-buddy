import { useState, type FormEvent } from "react";
import { useAsyncAction } from "../controllers/useAsyncAction";
import { TO_AVAILABLE, type useBudgetPage } from "../controllers/useBudgetPage";
import type { EnvelopeRow } from "../models/budgetMath";
import { centsToInput, formatCents } from "../models/money";
import { ErrorMessage, Money } from "./components";
import { EnvelopePicker, type PickerOption } from "./EnvelopePicker";

type Page = ReturnType<typeof useBudgetPage>;

/**
 * Opened by tapping what is left in an envelope row: moves some of it to
 * another envelope, or back to Available to Assign. The envelope's
 * Assigned goes down by the amount and the other envelope's goes up.
 */
export function MoveFromEnvelope({
  page,
  from,
  onDone,
}: {
  page: Page;
  from: EnvelopeRow;
  onDone: () => void;
}) {
  const most = page.movable(from.id);
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState(() => centsToInput(most));
  const save = useAsyncAction(page.moveFromEnvelope);
  const options: PickerOption[] = [
    {
      value: TO_AVAILABLE,
      label: "Available to Assign",
      detail: `has ${formatCents(Math.max(0, page.view.availableToAssign))}`,
    },
    ...page.moveChoices(from.id).map(({ id, name, group, row }) => ({
      value: id,
      label: name,
      group,
      detail: `has ${formatCents(row.card ? row.envelopeMoney : row.remaining)}`,
    })),
  ];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await save.run(from.id, toId, amount);
    if (result.ok) onDone();
  };

  return (
    <form className="form assign-form" onSubmit={submit} aria-label="Move money">
      <div className="section-heading">
        <h2>Move from {from.name}</h2>
      </div>
      <p className="assign-form-note">
        <Money cents={most} /> can be moved
        {most < from.remaining && <> (money released from Saved stays in {from.name})</>}. Its
        Assigned goes down by the amount.
      </p>
      <EnvelopePicker
        label="Move to"
        value={toId}
        options={options}
        onChange={(id) => {
          setToId(id);
          save.clearError();
        }}
      />
      <label className="field">
        Amount to move
        <input
          value={amount}
          inputMode="decimal"
          placeholder="0.00"
          onChange={(event) => {
            setAmount(event.target.value);
            save.clearError();
          }}
        />
      </label>
      <ErrorMessage error={save.error} />
      <div className="assign-form-actions">
        <button className="primary-button" type="submit" disabled={save.pending}>
          Move
        </button>
        <button className="text-button" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
