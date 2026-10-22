import { useEffect, useRef, useState } from "react";
import { useAsyncAction } from "../../controllers/useAsyncAction";
import type { useAccountView } from "../../controllers/useAccountView";
import type { Budget } from "../../controllers/useBudget";
import { blankTransactionForm } from "../../controllers/useTransactionEntry";
import { formatSignedCents } from "../../models/money";
import type { BudgetData, Transaction } from "../../models/types";
import { ErrorMessage, Money } from "../components";
import { TransactionEntry } from "../TransactionEntry";

type View = ReturnType<typeof useAccountView>;

/**
 * Ticked rows: how many, their total, and Mark reconciled / unreconciled.
 * The count is always in the page (visually hidden), so screen readers hear it change.
 */
export function SelectionBar({ view }: { view: View }) {
  const reconcile = useAsyncAction(view.setReconciled);
  const text =
    view.selectedCount > 0
      ? `${view.selectedCount} selected, ${formatSignedCents(view.selectedTotal)}`
      : "";
  return (
    <>
      <p className="visually-hidden" aria-live="polite">
        {text}
      </p>
      {view.selectedCount > 0 && (
        <div className="selection-bar" role="toolbar" aria-label="Selected transactions">
          <p className="selection-summary">
            <span>{view.selectedCount} selected</span>
            <strong>{formatSignedCents(view.selectedTotal)}</strong>
          </p>
          {view.canReconcile && (
            <button
              className="selection-action"
              type="button"
              disabled={reconcile.pending}
              onClick={() => void reconcile.run(true)}
            >
              Mark reconciled
            </button>
          )}
          {view.canUnreconcile && (
            <button
              className="selection-action quiet"
              type="button"
              disabled={reconcile.pending}
              onClick={() => void reconcile.run(false)}
            >
              Mark unreconciled
            </button>
          )}
          <button
            className="selection-clear"
            type="button"
            aria-label="Clear selection"
            onClick={() => {
              reconcile.clearError();
              view.clearSelection();
            }}
          >
            ×
          </button>
          <ErrorMessage error={reconcile.error} />
        </div>
      )}
    </>
  );
}

/**
 * Transactions still to review (from any month; in the open account only),
 * with Mark as Income, Apply income rules and Mark all as Income. Null when
 * there is nothing to review.
 */
export function ReviewCard({ view, onEdit }: { view: View; onEdit: (tx: Transaction) => void }) {
  const mark = useAsyncAction(view.markIncome);
  const incomeable = view.toReview.filter((r) => r.canBeIncome);
  if (view.toReview.length === 0) return null;

  return (
    <section className="list-card activity-review" aria-labelledby="review-title">
      <div className="section-heading">
        <h2 id="review-title">To review</h2>
        <span className="section-count">{view.toReview.length}</span>
      </div>
      <p className="empty-state">
        <Money cents={view.toReviewIn} /> in and <Money cents={view.toReviewOut} /> out are not in
        Available to Assign yet. Tap one to give it an envelope or make it a Transfer; mark
        paychecks as Income. <a href="#settings">Income rules</a> can mark paychecks for you.
      </p>
      <ul className="item-list" aria-label="To review">
        {view.toReview.map(({ tx, accountName, canBeIncome }) => (
          <li className="review-item" key={tx.id}>
            <button className="review-row item-button" type="button" onClick={() => onEdit(tx)}>
              <span className="item-title">{tx.payee || "(no payee)"}</span>
              <strong>
                <Money cents={tx.amount} />
              </strong>
              <span className="item-detail">
                {tx.date} · {accountName}
              </span>
            </button>
            {canBeIncome && (
              <button
                className="text-button"
                type="button"
                disabled={mark.pending}
                onClick={() => void mark.run([tx.id])}
              >
                Mark as Income
              </button>
            )}
          </li>
        ))}
      </ul>
      {view.ruleMatches.length > 0 && (
        <button
          className="secondary-button"
          type="button"
          disabled={mark.pending}
          onClick={() => void mark.run(view.ruleMatches)}
        >
          Apply income rules ({view.ruleMatches.length}{" "}
          {view.ruleMatches.length === 1 ? "match" : "matches"})
        </button>
      )}
      {incomeable.length > 1 && (
        <button
          className="secondary-button"
          type="button"
          disabled={mark.pending}
          onClick={() => {
            if (
              window.confirm(
                `Mark all ${incomeable.length} inflows as Income? They will count toward Available to Assign.`,
              )
            ) {
              void mark.run(incomeable.map(({ tx }) => tx.id));
            }
          }}
        >
          Mark all {incomeable.length} inflows as Income
        </button>
      )}
      <ErrorMessage error={mark.error} />
    </section>
  );
}

/**
 * The new transaction row (desktop): the transaction form with its fields
 * side by side, at the top of the list. It starts in the open account, and
 * Escape closes it.
 */
export function NewTransactionRow({
  budget,
  data,
  accountId,
  onClose,
}: {
  budget: Budget;
  data: BudgetData;
  accountId: string | null;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [initial] = useState(() => blankTransactionForm(data, accountId));

  // Start typing in Payee.
  useEffect(() => {
    box.current?.querySelector<HTMLInputElement>(".field-payee input")?.focus();
  }, []);

  return (
    <div
      ref={box}
      className="activity-new-row"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <TransactionEntry
        budget={budget}
        data={data}
        initial={initial}
        heading="New transaction"
        layout="row"
        fixedAccount={accountId !== null}
        onDone={onClose}
        onCancel={onClose}
      />
    </div>
  );
}
