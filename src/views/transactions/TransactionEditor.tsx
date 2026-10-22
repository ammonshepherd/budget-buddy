import type { FormEvent } from "react";
import { useAsyncAction } from "../../controllers/useAsyncAction";
import {
  INCOME,
  SPLIT,
  TRANSFER,
  type CoverPlan,
  type TransactionEntryState as Entry,
  type TransactionForm,
} from "../../controllers/useTransactionEntry";
import { formatCents, type Cents } from "../../models/money";
import { MAX_SPLIT_LINES, type SplitLine } from "../../models/splits";
import { ErrorMessage, Money } from "../components";
import { EnvelopePicker, type PickerOption } from "../EnvelopePicker";

/** The transaction form itself (TransactionEntry adds the cover prompt). */
export function TransactionEditor({
  entry,
  heading,
  form,
  setForm,
  remaining,
  onSaved,
  onNeedsCover,
  onCancel,
  onDelete,
  layout,
  fixedAccount = false,
}: {
  entry: Entry;
  heading: string;
  form: TransactionForm;
  setForm: (form: TransactionForm) => void;
  /** Each envelope's Remaining in the form's month (null while the date is not valid). */
  remaining: Map<string, Cents> | null;
  onSaved: () => void;
  onNeedsCover: (plan: CoverPlan) => void;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
  layout: "stack" | "row";
  /** Adding inside an open account: show its name instead of the Account picker. */
  fixedAccount?: boolean;
}) {
  const save = useAsyncAction(entry.prepare);
  const remove = useAsyncAction(async () => onDelete?.());
  const transfer = form.category === TRANSFER;
  const cardCredit = entry.isCardCredit(form);
  const transferNote = entry.describeTransfer(form);
  const transferOptions = entry.transferOptions(form);
  const update = (change: Partial<TransactionForm>) => {
    let next = { ...form, ...change };
    if (next.category === SPLIT && form.category !== SPLIT) next = entry.startSplit(form);
    // A card credit has no envelope: drop one picked before switching to it.
    const keep = next.category === "" || next.category === TRANSFER;
    if (entry.isCardCredit(next) && !keep) next = { ...next, category: "" };
    if (next.category !== SPLIT) next = { ...next, split: [] };
    setForm(next);
    save.clearError();
  };
  const updateLine = (index: number, change: Partial<SplitLine>) =>
    update({ split: form.split.map((line, i) => (i === index ? { ...line, ...change } : line)) });
  const left = entry.leftToSplit(form);
  // Only an open account can be fixed; otherwise the picker shows.
  const fixed = fixedAccount
    ? entry.openAccounts.find((account) => account.id === form.accountId)
    : undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await save.run(form);
    if (!result.ok) return;
    if (result.value.kind === "cover") onNeedsCover(result.value.plan);
    else onSaved();
  };

  return (
    <form
      className={layout === "row" ? "form transaction-form row-layout" : "form transaction-form"}
      onSubmit={submit}
      aria-label={heading}
    >
      <div className="section-heading">
        <h2>{heading}</h2>
      </div>
      <div className="segmented field-direction" role="radiogroup" aria-label="Direction">
        {(["outflow", "inflow"] as const).map((direction) => (
          <label key={direction}>
            <input
              type="radio"
              name="direction"
              checked={form.direction === direction}
              onChange={() => update({ direction })}
            />
            {direction === "outflow" ? "Outflow" : "Inflow"}
          </label>
        ))}
      </div>
      <label className="field field-amount">
        Amount
        <input
          value={form.amount}
          inputMode="decimal"
          placeholder="0.00"
          onChange={(e) => update({ amount: e.target.value })}
        />
      </label>
      <label className="field field-payee">
        Payee
        <input value={form.payee} onChange={(e) => update({ payee: e.target.value })} />
      </label>
      <EnvelopePicker
        label="Envelope"
        className="field field-envelope"
        value={form.category}
        options={categoryChoices(entry, form, cardCredit, remaining)}
        onChange={(category) => update({ category })}
      />
      {form.category === SPLIT && (
        <fieldset className="split">
          <legend>Split</legend>
          {form.split.map((line, index) => (
            <div className="split-line" key={index}>
              <EnvelopePicker
                label={`Envelope ${index + 1}`}
                hideLabel
                className="split-envelope"
                placeholder="Choose an envelope"
                value={line.envelopeId}
                options={envelopeChoices(entry, remaining)}
                onChange={(envelopeId) => updateLine(index, { envelopeId })}
              />
              <input
                aria-label={`Amount ${index + 1}`}
                value={line.amount}
                inputMode="decimal"
                placeholder="0.00"
                onChange={(e) => updateLine(index, { amount: e.target.value })}
              />
              <button
                className="text-button split-remove"
                type="button"
                aria-label={`Remove line ${index + 1}`}
                title="Remove line"
                disabled={form.split.length <= 2}
                onClick={() => update({ split: form.split.filter((_, i) => i !== index) })}
              >
                ×
              </button>
            </div>
          ))}
          <div className="split-footer">
            <button
              className="text-button"
              type="button"
              disabled={form.split.length >= MAX_SPLIT_LINES}
              onClick={() => update({ split: [...form.split, { envelopeId: "", amount: "" }] })}
            >
              + Add line
            </button>
            <span role="status" className={left === 0 ? "split-done" : "split-left"}>
              {left > 0 ? (
                <>
                  <Money cents={left} /> left to split
                </>
              ) : left < 0 ? (
                <>
                  <Money cents={-left} /> too much
                </>
              ) : (
                "Adds up"
              )}
            </span>
          </div>
          {left > 0 && (
            <button
              className="text-button"
              type="button"
              onClick={() => update({ split: entry.fillRest(form, form.split.length - 1) })}
            >
              Put the rest in the last line
            </button>
          )}
        </fieldset>
      )}
      {fixed ? (
        <p className="field field-account fixed-account">
          Account <strong>{fixed.name}</strong>
        </p>
      ) : (
        <label className="field field-account">
          Account
          <select value={form.accountId} onChange={(e) => update({ accountId: e.target.value })}>
            {entry.openAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {transfer && (
        <>
          <label className="field field-transfer">
            {form.direction === "outflow" ? "To account" : "From account"}
            <select
              value={entry.transferAccountOf(form)}
              onChange={(e) => update({ transferAccountId: e.target.value })}
            >
              {entry.otherAccounts(form.accountId).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          {transferOptions && (
            <label className="field field-transfer">
              Other side
              <select
                value={transferOptions.selected}
                onChange={(e) => update({ transferMatch: e.target.value })}
              >
                {transferOptions.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {transferNote && (
            <p className="empty-state field-note" role="note">
              {transferNote}
            </p>
          )}
        </>
      )}
      <label className="field field-date">
        Date
        <input type="date" value={form.date} onChange={(e) => update({ date: e.target.value })} />
      </label>
      <label className="field field-memo">
        Memo
        <input value={form.memo} onChange={(e) => update({ memo: e.target.value })} />
      </label>
      {/* A box only in the row layout; otherwise the buttons stack like fields. */}
      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={save.pending}>
          {form.id ? "Save changes" : "Save"}
        </button>
        <button className="secondary-button" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {onDelete && (
        <button
          className="text-button danger sheet-delete"
          type="button"
          disabled={remove.pending}
          onClick={() => {
            const question = entry.isTransfer(form)
              ? "Delete this transfer? Its other side goes too (an imported bank row is kept, as Uncategorized)."
              : "Delete this transaction?";
            if (window.confirm(question)) void remove.run();
          }}
        >
          {entry.isTransfer(form) ? "Delete transfer" : "Delete transaction"}
        </button>
      )}
      <ErrorMessage error={save.error} />
      <ErrorMessage error={remove.error} />
    </form>
  );
}

/** Every envelope, by group, with what it has this month (when the date is valid). */
function envelopeChoices(entry: Entry, remaining: Map<string, Cents> | null): PickerOption[] {
  return entry.groups.flatMap((group) =>
    group.envelopes.map((envelope) => {
      const left = remaining?.get(envelope.id);
      return {
        value: envelope.id,
        label: envelope.name,
        group: group.name,
        detail: left === undefined ? undefined : `has ${formatCents(left)}`,
      };
    }),
  );
}

/** The form's Envelope choices: the fixed ones first, then every envelope. */
function categoryChoices(
  entry: Entry,
  form: TransactionForm,
  cardCredit: boolean,
  remaining: Map<string, Cents> | null,
): PickerOption[] {
  const transfer = {
    value: TRANSFER,
    label: "Transfer (not spending or income)",
    disabled: entry.openAccounts.length < 2,
  };
  // Money into a card only lowers what is owed (or is a payment).
  if (cardCredit) return [{ value: "", label: "Card credit (lowers what you owe)" }, transfer];
  return [
    { value: "", label: "Uncategorized" },
    {
      value: INCOME,
      label: "Income (to Available to Assign)",
      disabled: form.direction === "outflow",
    },
    { value: SPLIT, label: "Split across envelopes" },
    transfer,
    ...envelopeChoices(entry, remaining),
  ];
}
