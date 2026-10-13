import { useState, type FormEvent } from "react";
import { useAccountsPage, type AccountForm as Fields } from "../../controllers/useAccountsPage";
import { useAsyncAction } from "../../controllers/useAsyncAction";
import type { Budget } from "../../controllers/useBudget";
import { ACCOUNT_TYPE_NAMES } from "../../models/accounts";
import { todayIso } from "../../models/month";
import type { AccountType, BudgetData } from "../../models/types";
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
                      type: account.type,
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
          heading="Add an account"
          button="Add account"
          initial={{ type: "checking", name: "", openingBalance: "", openingDate: todayIso() }}
          chooseType
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
        {ACCOUNT_TYPE_NAMES[account.type]} · opened {account.openingDate}{" "}
        {account.type === "credit_card" ? (
          <>
            owing <Money cents={-account.openingBalance} />
          </>
        ) : (
          <>
            with <Money cents={account.openingBalance} />
          </>
        )}
      </span>
    </>
  );
}

/**
 * Name, opening balance and opening date; used to add and to edit an account.
 * The type is chosen only when adding (chooseType).
 */
function AccountForm({
  heading,
  button,
  initial,
  chooseType = false,
  resetAfterSubmit = false,
  onSubmit,
  onCancel,
}: {
  heading: string;
  button: string;
  initial: Fields;
  chooseType?: boolean;
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
  const card = form.type === "credit_card";
  const field = (key: "name" | "openingBalance" | "openingDate") => ({
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
      {chooseType && (
        <div className="segmented" role="radiogroup" aria-label="Account type">
          {(Object.keys(ACCOUNT_TYPE_NAMES) as AccountType[]).map((type) => (
            <label key={type}>
              <input
                type="radio"
                name="account-type"
                checked={form.type === type}
                onChange={() => {
                  setForm({ ...form, type });
                  action.clearError();
                }}
              />
              {ACCOUNT_TYPE_NAMES[type]}
            </label>
          ))}
        </div>
      )}
      <label className="field">
        Account name
        <input {...field("name")} placeholder={card ? "Visa card" : "Everyday checking"} />
      </label>
      <label className="field">
        {card ? "Amount owed on the opening date" : "Opening balance"}
        <input {...field("openingBalance")} inputMode="decimal" placeholder="0.00" />
      </label>
      {card && (
        <p className="empty-state">
          The card gets a payment envelope on the Budget page. Purchases move money into it from
          their envelopes, and what is owed today shows there as Uncovered until you assign money to
          pay it down. Record a card payment as a Transfer in both the paying account and the card.
        </p>
      )}
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
