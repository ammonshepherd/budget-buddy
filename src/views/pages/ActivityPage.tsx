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

      <section className="list-card">
        <div className="section-heading">
          <h2>Transactions</h2>
          <span className="section-count">{page.rows.length}</span>
        </div>
        {page.rows.length === 0 ? (
          <p className="empty-state">No transactions yet. Add one with the + button.</p>
        ) : (
          <ul className="item-list">
            {page.rows.map(({ tx, accountName, category }) =>
              tx.id === editingId ? (
                <li className="item-editing" key={tx.id}>
                  <TransactionEntry
                    budget={budget}
                    data={data}
                    initial={formFromTransaction(tx)}
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
                        if (window.confirm("Delete this transaction?")) void remove.run(tx.id);
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
