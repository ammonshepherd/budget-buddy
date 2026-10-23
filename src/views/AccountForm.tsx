import { useState, type FormEvent, type ReactNode } from "react";
import type { useAccountsPage, AccountForm as Fields } from "../controllers/useAccountsPage";
import { useAsyncAction } from "../controllers/useAsyncAction";
import { ACCOUNT_KIND_NAMES, type AccountKind } from "../models/accounts";
import { todayIso } from "../models/month";
import { ErrorMessage } from "./components";
import { AmountInput } from "./AmountInput";

type Page = ReturnType<typeof useAccountsPage>;
export type AccountRow = Page["openAccounts"][number];

/** "Add an account": the form, empty again after each account added. */
export function AddAccount({ page, onDone }: { page: Page; onDone?: () => void }) {
  return (
    <AccountForm
      heading="Add an account"
      button="Add account"
      initial={{ kind: "checking", name: "", openingBalance: "", openingDate: todayIso() }}
      chooseType
      resetAfterSubmit
      onSubmit={async (form) => {
        await page.addAccount(form);
        onDone?.();
      }}
      onCancel={onDone}
    />
  );
}

/**
 * The edit form (in a sheet, or the desktop panel), with Close account at
 * the bottom. `onClosed` runs once the account is closed.
 */
export function EditAccount({
  account,
  page,
  onDone,
  onClosed = onDone,
}: {
  account: AccountRow;
  page: Page;
  onDone: () => void;
  onClosed?: () => void;
}) {
  const close = useAsyncAction(async () => {
    await page.closeAccount(account.id);
    onClosed();
  });

  return (
    <AccountForm
      heading={`Edit ${account.name}`}
      button="Save changes"
      initial={{
        kind: account.kind,
        name: account.name,
        openingBalance: account.openingBalanceInput,
        openingDate: account.openingDate,
      }}
      onSubmit={async (form) => {
        await page.updateAccount(account.id, form);
        onDone();
      }}
      onCancel={onDone}
    >
      <button
        className="text-button danger sheet-delete"
        type="button"
        disabled={close.pending}
        onClick={() => {
          if (window.confirm(`Close ${account.name}? Its history is kept.`)) void close.run();
        }}
      >
        Close account
      </button>
      <ErrorMessage error={close.error} />
    </AccountForm>
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
  children,
}: {
  heading: string;
  button: string;
  initial: Fields;
  chooseType?: boolean;
  resetAfterSubmit?: boolean;
  onSubmit: (form: Fields) => Promise<void>;
  onCancel?: () => void;
  /** Extra controls under the buttons (the edit sheet's Close account). */
  children?: ReactNode;
}) {
  const [form, setForm] = useState(initial);
  const action = useAsyncAction(onSubmit);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if ((await action.run(form)).ok && resetAfterSubmit) setForm(initial);
  };
  const card = form.kind === "credit_card";
  const tracking = form.kind === "tracking";
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
          {(Object.keys(ACCOUNT_KIND_NAMES) as AccountKind[]).map((kind) => (
            <label key={kind}>
              <input
                type="radio"
                name="account-type"
                checked={form.kind === kind}
                onChange={() => {
                  setForm({ ...form, kind });
                  action.clearError();
                }}
              />
              {ACCOUNT_KIND_NAMES[kind]}
            </label>
          ))}
        </div>
      )}
      <label className="field">
        Account name
        <input
          {...field("name")}
          placeholder={card ? "Visa card" : tracking ? "Brokerage" : "Everyday checking"}
        />
      </label>
      <label className="field">
        {card ? "Amount owed on the opening date" : "Opening balance"}
        <AmountInput
          value={form.openingBalance}
          placeholder="0.00"
          onChange={(openingBalance) => {
            setForm({ ...form, openingBalance });
            action.clearError();
          }}
        />
      </label>
      {tracking && chooseType && (
        <p className="empty-state">
          A tracking account stands alone: its balance and transactions are kept here, outside the
          budget. It never counts toward Available to Assign, has no envelopes and no transfers. For
          a loan, enter what is owed as a negative balance.
        </p>
      )}
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
      {children}
      <ErrorMessage error={action.error} />
    </form>
  );
}
