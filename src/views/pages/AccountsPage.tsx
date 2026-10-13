import { useState, type FormEvent } from "react";
import { useAccountsPage, type AccountForm as Fields } from "../../controllers/useAccountsPage";
import { useAsyncAction } from "../../controllers/useAsyncAction";
import type { Budget } from "../../controllers/useBudget";
import { todayIso } from "../../models/month";
import type { BudgetData } from "../../models/types";
import { ErrorMessage, Money } from "../components";

type Page = ReturnType<typeof useAccountsPage>;
type AccountRow = Page["openAccounts"][number];

export function AccountsPage({ budget, data }: { budget: Budget; data: BudgetData }) {
  const page = useAccountsPage(budget, data);
  const close = useAsyncAction(page.closeAccount);
  const [editingId, setEditingId] = useState<string | null>(null);

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
            {page.openAccounts.map((account) =>
              account.id === editingId ? (
                <li key={account.id}>
                  <AccountForm
                    heading={`Edit ${account.name}`}
                    button="Save changes"
                    initial={{
                      name: account.name,
                      openingBalance: account.openingBalanceInput,
                      openingDate: account.openingDate,
                    }}
                    onSubmit={async (form) => {
                      await page.updateAccount(account.id, form);
                      setEditingId(null);
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                </li>
              ) : (
                <li className="item" key={account.id}>
                  <AccountSummary account={account} />
                  <span className="button-row">
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => setEditingId(account.id)}
                    >
                      Edit
                    </button>
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
                  </span>
                </li>
              ),
            )}
          </ul>
        )}
        <ErrorMessage error={close.error} />
      </section>

      <section className="list-card">
        <AccountForm
          heading="Add a checking account"
          button="Add account"
          initial={{ name: "", openingBalance: "", openingDate: todayIso() }}
          resetAfterSubmit
          onSubmit={page.addAccount}
        />
      </section>

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

function AccountSummary({ account }: { account: AccountRow }) {
  return (
    <>
      <span className="item-title">{account.name}</span>
      <strong>
        <Money cents={account.balance} />
      </strong>
      <span className="item-detail">
        Checking · opened {account.openingDate} with <Money cents={account.openingBalance} />
      </span>
    </>
  );
}

/** Name, opening balance and opening date; used to add and to edit an account. */
function AccountForm({
  heading,
  button,
  initial,
  resetAfterSubmit = false,
  onSubmit,
  onCancel,
}: {
  heading: string;
  button: string;
  initial: Fields;
  resetAfterSubmit?: boolean;
  onSubmit: (form: Fields) => Promise<void>;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState(initial);
  const action = useAsyncAction(onSubmit);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if ((await action.run(form)).ok && resetAfterSubmit) setForm(initial);
  };
  const field = (key: keyof Fields) => ({
    value: form[key],
    onChange: (event: { target: { value: string } }) => {
      setForm({ ...form, [key]: event.target.value });
      action.clearError();
    },
  });

  return (
    <form className="form" onSubmit={submit} aria-label={heading}>
      <div className="section-heading">
        <h2>{heading}</h2>
      </div>
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
        {button}
      </button>
      {onCancel && (
        <button className="secondary-button" type="button" onClick={onCancel}>
          Cancel
        </button>
      )}
      <ErrorMessage error={action.error} />
    </form>
  );
}
