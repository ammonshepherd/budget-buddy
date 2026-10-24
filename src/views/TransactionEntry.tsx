import { useState } from "react";
import type { Budget } from "../controllers/useBudget";
import {
  blankTransactionForm,
  useEnvelopeRemaining,
  useTransactionEntry,
  type CoverPlan,
  type TransactionForm,
} from "../controllers/useTransactionEntry";
import type { BudgetData } from "../models/types";
import { Sheet } from "./components";
import { PlusIcon } from "./icons";
import { CoverCard } from "./transactions/CoverCard";
import { TransactionEditor } from "./transactions/TransactionEditor";

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
  layout = "stack",
  fixedAccount = false,
}: {
  budget: Budget;
  data: BudgetData;
  initial: TransactionForm;
  heading: string;
  onDone: () => void;
  onCancel: () => void;
  /** Set when editing: shows a Delete button. */
  onDelete?: () => Promise<void>;
  /** "row": the fields side by side, as the new transaction row on Accounts on a desktop. */
  layout?: "stack" | "row";
  /** Adding in the desktop row inside an open account: the form shows its name, not the Account picker. */
  fixedAccount?: boolean;
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
      layout={layout}
      fixedAccount={fixedAccount}
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
 * The round + button in the bottom-right corner (Budget and Accounts), or on
 * a desktop "+ Add transaction" at the top of the sidebar. It opens the
 * transaction form in a modal dialog, starting in the account open on
 * Accounts; its Account picker offers every open account. `onAdd` takes over
 * on a desktop with an account or All accounts open (a new row opens instead).
 */
export function AddTransactionButton({
  budget,
  data,
  desktop = false,
  accountId = null,
  onAdd,
}: {
  budget: Budget;
  data: BudgetData;
  desktop?: boolean;
  /** The account open on Accounts: a new transaction starts in it. */
  accountId?: string | null;
  onAdd?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className={desktop ? "sidebar-add" : "fab"}
        type="button"
        aria-label="Add transaction"
        title="Add transaction"
        onClick={() => (onAdd ? onAdd() : setOpen(true))}
      >
        <PlusIcon />
        {desktop && <span className="nav-label">Add transaction</span>}
      </button>
      <TransactionDialog
        budget={budget}
        data={data}
        open={open}
        heading="Add a transaction"
        initial={() => blankTransactionForm(data, accountId)}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
