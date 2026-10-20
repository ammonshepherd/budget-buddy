import { useState } from "react";
import { useAsyncAction } from "../controllers/useAsyncAction";
import { useBackup } from "../controllers/useBackup";
import type { Budget } from "../controllers/useBudget";
import type { BackupSummary } from "../models/backup";
import { formatMonth } from "../models/month";
import type { BudgetData } from "../models/types";
import { ErrorMessage } from "./components";

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** "3 accounts, 40 envelopes, 101 transactions, 1 income rule; August – October 2026" */
function describe(summary: BackupSummary): string {
  const counts = [
    plural(summary.accounts, "account"),
    plural(summary.envelopes, "envelope"),
    plural(summary.transactions, "transaction"),
    plural(summary.incomeRules, "income rule"),
  ].join(", ");
  const { months } = summary;
  const first = months[0];
  const last = months[months.length - 1];
  if (!first || !last) return `${counts}; no months with transactions or plans`;
  const range =
    first === last ? formatMonth(first) : `${formatMonth(first)} – ${formatMonth(last)}`;
  return `${counts}; ${plural(months.length, "month")} with transactions or plans (${range})`;
}

/** Settings → Backup: export everything to a file, or restore one into an empty household. */
export function BackupSection({ budget, data }: { budget: Budget; data: BudgetData }) {
  const backup = useBackup(budget, data);
  const exportAll = useAsyncAction(backup.exportAll);
  const restore = useAsyncAction(backup.restore);
  // Changing the key empties the file input after a restore or a cancel.
  const [inputKey, setInputKey] = useState(0);
  const { chosen } = backup;

  return (
    <section className="list-card" aria-labelledby="backup-title">
      <div className="section-heading">
        <h2 id="backup-title">Backup</h2>
      </div>
      <p className="empty-state">
        Save everything in this household to one file: accounts (closed ones too), envelopes and
        groups, every month’s Planned, Assigned and Saved, all transactions with their envelopes,
        splits, transfers and reconciled marks, income rules and bank CSV settings.
      </p>
      <div className="button-row">
        <button
          className="primary-button"
          type="button"
          disabled={exportAll.pending}
          onClick={() => exportAll.run()}
        >
          Export all data
        </button>
      </div>
      <ErrorMessage error={exportAll.error} />
      {backup.exported && (
        <p className="notice" role="status">
          Saved {backup.exported.fileName}: {describe(backup.exported.summary)}.
        </p>
      )}

      <h3>Restore from a backup</h3>
      {backup.canRestore ? (
        <p className="empty-state">
          This household is empty, so a backup can be loaded into it. Everything in the file is
          added in one step, and the household takes the backup’s name.
        </p>
      ) : (
        <p className="empty-state">
          A backup can only be restored into an empty household (no accounts, envelopes or
          transactions yet), for example after signing up with a new account. You can still choose a
          file to check what it holds.
        </p>
      )}
      <div className="form">
        <label className="field">
          Backup file
          <input
            key={inputKey}
            type="file"
            accept=".json,application/json"
            onChange={(event) => {
              restore.clearError();
              void backup.chooseFile(event.target.files?.[0] ?? null);
            }}
          />
        </label>
      </div>
      <ErrorMessage error={backup.fileError} />

      {backup.restored && (
        <p className="notice" role="status">
          Restored {backup.restored.householdName}: {describe(backup.restored)}.
        </p>
      )}

      {chosen && (
        <div className="stack">
          <p role="status">
            {chosen.fileName} holds {chosen.summary.householdName}, saved{" "}
            {new Date(chosen.summary.exportedAt).toLocaleString("en-US")}:{" "}
            {describe(chosen.summary)}.
          </p>
          <div className="button-row">
            {backup.canRestore && (
              <button
                className="primary-button"
                type="button"
                disabled={restore.pending}
                onClick={async () => {
                  if ((await restore.run()).ok) setInputKey((k) => k + 1);
                }}
              >
                Restore this backup
              </button>
            )}
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                backup.clear();
                restore.clearError();
                setInputKey((k) => k + 1);
              }}
            >
              Cancel
            </button>
          </div>
          <ErrorMessage error={restore.error} />
        </div>
      )}
    </section>
  );
}
