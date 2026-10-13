import { useState } from "react";
import { useActivityPage } from "../../controllers/useActivityPage";
import { useAsyncAction } from "../../controllers/useAsyncAction";
import type { Budget } from "../../controllers/useBudget";
import { formFromTransaction } from "../../controllers/useTransactionEntry";
import type { BudgetData, Transaction } from "../../models/types";
import { ErrorMessage, Money } from "../components";
import { TransactionDialog } from "../TransactionEntry";

/** Transactions under date headings, newest first; tap one to edit or delete it. */
export function ActivityPage({ budget, data }: { budget: Budget; data: BudgetData }) {
  const page = useActivityPage(budget, data);
  const mark = useAsyncAction(page.markIncome);
  const incomeable = page.toReview.filter((r) => r.canBeIncome);
  /** The transaction open in the edit dialog. */
  const [editing, setEditing] = useState<Transaction | null>(null);

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
            <h2 id="review-title">To review</h2>
            <span className="section-count">{page.toReview.length}</span>
          </div>
          <p className="empty-state">
            <Money cents={page.toReviewIn} /> in and <Money cents={page.toReviewOut} /> out are not
            in Available to Assign yet. Tap one to give it an envelope or make it a Transfer; mark
            paychecks as Income. <a href="#settings">Income rules</a> can mark paychecks for you.
          </p>
          <ul className="item-list" aria-label="To review">
            {page.toReview.map(({ tx, accountName, canBeIncome }) => (
              <li className="review-item" key={tx.id}>
                <button
                  className="review-row item-button"
                  type="button"
                  onClick={() => setEditing(tx)}
                >
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
      )}

      <section className="list-card" aria-labelledby="transactions-title">
        <div className="section-heading">
          <h2 id="transactions-title">Transactions</h2>
          <span className="section-count">{page.rows.length}</span>
        </div>
        {page.rows.length === 0 ? (
          <p className="empty-state">No transactions yet. Add one with the + button.</p>
        ) : (
          page.days.map((day) => (
            // Open by default; tap a date to fold its transactions away.
            <details className="day-group" key={day.date} open>
              <summary>
                <span>{day.label}</span>
                <span className="section-count">{day.rows.length}</span>
              </summary>
              <ul className="item-list">
                {day.rows.map(({ tx, accountName, category, uncategorized }) => (
                  <li key={tx.id}>
                    <button
                      className="item item-button"
                      type="button"
                      onClick={() => setEditing(tx)}
                    >
                      <span className="item-title">{tx.payee || "(no payee)"}</span>
                      <strong>
                        <Money cents={tx.amount} />
                      </strong>
                      <span className="item-detail">
                        {accountName} ·{" "}
                        <span className={uncategorized ? "badge-uncategorized" : undefined}>
                          {category}
                        </span>
                        {tx.memo && ` · ${tx.memo}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ))
        )}
      </section>

      <TransactionDialog
        budget={budget}
        data={data}
        open={editing !== null}
        heading="Edit transaction"
        initial={() => formFromTransaction(editing!, data)}
        onClose={() => setEditing(null)}
        onDelete={async () => {
          if (editing) await page.deleteTransaction(editing.id);
        }}
      />
    </section>
  );
}
