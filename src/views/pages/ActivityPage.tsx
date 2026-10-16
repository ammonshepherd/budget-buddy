import { useState } from "react";
import type { ActivityRow, ClearedStatus } from "../../models/activity";
import { useActivityPage } from "../../controllers/useActivityPage";
import { useAsyncAction } from "../../controllers/useAsyncAction";
import type { Budget } from "../../controllers/useBudget";
import { formFromTransaction } from "../../controllers/useTransactionEntry";
import { formatCents, formatSignedCents } from "../../models/money";
import { formatDay, type Month } from "../../models/month";
import type { BudgetData, Transaction } from "../../models/types";
import { ErrorMessage, Money } from "../components";
import { ChevronDownIcon } from "../icons";
import { TransactionDialog } from "../TransactionEntry";

const STATUS_LABELS: Record<ClearedStatus, string> = {
  uncleared: "Uncleared",
  cleared: "Cleared",
  reconciled: "Reconciled",
};

/** A row's amount: signed for money in and out, unsigned for a transfer. */
const amountText = (row: ActivityRow) =>
  row.kind === "transfer" ? formatCents(row.amount) : formatSignedCents(row.amount);

/**
 * One month's transactions under day headings, newest first, with the month's
 * totals; tap a payee to edit or delete. Splits show their parts until closed.
 */
export function ActivityPage({
  budget,
  data,
  month,
  accountId,
  onAccountChange,
}: {
  budget: Budget;
  data: BudgetData;
  month: Month;
  /** The account to show only (null: all), kept by the app between months. */
  accountId: string | null;
  onAccountChange: (accountId: string | null) => void;
}) {
  const page = useActivityPage(budget, data, month, accountId);
  const mark = useAsyncAction(page.markIncome);
  const incomeable = page.toReview.filter((r) => r.canBeIncome);
  /** The transaction open in the edit dialog. */
  const [editing, setEditing] = useState<Transaction | null>(null);
  /** Splits the user closed (they start open; this resets with the month). */
  const [closedSplits, setClosedSplits] = useState<ReadonlySet<string>>(new Set());
  const toggleSplit = (id: string) =>
    setClosedSplits((closed) => {
      const next = new Set(closed);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <section className="page-view activity-page" aria-labelledby="activity-title">
      {/* Read by screen readers; the transactions get the screen space. */}
      <h1 id="activity-title" className="visually-hidden">
        Activity
      </h1>

      <div className="budget-month month-nav">
        <a href={page.previousHref} aria-label="Previous month">
          ‹
        </a>
        <span>{page.monthLabel}</span>
        <a href={page.nextHref} aria-label="Next month">
          ›
        </a>
      </div>

      {page.accounts.length > 1 && (
        <div className="activity-account-filter">
          <label htmlFor="activity-account">Account</label>
          <span className="move-picker">
            <select
              id="activity-account"
              value={page.accountId ?? ""}
              onChange={(event) => onAccountChange(event.target.value || null)}
            >
              <option value="">All accounts</option>
              {page.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                  {account.closed ? " (closed)" : ""}
                </option>
              ))}
            </select>
            <span aria-hidden="true">▾</span>
          </span>
        </div>
      )}

      <dl
        className="activity-totals"
        aria-label={`Totals for ${page.monthLabel}${page.accountName ? ` in ${page.accountName}` : ""}`}
      >
        <div>
          <dt>In</dt>
          <dd className="activity-in">{formatSignedCents(page.totals.moneyIn)}</dd>
        </div>
        <div>
          <dt>Out</dt>
          <dd>{formatSignedCents(-page.totals.moneyOut)}</dd>
        </div>
        <div>
          <dt>Transfers</dt>
          <dd className="activity-transfer">{formatCents(page.totals.transfers)}</dd>
        </div>
      </dl>

      {!page.hasOpenAccounts && (
        <p className="notice activity-notice">
          <a href="#accounts">Add an account</a> before entering transactions.
        </p>
      )}

      {page.toReview.length > 0 && (
        <section className="list-card activity-review" aria-labelledby="review-title">
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

      <section className="activity-list" aria-label="Transactions">
        {page.days.length === 0 ? (
          <p className="activity-empty">
            No transactions {page.accountName ? `in ${page.accountName} ` : ""}in {page.monthLabel}.
          </p>
        ) : (
          page.days.map((day) => (
            <section key={day.date} aria-labelledby={`day-${day.date}`}>
              <div className="activity-day-head">
                <h2 id={`day-${day.date}`}>{formatDay(day.date)}</h2>
                <span>{formatSignedCents(day.net)}</span>
              </div>
              <ul className="activity-rows">
                {day.rows.map((row) => (
                  <ActivityItem
                    key={row.tx.id}
                    row={row}
                    open={!closedSplits.has(row.tx.id)}
                    onEdit={() => setEditing(row.tx)}
                    onToggleSplit={() => toggleSplit(row.tx.id)}
                  />
                ))}
              </ul>
            </section>
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

/** One transaction: status, payee and account (tap to edit), envelope, amount; a split's parts below. */
function ActivityItem({
  row,
  open,
  onEdit,
  onToggleSplit,
}: {
  row: ActivityRow;
  open: boolean;
  onEdit: () => void;
  onToggleSplit: () => void;
}) {
  const payee = row.tx.payee || "(no payee)";
  const amount = amountText(row);
  const portionsId = `split-${row.tx.id}`;
  const isSplit = row.portions.length > 0;

  return (
    <li className="activity-item">
      <div className="activity-grid activity-row">
        <span
          className={`status-mark ${row.status}`}
          role="img"
          aria-label={STATUS_LABELS[row.status]}
        />
        <button
          className="activity-who"
          type="button"
          aria-label={`Edit ${payee}, ${amount}, ${row.accountLine}`}
          onClick={onEdit}
        >
          <span className="activity-payee">{payee}</span>
          <span className="activity-account">{row.accountLine}</span>
        </button>
        {isSplit ? (
          <button
            className="split-pill"
            type="button"
            aria-expanded={open}
            aria-controls={portionsId}
            aria-label={`${open ? "Close" : "Open"} split for ${payee}`}
            onClick={onToggleSplit}
          >
            Split ({row.portions.length})
            <ChevronDownIcon />
          </button>
        ) : (
          <span className="activity-category">
            {row.toReview ? (
              <span className="badge-uncategorized">{row.category}</span>
            ) : (
              row.category
            )}
          </span>
        )}
        <span className={`activity-amount ${row.kind}`}>{amount}</span>
      </div>
      {isSplit && (
        <div className="activity-portions" id={portionsId} hidden={!open}>
          {row.portions.map((portion) => (
            <div className="activity-grid activity-portion" key={portion.envelopeId}>
              <span />
              <span className="portion-memo">↳ {portion.envelopeName}</span>
              <span className="portion-envelope">{portion.envelopeName}</span>
              <span className="portion-amount">{formatSignedCents(portion.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
