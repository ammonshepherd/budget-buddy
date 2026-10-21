import { useState } from "react";
import { useAsyncAction } from "../controllers/useAsyncAction";
import type { Budget } from "../controllers/useBudget";
import { useTransactionImport } from "../controllers/useTransactionImport";
import type {
  DateOrder,
  ImportFormat,
  ImportMatch,
  SkippedImportRow,
  TransactionImportPreview,
} from "../models/transactionImport";
import type { BudgetData } from "../models/types";
import { ErrorMessage, Money } from "./components";

const SHOWN_ROWS = 100;
const DATE_ORDERS: [DateOrder, string][] = [
  ["MDY", "Month first (10/12/26)"],
  ["DMY", "Day first (12/10/26)"],
  ["YMD", "Year first (2026-10-12)"],
];

type Import = ReturnType<typeof useTransactionImport>;

const count = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

const matchCount = (preview: TransactionImportPreview | null) =>
  preview?.matches.filter((m) => !m.separate).length ?? 0;
/** Rows the import button saves: new ones plus matches. */
const saveCount = (preview: TransactionImportPreview | null) =>
  (preview?.rows.length ?? 0) + matchCount(preview);

/** "Import 3 transactions", "Match 1 transaction" or "Import 3 and match 1". */
function importLabel(preview: TransactionImportPreview | null) {
  const added = preview?.rows.length ?? 0;
  const matched = matchCount(preview);
  if (matched === 0) return `Import ${count(added, "transaction")}`;
  if (added === 0) return `Match ${count(matched, "transaction")}`;
  return `Import ${added} and match ${matched}`;
}

/**
 * Import a bank or card CSV into an account: a Settings card with an account
 * picker, or (with `accountId`) into the account open on Accounts.
 */
export function TransactionImport({
  budget,
  data,
  accountId,
}: {
  budget: Budget;
  data: BudgetData;
  /** Import into this account only: no picker, and no link back to it. */
  accountId?: string;
}) {
  const io = useTransactionImport(budget, data, accountId);
  const save = useAsyncAction(io.importNow);
  // Changing the key empties the file input after an import or a cancel.
  const [inputKey, setInputKey] = useState(0);
  const { preview, format } = io;

  if (io.openAccounts.length === 0) {
    return (
      <section className="list-card" aria-labelledby="tx-import-title">
        <div className="section-heading">
          <h2 id="tx-import-title">Import transactions</h2>
        </div>
        <p className="notice">
          <a href="#accounts">Add an account</a> first; transactions are imported into one.
        </p>
      </section>
    );
  }

  return (
    <section className="list-card" aria-labelledby="tx-import-title">
      <div className="section-heading">
        <h2 id="tx-import-title">Import transactions</h2>
      </div>
      <p className="empty-state">
        Download a CSV from your bank or card website and choose it here. Columns are detected
        automatically, and remembered for each account. Imported transactions arrive Uncategorized;
        give them envelopes on Accounts. A bank row that matches a transaction you typed in is
        matched to it instead of being added twice.
      </p>

      <div className="form">
        {!accountId && (
          <label className="field">
            Account
            <select value={io.accountId} onChange={(e) => io.chooseAccount(e.target.value)}>
              {io.openAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          Bank CSV file
          <input
            key={inputKey}
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              save.clearError();
              void io.chooseFile(event.target.files?.[0] ?? null);
            }}
          />
        </label>
      </div>

      <ErrorMessage error={io.error} />

      {io.done && (
        <p className="notice" role="status">
          {io.done.added === 0 && io.done.matched > 0
            ? `Matched ${count(io.done.matched, "transaction")} you entered in ${io.done.accountName}`
            : `Imported ${count(io.done.added, "transaction")} into ${io.done.accountName}`}
          {io.done.added > 0 &&
            io.done.matched > 0 &&
            ` and matched ${io.done.matched} you entered`}
          {io.done.alreadyThere > 0 && ` (${io.done.alreadyThere} were already there)`}.
          {!accountId && (
            <>
              {" "}
              <a href={io.done.reviewHref}>Give them envelopes on Accounts</a>
            </>
          )}
        </p>
      )}

      {format && (
        <div className="stack">
          <ColumnChoices io={io} format={format} />
          <ErrorMessage error={io.problem} />
          {preview && <PreviewDetails preview={preview} io={io} />}
          <div className="button-row">
            <button
              className="primary-button"
              type="button"
              disabled={save.pending || saveCount(preview) === 0}
              onClick={async () => {
                if ((await save.run()).ok) setInputKey((k) => k + 1);
              }}
            >
              {importLabel(preview)}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                io.clear();
                save.clearError();
                setInputKey((k) => k + 1);
              }}
            >
              Cancel
            </button>
          </div>
          <ErrorMessage error={save.error} />
        </div>
      )}
    </section>
  );
}

function ColumnChoices({ io, format }: { io: Import; format: ImportFormat }) {
  const columnSelect = (
    label: string,
    value: number,
    onChange: (i: number) => void,
    optional = false,
  ) => (
    <label className="field">
      {label}
      <select aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {(optional || value < 0) && <option value={-1}>{optional ? "None" : "Choose…"}</option>}
        {io.columns.map((name, i) => (
          <option key={i} value={i}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
  const { amount } = format;

  return (
    // Open when the columns are a fresh guess; closed when they are the saved ones.
    <details className="import-columns" open={!io.usingSavedFormat || undefined}>
      <summary>
        {io.usingSavedFormat ? "Columns: using this account’s saved setup" : "Columns: check these"}
      </summary>
      <div className="form">
        {columnSelect("Date", format.date, (date) => io.updateFormat({ date }))}
        <label className="field">
          Date format
          <select
            value={format.dateOrder}
            onChange={(e) => io.updateFormat({ dateOrder: e.target.value as DateOrder })}
          >
            {DATE_ORDERS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {columnSelect(
          "Description",
          format.description,
          (description) => io.updateFormat({ description }),
          true,
        )}
        <div className="segmented" role="radiogroup" aria-label="Amounts">
          <label>
            <input
              type="radio"
              name="amount-kind"
              checked={amount.kind === "signed"}
              onChange={() =>
                io.updateFormat({
                  amount: {
                    kind: "signed",
                    column: amount.kind === "split" ? amount.outflow : amount.column,
                    flip: false,
                  },
                })
              }
            />
            One amount column
          </label>
          <label>
            <input
              type="radio"
              name="amount-kind"
              checked={amount.kind === "split"}
              onChange={() =>
                io.updateFormat({ amount: { kind: "split", outflow: -1, inflow: -1 } })
              }
            />
            Money out / in columns
          </label>
        </div>
        {amount.kind === "signed" ? (
          <>
            {columnSelect("Amount", amount.column, (column) =>
              io.updateFormat({ amount: { ...amount, column } }),
            )}
            <label className="choice">
              <input
                type="checkbox"
                checked={amount.flip}
                onChange={(e) => io.updateFormat({ amount: { ...amount, flip: e.target.checked } })}
              />
              Spending is shown as positive (common for credit cards): flip signs
            </label>
          </>
        ) : (
          <>
            {columnSelect("Money out (debits)", amount.outflow, (outflow) =>
              io.updateFormat({ amount: { ...amount, outflow } }),
            )}
            {columnSelect("Money in (credits)", amount.inflow, (inflow) =>
              io.updateFormat({ amount: { ...amount, inflow } }),
            )}
          </>
        )}
        {columnSelect("Notes (optional)", format.memo, (memo) => io.updateFormat({ memo }), true)}
        {columnSelect(
          "Bank transaction ID (prevents duplicates)",
          format.bankId,
          (bankId) => io.updateFormat({ bankId }),
          true,
        )}
      </div>
    </details>
  );
}

function PreviewDetails({ preview, io }: { preview: TransactionImportPreview; io: Import }) {
  const matched = matchCount(preview);
  return (
    <>
      <p role="status">
        {count(preview.rows.length, "new transaction")}
        {preview.firstDate && ` from ${preview.firstDate} to ${preview.lastDate}`}:{" "}
        <Money cents={preview.inflow} /> in, <Money cents={preview.outflow} /> out.
        {preview.duplicates.length > 0 &&
          ` ${count(preview.duplicates.length, "duplicate")} skipped.`}
        {preview.beforeOpening.length > 0 &&
          ` ${count(preview.beforeOpening.length, "row")} before the opening date skipped.`}
        {preview.invalid.length > 0 && ` ${count(preview.invalid.length, "invalid row")} skipped.`}
        {preview.markedIncome > 0 &&
          ` ${count(preview.markedIncome, "inflow")} will be marked Income by your rules.`}
        {matched > 0 && ` ${count(matched, "row")} will be matched to transactions you entered.`}
      </p>

      {preview.mostlyPositive && (
        <p className="notice">
          Most amounts are positive. If this is a credit card that lists purchases as positive, tick
          “flip signs” so spending shows as money out.
        </p>
      )}

      {preview.invalid.length > 0 && (
        <ul className="item-list" aria-label="Invalid rows">
          {preview.invalid.map((row) => (
            <li className="item" key={row.line}>
              <span className="item-title error-text">Line {row.line}</span>
              <span className="item-detail">{row.message}</span>
            </li>
          ))}
        </ul>
      )}

      {preview.rows.length > 0 && (
        <ul className="item-list" aria-label="Transactions to import">
          {preview.rows.slice(0, SHOWN_ROWS).map((row) => (
            <li className="item" key={row.line}>
              <span className="item-title">{row.payee || "(no description)"}</span>
              <strong>
                <Money cents={row.amount} />
              </strong>
              <span className="item-detail">{row.date}</span>
            </li>
          ))}
          {preview.rows.length > SHOWN_ROWS && (
            <li className="empty-state">…and {preview.rows.length - SHOWN_ROWS} more</li>
          )}
        </ul>
      )}

      <MatchList matches={preview.matches} io={io} />
      <SkippedList label="Duplicates skipped" rows={preview.duplicates} />
      <SkippedList
        label="Before the opening date (already in its balance)"
        rows={preview.beforeOpening}
      />
    </>
  );
}

function SkippedList({ label, rows }: { label: string; rows: SkippedImportRow[] }) {
  if (rows.length === 0) return null;
  return (
    <details className="import-skipped">
      <summary>
        {label} ({rows.length})
      </summary>
      <ul className="item-list" aria-label={label}>
        {rows.map((row) => (
          <li className="item" key={row.line}>
            <span className="item-title">{row.payee || "(no description)"}</span>
            <Money cents={row.amount} />
            <span className="item-detail">
              {row.date} · line {row.line} · {row.reason}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Bank rows that match a typed-in transaction. Matched, the typed transaction
 * becomes the bank's (cleared) and keeps what was entered; unticked, the row
 * is imported as a new transaction.
 */
function MatchList({ matches, io }: { matches: ImportMatch[]; io: Import }) {
  if (matches.length === 0) return null;
  const label = "Matched to transactions you entered";
  return (
    <details className="import-skipped" open>
      <summary>
        {label} ({matches.length})
      </summary>
      <ul className="item-list" aria-label={label}>
        {matches.map(({ row, tx, separate }) => (
          <li className="item" key={row.line}>
            <span className="item-title">{tx.payee || "(no payee)"}</span>
            <Money cents={tx.amount} />
            <span className="item-detail">
              You entered {tx.date} · bank: {row.date}, {row.payee || "(no description)"}
            </span>
            <label className="choice">
              <input
                type="checkbox"
                checked={!separate}
                aria-label={`Match ${row.payee || "line " + row.line} to ${tx.payee || "your transaction"}`}
                onChange={(e) => io.setMatched(row.line, e.target.checked)}
              />
              Match
            </label>
          </li>
        ))}
      </ul>
    </details>
  );
}
