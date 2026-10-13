import { useState } from "react";
import { useActivityPage } from "../../controllers/useActivityPage";
import { useAsyncAction } from "../../controllers/useAsyncAction";
import type { Budget } from "../../controllers/useBudget";
import { formFromTransaction } from "../../controllers/useTransactionEntry";
import type { BudgetData } from "../../models/types";
import { ErrorMessage, Money } from "../components";
import { TransactionEntry } from "../TransactionEntry";

/** Transactions, newest first; Edit turns a row into its form, in place. */
export function ActivityPage({ budget, data }: { budget: Budget; data: BudgetData }) {
  const page = useActivityPage(budget, data);
  const remove = useAsyncAction(page.deleteTransaction);
  const mark = useAsyncAction(page.markIncome);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <section className="page-view stack" aria-labelledby="activity-title">
      <header className="page-heading">
        <p className="eyebrow">Your spending trail</p>
        <h1 id="activity-title">Activity</h1>
        <p>Review transactions and keep your budget in sync with real life.</p>
      </header>

      {!page.hasOpenAccounts && (
        <p className="notice">
          <a href="#accounts">Add an account</a> before entering transactions.
        </p>
      )}

      {page.toReview.length > 0 && (
        <section className="list-card" aria-labelledby="review-title">
          <div className="section-heading">
            <h2 id="review-title">Inflows to review</h2>
            <span className="section-count">{page.toReview.length}</span>
          </div>
          <p className="empty-state">
            <Money cents={page.toReviewTotal} /> came in but is not in Available to Assign yet. Mark
            paychecks and other income as Income; give refunds an envelope, or make a move between
            accounts a Transfer, with Edit below. <a href="#settings">Income rules</a> can mark
            paychecks for you.
          </p>
          <ul className="item-list" aria-label="Inflows to review">
            {page.toReview.map(({ tx, accountName }) => (
              <li className="item" key={tx.id}>
                <span className="item-title">{tx.payee || "(no payee)"}</span>
                <strong>
                  <Money cents={tx.amount} />
                </strong>
                <span className="item-detail">
                  {tx.date} · {accountName}
                </span>
                <button
                  className="text-button"
                  type="button"
                  disabled={mark.pending}
                  onClick={() => void mark.run([tx.id])}
                >
                  Mark as Income
                </button>
              </li>
            ))}
          </ul>
          {page.ruleMatches.length > 0 && (
            <button
              className="secondary-button"
              type="button"
              disabled={mark.pending}
              onClick={() => void mark.run(page.ruleMatches)}
            >
              Apply income rules ({page.ruleMatches.length}{" "}
              {page.ruleMatches.length === 1 ? "match" : "matches"})
            </button>
          )}
          {page.toReview.length > 1 && (
            <button
              className="secondary-button"
              type="button"
              disabled={mark.pending}
              onClick={() => {
                if (
                  window.confirm(
                    `Mark all ${page.toReview.length} inflows as Income? They will count toward Available to Assign.`,
                  )
                ) {
                  void mark.run(page.toReview.map(({ tx }) => tx.id));
                }
              }}
            >
              Mark all {page.toReview.length} as Income
            </button>
          )}
          <ErrorMessage error={mark.error} />
        </section>
      )}

      <section className="list-card">
        <div className="section-heading">
          <h2>Transactions</h2>
          <span className="section-count">{page.rows.length}</span>
        </div>
        {page.rows.length === 0 ? (
          <p className="empty-state">No transactions yet. Add one with the + button.</p>
        ) : (
          <ul className="item-list" aria-label="Transactions">
            {page.rows.map(({ tx, accountName, category }) =>
              tx.id === editingId ? (
                <li className="item-editing" key={tx.id}>
                  <TransactionEntry
                    budget={budget}
                    data={data}
                    initial={formFromTransaction(tx, data)}
                    heading="Edit transaction"
                    onDone={() => setEditingId(null)}
                    onCancel={() => setEditingId(null)}
                  />
                </li>
              ) : (
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
                      onClick={() => setEditingId(tx.id)}
                    >
                      Edit
                    </button>
                    <button
                      className="text-button danger"
                      type="button"
                      disabled={remove.pending}
                      onClick={() => {
                        const question = tx.transferId
                          ? "Delete this transfer? Its other side goes too (an imported bank row is kept, as Uncategorized)."
                          : "Delete this transaction?";
                        if (window.confirm(question)) void remove.run(tx.id);
                      }}
                    >
                      Delete
                    </button>
                  </span>
                </li>
              ),
            )}
          </ul>
        )}
        <ErrorMessage error={remove.error} />
      </section>
    </section>
  );
}
