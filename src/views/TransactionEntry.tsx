import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAsyncAction } from "../controllers/useAsyncAction";
import type { Budget } from "../controllers/useBudget";
import {
  blankTransactionForm,
  INCOME,
  TRANSFER,
  useTransactionEntry,
  type CoverChoice,
  type CoverPlan,
  type TransactionForm,
} from "../controllers/useTransactionEntry";
import { formatMonth } from "../models/month";
import type { BudgetData } from "../models/types";
import { ErrorMessage, Money } from "./components";
import { PlusIcon } from "./icons";

type Entry = ReturnType<typeof useTransactionEntry>;

/**
 * The transaction form, then the cover prompt if its envelope would go
 * negative. Used by the Add transaction dialog and for editing on Activity.
 */
export function TransactionEntry({
  budget,
  data,
  initial,
  heading,
  onDone,
  onCancel,
}: {
  budget: Budget;
  data: BudgetData;
  initial: TransactionForm;
  heading: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const entry = useTransactionEntry(budget, data);
  const [form, setForm] = useState(initial);
  const [plan, setPlan] = useState<CoverPlan | null>(null);

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
    <CoverCard entry={entry} plan={plan} onDone={onDone} onBack={() => setPlan(null)} />
  ) : (
    <TransactionEditor
      entry={entry}
      heading={heading}
      form={form}
      setForm={setForm}
      onSaved={onDone}
      onNeedsCover={setPlan}
      onCancel={onCancel}
    />
  );
}

/**
 * The round + button in the bottom-right corner (Budget, Accounts and
 * Activity). It opens the transaction form in a modal dialog.
 */
export function AddTransactionButton({ budget, data }: { budget: Budget; data: BudgetData }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  // A <dialog> opens with showModal(), which React has no prop for.
  useEffect(() => {
    const element = dialog.current;
    if (open && !element?.open) element?.showModal();
    if (!open && element?.open) element.close();
  }, [open]);

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
      <dialog
        ref={dialog}
        className="sheet"
        aria-label="Add a transaction"
        // Escape closes the dialog itself; keep React's state in step.
        onClose={() => setOpen(false)}
      >
        {open && (
          <TransactionEntry
            budget={budget}
            data={data}
            initial={blankTransactionForm(data)}
            heading="Add a transaction"
            onDone={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        )}
      </dialog>
    </>
  );
}

function TransactionEditor({
  entry,
  heading,
  form,
  setForm,
  onSaved,
  onNeedsCover,
  onCancel,
}: {
  entry: Entry;
  heading: string;
  form: TransactionForm;
  setForm: (form: TransactionForm) => void;
  onSaved: () => void;
  onNeedsCover: (plan: CoverPlan) => void;
  onCancel: () => void;
}) {
  const save = useAsyncAction(entry.prepare);
  const transfer = form.category === TRANSFER;
  const transferNote = entry.describeTransfer(form);
  const transferOptions = entry.transferOptions(form);
  const update = (change: Partial<TransactionForm>) => {
    setForm({ ...form, ...change });
    save.clearError();
  };

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
          <option value="">Uncategorized</option>
          <option value={INCOME} disabled={form.direction === "outflow"}>
            Income (to Available to Assign)
          </option>
          {entry.groups.map((group) => (
            <optgroup key={group.id} label={group.name}>
              {group.envelopes.map((envelope) => (
                <option key={envelope.id} value={envelope.id}>
                  {envelope.name}
                </option>
              ))}
            </optgroup>
          ))}
          <option value={TRANSFER} disabled={entry.openAccounts.length < 2}>
            Transfer (not spending or income)
          </option>
        </select>
      </label>
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
      <ErrorMessage error={save.error} />
    </form>
  );
}

function CoverCard({
  entry,
  plan,
  onDone,
  onBack,
}: {
  entry: Entry;
  plan: CoverPlan;
  onDone: () => void;
  onBack: () => void;
}) {
  const [choice, setChoice] = useState<CoverChoice>(() =>
    plan.stillShort === 0
      ? null
      : plan.sources[0]
        ? { fromEnvelopeId: plan.sources[0].id }
        : plan.canUseAvailable
          ? "available"
          : null,
  );
  const cover = useAsyncAction(entry.coverAndSave);
  const noWayToCover = plan.stillShort > 0 && plan.sources.length === 0 && !plan.canUseAvailable;
  const chosen = (id: string) => typeof choice === "object" && choice?.fromEnvelopeId === id;

  return (
    <section className="cover-card" aria-labelledby="cover-title" role="alertdialog">
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
        {plan.stillShort > 0 && (
          <li>
            Then cover <Money cents={plan.stillShort} /> from:
            {plan.sources.map((source) => (
              <label className="choice" key={source.id}>
                <input
                  type="radio"
                  name="cover"
                  checked={chosen(source.id)}
                  onChange={() => setChoice({ fromEnvelopeId: source.id })}
                />
                {source.name} (has <Money cents={source.remaining} />)
              </label>
            ))}
            <label className="choice">
              <input
                type="radio"
                name="cover"
                disabled={!plan.canUseAvailable}
                checked={choice === "available"}
                onChange={() => setChoice("available")}
              />
              Available to Assign (<Money cents={plan.available} /> free)
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
            if ((await cover.run(plan, choice)).ok) onDone();
          }}
        >
          Cover and save
        </button>
        <button className="secondary-button" type="button" onClick={onBack}>
          Back
        </button>
      </div>
      <ErrorMessage error={cover.error} />
    </section>
  );
}
