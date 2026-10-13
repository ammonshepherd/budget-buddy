import { useState } from "react";
import { useAsyncAction } from "../controllers/useAsyncAction";
import type { Budget } from "../controllers/useBudget";
import { useTransactionImport } from "../controllers/useTransactionImport";
import type {
  DateOrder,
  ImportFormat,
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

/** Settings card: import a bank or card CSV into an account. */
export function TransactionImport({ budget, data }: { budget: Budget; data: BudgetData }) {
  const io = useTransactionImport(budget, data);
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
        give them envelopes on Activity.
      </p>

      <div className="form">
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
          Imported {io.done.added} {io.done.added === 1 ? "transaction" : "transactions"} into{" "}
          {io.done.accountName}
          {io.done.alreadyThere > 0 && ` (${io.done.alreadyThere} were already there)`}.{" "}
          <a href="#activity">Give them envelopes on Activity</a>
        </p>
      )}

      {format && (
        <div className="stack">
          <ColumnChoices io={io} format={format} />
          <ErrorMessage error={io.problem} />
          {preview && <PreviewDetails preview={preview} />}
          <div className="button-row">
            <button
              className="primary-button"
              type="button"
              disabled={save.pending || !preview || preview.rows.length === 0}
              onClick={async () => {
                if ((await save.run()).ok) setInputKey((k) => k + 1);
              }}
            >
              Import {preview?.rows.length ?? 0}{" "}
              {preview?.rows.length === 1 ? "transaction" : "transactions"}
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

function PreviewDetails({ preview }: { preview: TransactionImportPreview }) {
  const count = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;
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
