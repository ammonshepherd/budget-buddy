import { useEffect, useRef, useState } from "react";
import type { ActivityRow } from "../../models/activity";
import { useActivityPage } from "../../controllers/useActivityPage";
import { useAsyncAction } from "../../controllers/useAsyncAction";
import type { Budget } from "../../controllers/useBudget";
import { useSidebar } from "../../controllers/useLayout";
import { blankTransactionForm, formFromTransaction } from "../../controllers/useTransactionEntry";
import { formatCents, formatSignedCents } from "../../models/money";
import { formatDay, type Month } from "../../models/month";
import type { BudgetData, Transaction } from "../../models/types";
import { ErrorMessage, Money } from "../components";
import { BankIcon, ChevronDownIcon } from "../icons";
import { CardDebt } from "../CardDebt";
import { SidePanel } from "../SidePanel";
import { TransactionDialog, TransactionEntry } from "../TransactionEntry";

/** A row's amount, signed (a transfer too: its side in the account shown). */
const amountText = (row: ActivityRow) => formatSignedCents(row.amount);

/**
 * One month's transactions under day headings, newest first, with the month's
 * totals and today's balance; tap a payee to edit or delete. Splits show their
 * parts until closed. Tick rows to see their total and mark them reconciled.
 * On a desktop the month has a band of its own, the rows show the memo too,
 * and a panel on the right holds the account picker and totals, then To
 * review or the transaction being edited; Add transaction opens a new row at
 * the top of the list.
 */
export function ActivityPage({
  budget,
  data,
  month,
  accountId,
  onAccountChange,
  userId,
  desktop = false,
  addRequest = 0,
}: {
  budget: Budget;
  data: BudgetData;
  month: Month;
  /** The account to show only (null: all), kept by the app between months. */
  accountId: string | null;
  onAccountChange: (accountId: string | null) => void;
  userId: string;
  desktop?: boolean;
  /** Goes up each time the sidebar's Add transaction is clicked (desktop). */
  addRequest?: number;
}) {
  const page = useActivityPage(budget, data, month, accountId);
  const mark = useAsyncAction(page.markIncome);
  const reconcile = useAsyncAction(page.setReconciled);
  const incomeable = page.toReview.filter((r) => r.canBeIncome);
  /** The transaction open in the edit dialog (in the panel on a desktop). */
  const [editing, setEditing] = useState<Transaction | null>(null);
  const panel = useSidebar("panel", userId);
  const edit = (tx: Transaction) => {
    setEditing(tx);
    if (desktop) panel.expand();
  };
  // The new transaction row (desktop): opened by Add transaction, closed by
  // adding, Cancel or Escape. (A click seen while rendering, like lastMonth in App.)
  const [adding, setAdding] = useState(false);
  const [addsSeen, setAddsSeen] = useState(addRequest);
  if (addRequest !== addsSeen) {
    setAddsSeen(addRequest);
    setAdding(true);
  }

  const reviewCard = page.toReview.length > 0 && (
    <section className="list-card activity-review" aria-labelledby="review-title">
      <div className="section-heading">
        <h2 id="review-title">To review</h2>
        <span className="section-count">{page.toReview.length}</span>
      </div>
      <p className="empty-state">
        <Money cents={page.toReviewIn} /> in and <Money cents={page.toReviewOut} /> out are not in
        Available to Assign yet. Tap one to give it an envelope or make it a Transfer; mark
        paychecks as Income. <a href="#settings">Income rules</a> can mark paychecks for you.
      </p>
      <ul className="item-list" aria-label="To review">
        {page.toReview.map(({ tx, accountName, canBeIncome }) => (
          <li className="review-item" key={tx.id}>
            <button className="review-row item-button" type="button" onClick={() => edit(tx)}>
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
  );
  /** Splits the user closed (they start open; this resets with the month). */
  const [closedSplits, setClosedSplits] = useState<ReadonlySet<string>>(new Set());
  const toggleSplit = (id: string) =>
    setClosedSplits((closed) => {
      const next = new Set(closed);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const monthNav = (
    <div className="budget-month month-nav">
      <a href={page.previousHref} aria-label="Previous month">
        ‹
      </a>
      <span>{page.monthLabel}</span>
      <a href={page.nextHref} aria-label="Next month">
        ›
      </a>
    </div>
  );
  const accountFilter = page.accounts.length > 1 && (
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
  );
  const { balance } = page;
  const totals = (
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
        <dd className="activity-out">{formatSignedCents(-page.totals.moneyOut)}</dd>
      </div>
      <div className="activity-balance">
        <dt>Balance today</dt>
        <dd>{formatCents(balance.today)}</dd>
        {/* All accounts with a card: the balance is cash minus card debt, so show both. */}
        {page.accountId === null && balance.hasCards ? (
          <dd className="activity-balance-detail">
            Cash {formatCents(balance.cash)} · Cards owe {formatCents(balance.cardsOwe)}
          </dd>
        ) : (
          <dd className="activity-balance-detail">Reconciled {formatCents(balance.reconciled)}</dd>
        )}
      </div>
    </dl>
  );
  const selectionText =
    page.selectedCount > 0
      ? `${page.selectedCount} selected, ${formatSignedCents(page.selectedTotal)}`
      : "";
  const selectionBar = (
    <>
      {/* Always in the page, so screen readers hear the count change. */}
      <p className="visually-hidden" aria-live="polite">
        {selectionText}
      </p>
      {page.selectedCount > 0 && (
        <div className="selection-bar" role="toolbar" aria-label="Selected transactions">
          <p className="selection-summary">
            <span>{page.selectedCount} selected</span>
            <strong>{formatSignedCents(page.selectedTotal)}</strong>
          </p>
          {page.canReconcile && (
            <button
              className="selection-action"
              type="button"
              disabled={reconcile.pending}
              onClick={() => void reconcile.run(true)}
            >
              Mark reconciled
            </button>
          )}
          {page.canUnreconcile && (
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
              page.clearSelection();
            }}
          >
            ×
          </button>
          <ErrorMessage error={reconcile.error} />
        </div>
      )}
    </>
  );
  const list = (
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
                  checked={page.selected.has(row.tx.id)}
                  onCheck={() => page.toggleSelected(row.tx.id)}
                  open={!closedSplits.has(row.tx.id)}
                  onEdit={() => edit(row.tx)}
                  onToggleSplit={() => toggleSplit(row.tx.id)}
                  desktop={desktop}
                  selected={desktop && editing?.id === row.tx.id}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </section>
  );

  return (
    <section className="page-view activity-page" aria-labelledby="activity-title">
      {/* Read by screen readers; the transactions get the screen space. */}
      <h1 id="activity-title" className="visually-hidden">
        Activity
      </h1>

      {desktop ? (
        // The band, pinned to the top, holds the month; the account and its
        // totals sit at the top of the panel.
        <>
          <div className="activity-band">{monthNav}</div>
          <CardDebt data={data} />
        </>
      ) : (
        <>
          {monthNav}
          <CardDebt data={data} />
          {accountFilter}
          {totals}
          {selectionBar}
        </>
      )}

      {!page.hasOpenAccounts && (
        <p className="notice activity-notice">
          <a href="#accounts">Add an account</a> before entering transactions.
        </p>
      )}

      {desktop ? (
        <div className="activity-work">
          <div className="activity-table">
            {selectionBar}
            {adding && page.hasOpenAccounts && (
              <NewTransactionRow
                budget={budget}
                data={data}
                accountId={page.accountId}
                onClose={() => setAdding(false)}
              />
            )}
            {list}
          </div>
          <SidePanel
            label={editing ? "Edit transaction" : "To review"}
            collapsed={panel.collapsed}
            onToggle={panel.toggle}
          >
            <div className="panel-account">
              {accountFilter}
              {totals}
            </div>
            {editing ? (
              <div className="panel-edit">
                <button
                  className="text-button panel-back"
                  type="button"
                  onClick={() => setEditing(null)}
                >
                  ‹ Back to To review
                </button>
                <TransactionEntry
                  key={editing.id}
                  budget={budget}
                  data={data}
                  initial={formFromTransaction(editing, data)}
                  heading="Edit transaction"
                  onDone={() => setEditing(null)}
                  onCancel={() => setEditing(null)}
                  onDelete={async () => {
                    await page.deleteTransaction(editing.id);
                    setEditing(null);
                  }}
                />
              </div>
            ) : (
              reviewCard || (
                <div className="month-summary">
                  <h2>To review</h2>
                  <p className="empty-state">
                    Nothing to review{page.accountName ? ` in ${page.accountName}` : ""}. Every
                    transaction has an envelope, is Income, or is a Transfer.
                  </p>
                  <p className="panel-hint">Choose a transaction to edit it here.</p>
                </div>
              )
            )}
          </SidePanel>
        </div>
      ) : (
        <>
          {reviewCard}
          {list}
        </>
      )}

      <TransactionDialog
        budget={budget}
        data={data}
        open={!desktop && editing !== null}
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

/**
 * Activity's new transaction row (desktop): the transaction form with its
 * fields side by side, at the top of the list. It starts in the account the
 * page is narrowed to, and Escape closes it.
 */
function NewTransactionRow({
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
  const [initial] = useState(() => {
    const blank = blankTransactionForm(data);
    const open = data.accounts.some((a) => a.id === accountId && !a.closedAt);
    return open && accountId ? { ...blank, accountId } : blank;
  });

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
        onDone={onClose}
        onCancel={onClose}
      />
    </div>
  );
}

/**
 * One transaction: a checkbox, the bank icon (colored once reconciled), payee
 * and account (tap to edit), envelope, amount; a split's parts below.
 */
function ActivityItem({
  row,
  checked,
  onCheck,
  open,
  onEdit,
  onToggleSplit,
  desktop,
  selected,
}: {
  row: ActivityRow;
  /** Ticked: highlighted, and counted in the selection total. */
  checked: boolean;
  onCheck: () => void;
  open: boolean;
  onEdit: () => void;
  onToggleSplit: () => void;
  /** Adds a memo column. */
  desktop: boolean;
  /** Open in the desktop panel. */
  selected: boolean;
}) {
  const payee = row.tx.payee || "(no payee)";
  const amount = amountText(row);
  const portionsId = `split-${row.tx.id}`;
  const isSplit = row.portions.length > 0;

  return (
    <li
      className={["activity-item", selected && "selected", checked && "checked"]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="activity-grid activity-row">
        <label className="activity-check">
          <input
            type="checkbox"
            checked={checked}
            onChange={onCheck}
            aria-label={`Select ${payee}, ${amount}`}
          />
        </label>
        <span
          className={row.reconciled ? "bank-mark reconciled" : "bank-mark"}
          role="img"
          aria-label={row.reconciled ? "Reconciled" : "Not reconciled"}
        >
          <BankIcon />
        </span>
        <button
          className="activity-who"
          type="button"
          aria-label={`Edit ${payee}, ${amount}, ${row.accountLine}`}
          onClick={onEdit}
        >
          <span className={row.toReview ? "activity-payee to-review" : "activity-payee"}>
            {payee}
          </span>
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
        {desktop && <span className="activity-memo">{row.tx.memo}</span>}
        <span className={`activity-amount ${row.amount < 0 ? "out" : "in"}`}>{amount}</span>
      </div>
      {isSplit && (
        <div className="activity-portions" id={portionsId} hidden={!open}>
          {row.portions.map((portion) => (
            <div className="activity-grid activity-portion" key={portion.envelopeId}>
              <span />
              <span />
              <span className="portion-memo">↳ {portion.envelopeName}</span>
              <span className="portion-envelope">{portion.envelopeName}</span>
              {desktop && <span />}
              <span className={`portion-amount ${portion.amount < 0 ? "out" : "in"}`}>
                {formatSignedCents(portion.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
