import { useState } from "react";
import { useAsyncAction } from "../controllers/useAsyncAction";
import type { Budget } from "../controllers/useBudget";
import { useEnvelopePlanImport } from "../controllers/useEnvelopePlanImport";
import type { PlanPreviewRow } from "../models/envelopePlan";
import type { BudgetData } from "../models/types";
import { ErrorMessage, Money } from "./components";

/** Settings card: upload a CSV of envelopes and Planned amounts for one month. */
export function EnvelopePlanImport({ budget, data }: { budget: Budget; data: BudgetData }) {
  const plan = useEnvelopePlanImport(budget, data);
  const save = useAsyncAction(plan.importPlan);
  // Changing the key empties the file input after an import or a clear.
  const [inputKey, setInputKey] = useState(0);
  const { preview } = plan;

  const reset = () => {
    plan.clear();
    save.clearError();
    setInputKey((k) => k + 1);
  };

  return (
    <section className="list-card" aria-labelledby="plan-import-title">
      <div className="section-heading">
        <h2 id="plan-import-title">Import envelope plan</h2>
      </div>
      <p className="empty-state">
        Upload a CSV with the columns <strong>category, group, planned amount</strong>. Missing
        groups and envelopes are created, and each envelope’s Planned is set for the month you
        choose. Envelopes not in the file keep their Planned.
      </p>
      <pre className="csv-example" aria-label="Example CSV">
        {"category,group,planned amount\nRent,Bills,1200.00\nGroceries,Everyday,450\n"}
      </pre>

      <div className="form">
        <label className="field">
          Month
          <input
            type="month"
            value={plan.month}
            required
            onChange={(event) => plan.chooseMonth(event.target.value)}
          />
        </label>
        <label className="field">
          CSV file
          <input
            key={inputKey}
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              save.clearError();
              void plan.chooseFile(event.target.files?.[0] ?? null);
            }}
          />
        </label>
      </div>

      <ErrorMessage error={plan.error} />

      {plan.done && (
        <p className="notice" role="status">
          Imported {plan.done.count} {plan.done.count === 1 ? "envelope" : "envelopes"} for{" "}
          {plan.done.monthLabel}. <a href={plan.done.href}>Open that budget</a>
        </p>
      )}

      {preview && (
        <div className="stack">
          <p role="status">
            {preview.rows.length} {preview.rows.length === 1 ? "row" : "rows"} ready for{" "}
            {plan.monthLabel}: {preview.newGroups} new{" "}
            {preview.newGroups === 1 ? "group" : "groups"}, {preview.newEnvelopes} new{" "}
            {preview.newEnvelopes === 1 ? "envelope" : "envelopes"}.
            {preview.invalid.length > 0 &&
              ` ${preview.invalid.length} invalid ${preview.invalid.length === 1 ? "row" : "rows"} will be skipped.`}
          </p>

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
            <ul className="item-list" aria-label="Rows to import">
              {preview.rows.map((row) => (
                <li className="item" key={row.line}>
                  <span className="item-title">{row.envelope}</span>
                  <strong>
                    <Money cents={row.planned} />
                  </strong>
                  <span className="item-detail">
                    {row.group} · <RowChange row={row} />
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="button-row">
            <button
              className="primary-button"
              type="button"
              disabled={save.pending || preview.rows.length === 0}
              onClick={async () => {
                if ((await save.run()).ok) setInputKey((k) => k + 1);
              }}
            >
              Import {preview.rows.length} {preview.rows.length === 1 ? "row" : "rows"}
            </button>
            <button className="secondary-button" type="button" onClick={reset}>
              Cancel
            </button>
          </div>
          <ErrorMessage error={save.error} />
        </div>
      )}
    </section>
  );
}

function RowChange({ row }: { row: PlanPreviewRow }) {
  if (row.newGroup) return <>new group and envelope</>;
  if (row.newEnvelope) return <>new envelope</>;
  if (row.previousPlanned === row.planned) return <>no change</>;
  return (
    <>
      Planned was <Money cents={row.previousPlanned ?? 0} />
    </>
  );
}
