import type { ActivityDay, ActivityRow } from "../../models/activity";
import type { FoundRow } from "../../models/transactionSearch";
import { formatSignedCents } from "../../models/money";
import { formatDay, formatMonth, todayIso, type Month } from "../../models/month";
import type { Transaction } from "../../models/types";
import { BankIcon, ChevronDownIcon } from "../icons";

/**
 * Transactions under day headings (newest first), and for an open account
 * under month dividers too, then "Show 100 more"; or, sorted other than by
 * date, one list with each row's date. Each row has a checkbox, the
 * bank icon (colored once reconciled), payee (tap to edit), envelope or split
 * pill, and amount.
 */
export function TransactionList({
  days,
  months,
  flatRows = null,
  highlightEnvelopeId = null,
  leftCount,
  pageSize,
  onShowMore,
  emptyText,
  showAccount,
  selected,
  onToggleSelected,
  closedSplits,
  onToggleSplit,
  onEdit,
  editingId,
  desktop,
}: {
  days: ActivityDay[];
  /** With months, the days sit under month dividers (an open account's list crosses months). */
  months?: { month: Month; days: ActivityDay[] }[];
  /** Sorted by amount, payee or envelope: one list, no headings; each row shows its date. */
  flatRows?: FoundRow[] | null;
  /** The envelope searched for: its part of a split stands out. */
  highlightEnvelopeId?: string | null;
  /** Rows not shown yet; "Show more" disappears at 0. */
  leftCount: number;
  pageSize: number;
  onShowMore: () => void;
  emptyText: string;
  /** Rows show the account under the payee (All accounts). */
  showAccount: boolean;
  selected: ReadonlySet<string>;
  onToggleSelected: (id: string) => void;
  /** Splits the user closed (they start open). */
  closedSplits: ReadonlySet<string>;
  onToggleSplit: (id: string) => void;
  onEdit: (tx: Transaction) => void;
  /** The transaction open in the desktop panel. */
  editingId: string | null;
  desktop: boolean;
}) {
  // An open account's list crosses years: a day in another year shows it.
  const today = months ? todayIso() : undefined;
  // Under month dividers, days are one level down.
  const DayHeading = months ? "h3" : "h2";
  const item = (row: ActivityRow, date?: string) => (
    <TransactionItem
      key={row.tx.id}
      row={row}
      date={date}
      showAccount={showAccount}
      checked={selected.has(row.tx.id)}
      onCheck={() => onToggleSelected(row.tx.id)}
      open={!closedSplits.has(row.tx.id)}
      onEdit={() => onEdit(row.tx)}
      onToggleSplit={() => onToggleSplit(row.tx.id)}
      desktop={desktop}
      selected={desktop && editingId === row.tx.id}
      highlightEnvelopeId={highlightEnvelopeId}
    />
  );
  const dayGroup = (day: ActivityDay) => (
    <section key={day.date} aria-labelledby={`day-${day.date}`}>
      <div className="activity-day-head">
        <DayHeading id={`day-${day.date}`}>{formatDay(day.date, today)}</DayHeading>
        <span>{formatSignedCents(day.net)}</span>
      </div>
      <ul className="activity-rows">{day.rows.map((row) => item(row))}</ul>
    </section>
  );

  return (
    <section className="activity-list" aria-label="Transactions">
      {flatRows ? (
        flatRows.length === 0 ? (
          <p className="activity-empty">{emptyText}</p>
        ) : (
          <ul className="activity-rows flat-rows">
            {flatRows.map(({ row, date }) => item(row, formatDay(date, todayIso())))}
          </ul>
        )
      ) : days.length === 0 ? (
        <p className="activity-empty">{emptyText}</p>
      ) : months ? (
        months.map(({ month, days: monthDays }) => (
          <section key={month} aria-labelledby={`month-${month}`}>
            <h2 className="activity-month-head" id={`month-${month}`}>
              {formatMonth(month)}
            </h2>
            {monthDays.map(dayGroup)}
          </section>
        ))
      ) : (
        days.map(dayGroup)
      )}
      {leftCount > 0 && (
        <button className="show-more" type="button" onClick={onShowMore}>
          Show {Math.min(pageSize, leftCount)} more ({leftCount} left)
        </button>
      )}
    </section>
  );
}

/** One transaction, with a split's parts below it. */
function TransactionItem({
  row,
  date,
  showAccount,
  checked,
  onCheck,
  open,
  onEdit,
  onToggleSplit,
  desktop,
  selected,
  highlightEnvelopeId,
}: {
  row: ActivityRow;
  /** Shown under the payee when the list has no day headings. */
  date?: string;
  showAccount: boolean;
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
  highlightEnvelopeId: string | null;
}) {
  const payee = row.tx.payee || "(no payee)";
  const amount = formatSignedCents(row.amount);
  const portionsId = `split-${row.tx.id}`;
  const isSplit = row.portions.length > 0;
  // An open account's rows are all in it, so only a transfer names accounts.
  const accountLine = [date, showAccount || row.kind === "transfer" ? row.accountLine : ""]
    .filter(Boolean)
    .join(" · ");

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
          aria-label={`Edit ${payee}, ${amount}${accountLine ? `, ${accountLine}` : ""}`}
          onClick={onEdit}
        >
          <span className={row.toReview ? "activity-payee to-review" : "activity-payee"}>
            {payee}
          </span>
          {accountLine && <span className="activity-account">{accountLine}</span>}
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
              // A tracking row has no envelope: a phone shows its notes here
              // (a desktop has a memo column).
              row.category || (desktop ? "" : row.tx.memo)
            )}
          </span>
        )}
        {desktop && <span className="activity-memo">{row.tx.memo}</span>}
        <span className={`activity-amount ${row.amount < 0 ? "out" : "in"}`}>{amount}</span>
      </div>
      {isSplit && (
        <div className="activity-portions" id={portionsId} hidden={!open}>
          {row.portions.map((portion) => (
            <div
              className={
                portion.envelopeId === highlightEnvelopeId
                  ? "activity-grid activity-portion match"
                  : "activity-grid activity-portion"
              }
              key={portion.envelopeId}
            >
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
