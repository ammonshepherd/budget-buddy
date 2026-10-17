import { useState, type FormEvent } from "react";
import { useAsyncAction } from "../controllers/useAsyncAction";
import type { Budget } from "../controllers/useBudget";
import {
  blankTransactionForm,
  INCOME,
  SPLIT,
  TRANSFER,
  useEnvelopeRemaining,
  useTransactionEntry,
  type CoverChoice,
  type CoverPlan,
  type TransactionForm,
} from "../controllers/useTransactionEntry";
import { formatCents, type Cents } from "../models/money";
import { formatMonth } from "../models/month";
import { MAX_SPLIT_LINES, type SplitLine } from "../models/splits";
import type { BudgetData } from "../models/types";
import { ErrorMessage, Money, Sheet } from "./components";
import { PlusIcon } from "./icons";

type Entry = ReturnType<typeof useTransactionEntry>;

/**
 * The transaction form, then the cover prompt if its envelope would go
 * negative. Shown in TransactionDialog, for adding and for editing.
 */
export function TransactionEntry({
  budget,
  data,
  initial,
  heading,
  onDone,
  onCancel,
  onDelete,
}: {
  budget: Budget;
  data: BudgetData;
  initial: TransactionForm;
  heading: string;
  onDone: () => void;
  onCancel: () => void;
  /** Set when editing: shows a Delete button. */
  onDelete?: () => Promise<void>;
}) {
  const entry = useTransactionEntry(budget, data);
  const [form, setForm] = useState(initial);
  const [plan, setPlan] = useState<CoverPlan | null>(null);
  const remaining = useEnvelopeRemaining(data, form.date);

  if (entry.openAccounts.length === 0) {
    return (
      <p className="notice">
        <a href="#accounts" onClick={onCancel}>
          Add an account
        </a>{" "}
        before entering transactions.
      </p>
    );
  }
  return plan ? (
    <CoverCard
      // A new card per short envelope, so its choice starts fresh.
      key={plan.envelopeId}
      entry={entry}
      plan={plan}
      onNext={setPlan}
      onDone={onDone}
      onBack={() => setPlan(null)}
    />
  ) : (
    <TransactionEditor
      entry={entry}
      heading={heading}
      form={form}
      setForm={setForm}
      remaining={remaining}
      onSaved={onDone}
      onNeedsCover={setPlan}
      onCancel={onCancel}
      onDelete={onDelete}
    />
  );
}

/**
 * A modal dialog holding TransactionEntry. `open` is controlled by the
 * caller; Escape, Cancel, saving and deleting all call onClose.
 */
export function TransactionDialog({
  budget,
  data,
  open,
  heading,
  initial,
  onClose,
  onDelete,
}: {
  budget: Budget;
  data: BudgetData;
  open: boolean;
  heading: string;
  initial: () => TransactionForm;
  onClose: () => void;
  onDelete?: () => Promise<void>;
}) {
  return (
    <Sheet open={open} label={heading} onClose={onClose}>
      {() => (
        <TransactionEntry
          budget={budget}
          data={data}
          initial={initial()}
          heading={heading}
          onDone={onClose}
          onCancel={onClose}
          onDelete={
            onDelete &&
            (async () => {
              await onDelete();
              onClose();
            })
          }
        />
      )}
    </Sheet>
  );
}

/**
 * The round + button in the bottom-right corner (Budget, Accounts and
 * Activity). It opens the transaction form in a modal dialog.
 */
export function AddTransactionButton({ budget, data }: { budget: Budget; data: BudgetData }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="fab"
        type="button"
        aria-label="Add transaction"
        title="Add transaction"
        onClick={() => setOpen(true)}
      >
        <PlusIcon />
      </button>
      <TransactionDialog
        budget={budget}
        data={data}
        open={open}
        heading="Add a transaction"
        initial={() => blankTransactionForm(data)}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function TransactionEditor({
  entry,
  heading,
  form,
  setForm,
  remaining,
  onSaved,
  onNeedsCover,
  onCancel,
  onDelete,
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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await save.run(form);
    if (!result.ok) return;
    if (result.value.kind === "cover") onNeedsCover(result.value.plan);
    else onSaved();
  };

  return (
    <form className="form" onSubmit={submit} aria-label={heading}>
      <div className="section-heading">
        <h2>{heading}</h2>
      </div>
      <div className="segmented" role="radiogroup" aria-label="Direction">
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
      <label className="field">
        Amount
        <input
          value={form.amount}
          inputMode="decimal"
          placeholder="0.00"
          onChange={(e) => update({ amount: e.target.value })}
        />
      </label>
      <label className="field">
        Payee
        <input value={form.payee} onChange={(e) => update({ payee: e.target.value })} />
      </label>
      <label className="field">
        Envelope
        <select value={form.category} onChange={(e) => update({ category: e.target.value })}>
          {cardCredit ? (
            // Money into a card only lowers what is owed (or is a payment).
            <option value="">Card credit (lowers what you owe)</option>
          ) : (
            <>
              <option value="">Uncategorized</option>
              <option value={INCOME} disabled={form.direction === "outflow"}>
                Income (to Available to Assign)
              </option>
              <EnvelopeOptions entry={entry} remaining={remaining} />
              <option value={SPLIT}>Split across envelopes</option>
            </>
          )}
          <option value={TRANSFER} disabled={entry.openAccounts.length < 2}>
            Transfer (not spending or income)
          </option>
        </select>
      </label>
      {form.category === SPLIT && (
        <fieldset className="split">
          <legend>Split</legend>
          {form.split.map((line, index) => (
            <div className="split-line" key={index}>
              <select
                aria-label={`Envelope ${index + 1}`}
                value={line.envelopeId}
                onChange={(e) => updateLine(index, { envelopeId: e.target.value })}
              >
                <option value="">Choose an envelope</option>
                <EnvelopeOptions entry={entry} remaining={remaining} />
              </select>
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
      <label className="field">
        Account
        <select value={form.accountId} onChange={(e) => update({ accountId: e.target.value })}>
          {entry.openAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>
      {transfer && (
        <>
          <label className="field">
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
            <label className="field">
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
            <p className="empty-state" role="note">
              {transferNote}
            </p>
          )}
        </>
      )}
      <label className="field">
        Date
        <input type="date" value={form.date} onChange={(e) => update({ date: e.target.value })} />
      </label>
      <label className="field">
        Memo
        <input value={form.memo} onChange={(e) => update({ memo: e.target.value })} />
      </label>
      <button className="primary-button" type="submit" disabled={save.pending}>
        {form.id ? "Save changes" : "Add transaction"}
      </button>
      <button className="secondary-button" type="button" onClick={onCancel}>
        Cancel
      </button>
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

/**
 * The envelopes a transaction can go in, under their groups, each with what
 * it has Remaining in the transaction's month.
 */
function EnvelopeOptions({
  entry,
  remaining,
}: {
  entry: Entry;
  remaining: Map<string, Cents> | null;
}) {
  return entry.groups.map((group) => (
    <optgroup key={group.id} label={group.name}>
      {group.envelopes.map((envelope) => {
        const left = remaining?.get(envelope.id);
        return (
          <option key={envelope.id} value={envelope.id}>
            {left === undefined ? envelope.name : `${envelope.name} (has ${formatCents(left)})`}
          </option>
        );
      })}
    </optgroup>
  ));
}

/** The CoverChoice a "Cover from" option stands for. */
const AVAILABLE = "available";

function CoverCard({
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
            <label className="field">
              <span>
                {plan.fromSaved > 0 ? "Then cover" : "Cover"} <Money cents={plan.stillShort} /> from
              </span>
              <select
                value={choice === AVAILABLE ? AVAILABLE : (choice?.fromEnvelopeId ?? "")}
                onChange={(e) =>
                  setChoice(
                    e.target.value === AVAILABLE ? AVAILABLE : { fromEnvelopeId: e.target.value },
                  )
                }
              >
                {plan.sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name} (has {formatCents(source.remaining)})
                  </option>
                ))}
                <option value={AVAILABLE} disabled={!plan.canUseAvailable}>
                  Available to Assign ({formatCents(plan.available)} free)
                </option>
              </select>
            </label>
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
