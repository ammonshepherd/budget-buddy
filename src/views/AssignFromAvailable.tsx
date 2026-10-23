import { useState, type FormEvent } from "react";
import { useAsyncAction } from "../controllers/useAsyncAction";
import type { BudgetPageState as Page } from "../controllers/useBudgetPage";
import { centsToInput, formatCents } from "../models/money";
import { ErrorMessage, Money } from "./components";
import { EnvelopePicker, type PickerOption } from "./EnvelopePicker";
import { AmountInput } from "./AmountInput";

/**
 * Opened from the Available to Assign banner: add an amount to one
 * envelope's Assigned (on top of what is there). When over assigned it
 * takes money back from an envelope instead, to Available to Assign.
 */
export function AssignFromAvailable({ page, onDone }: { page: Page; onDone: () => void }) {
  const { view } = page;
  const takeBack = view.overAssigned > 0;
  const [envelopeId, setEnvelopeId] = useState("");
  const [amount, setAmount] = useState(() => (takeBack ? centsToInput(view.overAssigned) : ""));
  const save = useAsyncAction(page.assignFromAvailable);
  const options: PickerOption[] = page.assignChoices.map(({ id, name, group, row }) => ({
    value: id,
    label: name,
    group,
    detail: `has ${formatCents(row.remaining)}`,
  }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await save.run(envelopeId, amount, takeBack);
    if (result.ok) onDone();
  };

  return (
    <form className="form assign-form" onSubmit={submit} aria-label="Assign money">
      <div className="section-heading">
        <h2>{takeBack ? "Take back from an envelope" : "Assign to an envelope"}</h2>
      </div>
      <p className={takeBack ? "assign-form-note over" : "assign-form-note"}>
        {takeBack ? (
          <>
            Over Assigned by <Money cents={view.overAssigned} />. Money taken back returns to
            Available to Assign.
          </>
        ) : (
          <>
            <Money cents={view.availableToAssign} /> available. The amount is added to what the
            envelope already has assigned.
          </>
        )}
      </p>
      <EnvelopePicker
        label="Envelope"
        value={envelopeId}
        options={options}
        onChange={(id) => {
          setEnvelopeId(id);
          save.clearError();
        }}
      />
      <label className="field">
        {takeBack ? "Amount to take back" : "Amount to add"}
        <AmountInput
          value={amount}
          placeholder="0.00"
          onChange={(text) => {
            setAmount(text);
            save.clearError();
          }}
        />
      </label>
      <ErrorMessage error={save.error} />
      <div className="assign-form-actions">
        <button className="primary-button" type="submit" disabled={save.pending}>
          {takeBack ? "Take back" : "Assign"}
        </button>
        <button className="text-button" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
