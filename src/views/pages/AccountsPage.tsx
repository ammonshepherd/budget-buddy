import { useState, type FormEvent } from "react";
import { useAccountsPage } from "../../controllers/useAccountsPage";
import { useAsyncAction } from "../../controllers/useAsyncAction";
import type { Budget } from "../../controllers/useBudget";
import { todayIso } from "../../models/month";
import type { BudgetData } from "../../models/types";
import { ErrorMessage, Money } from "../components";

export function AccountsPage({ budget, data }: { budget: Budget; data: BudgetData }) {
  const page = useAccountsPage(budget, data);
  const close = useAsyncAction(page.closeAccount);

  return (
    <section className="page-view stack" aria-labelledby="accounts-title">
      <header className="page-heading">
        <p className="eyebrow">Your money sources</p>
        <h1 id="accounts-title">Accounts</h1>
        <p>See the accounts that provide money for your budget.</p>
      </header>

      <section className="list-card">
        <div className="section-heading">
          <h2>Your accounts</h2>
          <span className="section-count">{page.openAccounts.length}</span>
        </div>
        {page.openAccounts.length === 0 ? (
          <p className="empty-state">No accounts yet. Add your checking account below.</p>
        ) : (
          <ul className="item-list">
            {page.openAccounts.map((account) => (
              <li className="item" key={account.id}>
                <span className="item-title">{account.name}</span>
                <strong>
                  <Money cents={account.balance} />
                </strong>
                <span className="item-detail">Checking · opened {account.openingDate}</span>
                <button
                  className="text-button"
                  type="button"
                  disabled={close.pending}
                  onClick={() => {
                    if (window.confirm(`Close ${account.name}? Its history is kept.`)) {
                      void close.run(account.id);
                    }
                  }}
                >
                  Close
                </button>
              </li>
            ))}
          </ul>
        )}
        <ErrorMessage error={close.error} />
      </section>

      <AddAccountForm onSubmit={page.addAccount} />

      {page.closedAccounts.length > 0 && (
        <section className="list-card">
          <div className="section-heading">
            <h2>Closed accounts</h2>
            <span className="section-count">{page.closedAccounts.length}</span>
          </div>
          <ul className="item-list">
            {page.closedAccounts.map((account) => (
              <li className="item" key={account.id}>
                <span className="item-title">{account.name}</span>
                <Money cents={account.balance} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function AddAccountForm({
  onSubmit,
}: {
  onSubmit: (form: { name: string; openingBalance: string; openingDate: string }) => Promise<void>;
}) {
  const empty = { name: "", openingBalance: "", openingDate: todayIso() };
  const [form, setForm] = useState(empty);
  const action = useAsyncAction(onSubmit);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if ((await action.run(form)).ok) setForm(empty);
  };
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (event: { target: { value: string } }) => {
      setForm({ ...form, [key]: event.target.value });
      action.clearError();
    },
  });

  return (
    <section className="list-card">
      <div className="section-heading">
        <h2>Add a checking account</h2>
      </div>
      <form className="form" onSubmit={submit}>
        <label className="field">
          Account name
          <input {...field("name")} placeholder="Everyday checking" />
        </label>
        <label className="field">
          Opening balance
          <input {...field("openingBalance")} inputMode="decimal" placeholder="0.00" />
        </label>
        <label className="field">
          Opening date
          <input {...field("openingDate")} type="date" />
        </label>
        <button className="primary-button" type="submit" disabled={action.pending}>
          Add account
        </button>
        <ErrorMessage error={action.error} />
      </form>
    </section>
  );
}
