import { useState, type FormEvent } from "react";
import {
  formFromTransaction,
  TRANSFER,
  useActivityPage,
  type CoverChoice,
  type CoverPlan,
  type TransactionForm,
} from "../../controllers/useActivityPage";
import { useAsyncAction } from "../../controllers/useAsyncAction";
import type { Budget } from "../../controllers/useBudget";
import { formatMonth, todayIso } from "../../models/month";
import type { BudgetData } from "../../models/types";
import { ErrorMessage, Money } from "../components";

type Page = ReturnType<typeof useActivityPage>;

export function ActivityPage({ budget, data }: { budget: Budget; data: BudgetData }) {
  const page = useActivityPage(budget, data);
  const blank = (): TransactionForm => ({
    accountId: page.openAccounts[0]?.id ?? "",
    date: todayIso(),
    direction: "outflow",
    amount: "",
    payee: "",
    memo: "",
    category: "",
  });
  const [form, setForm] = useState<TransactionForm>(blank);
  const [plan, setPlan] = useState<CoverPlan | null>(null);
  const remove = useAsyncAction(page.deleteTransaction);

  const reset = () => {
    setForm(blank());
    setPlan(null);
  };

  return (
    <section className="page-view stack" aria-labelledby="activity-title">
      <header className="page-heading">
        <p className="eyebrow">Your spending trail</p>
        <h1 id="activity-title">Activity</h1>
        <p>Review transactions and keep your budget in sync with real life.</p>
      </header>

      {page.openAccounts.length === 0 ? (
        <p className="notice">
          <a href="#accounts">Add an account</a> before entering transactions.
        </p>
      ) : plan ? (
        <CoverCard page={page} plan={plan} onDone={reset} onBack={() => setPlan(null)} />
      ) : (
        <TransactionEditor
          page={page}
          form={form}
          setForm={setForm}
          onSaved={reset}
          onNeedsCover={setPlan}
          onCancel={form.id ? reset : undefined}
        />
      )}

      <section className="list-card">
        <div className="section-heading">
          <h2>Transactions</h2>
          <span className="section-count">{page.rows.length}</span>
        </div>
        {page.rows.length === 0 ? (
          <p className="empty-state">No transactions yet.</p>
        ) : (
          <ul className="item-list">
            {page.rows.map(({ tx, accountName, category }) => (
              <li className="item" key={tx.id}>
                <span className="item-title">{tx.payee || "(no payee)"}</span>
                <strong>
                  <Money cents={tx.amount} />
                </strong>
                <span className="item-detail">
                  {tx.date} · {accountName} · {category}
                  {tx.memo && ` · ${tx.memo}`}
                </span>
                <span className="button-row">
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      setPlan(null);
                      setForm(formFromTransaction(tx));
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="text-button danger"
                    type="button"
                    disabled={remove.pending}
                    onClick={() => {
                      if (window.confirm("Delete this transaction?")) void remove.run(tx.id);
                    }}
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <ErrorMessage error={remove.error} />
      </section>
    </section>
  );
}

function TransactionEditor({
  page,
  form,
  setForm,
  onSaved,
  onNeedsCover,
  onCancel,
}: {
  page: Page;
  form: TransactionForm;
  setForm: (form: TransactionForm) => void;
  onSaved: () => void;
  onNeedsCover: (plan: CoverPlan) => void;
  onCancel?: () => void;
}) {
  const save = useAsyncAction(page.prepare);
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
    <section className="list-card">
      <div className="section-heading">
        <h2>{form.id ? "Edit transaction" : "Add a transaction"}</h2>
      </div>
      <form className="form" onSubmit={submit}>
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
            {page.groups.map((group) => (
              <optgroup key={group.id} label={group.name}>
                {group.envelopes.map((envelope) => (
                  <option key={envelope.id} value={envelope.id}>
                    {envelope.name}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value={TRANSFER}>Transfer (not spending or income)</option>
          </select>
        </label>
        <label className="field">
          Account
          <select value={form.accountId} onChange={(e) => update({ accountId: e.target.value })}>
            {page.openAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
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
        {onCancel && (
          <button className="secondary-button" type="button" onClick={onCancel}>
            Cancel editing
          </button>
        )}
        <ErrorMessage error={save.error} />
      </form>
    </section>
  );
}

function CoverCard({
  page,
  plan,
  onDone,
  onBack,
}: {
  page: Page;
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
  const cover = useAsyncAction(page.coverAndSave);
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
      {noWayToCover && (
        <p className="error-message">
          There isn’t enough money to cover this. Go back and save it as Uncategorized, or add
          income first.
        </p>
      )}
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
