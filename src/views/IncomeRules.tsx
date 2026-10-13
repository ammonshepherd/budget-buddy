import { useState, type FormEvent } from "react";
import { useAsyncAction } from "../controllers/useAsyncAction";
import type { Budget } from "../controllers/useBudget";
import { useIncomeRules } from "../controllers/useIncomeRules";
import type { BudgetData } from "../models/types";
import { ErrorMessage } from "./components";

/** Settings card: rules that mark payroll and other deposits as Income. */
export function IncomeRules({ budget, data }: { budget: Budget; data: BudgetData }) {
  const page = useIncomeRules(budget, data);
  const [pattern, setPattern] = useState("");
  const [accountId, setAccountId] = useState("");
  const add = useAsyncAction(page.addRule);
  const remove = useAsyncAction(page.deleteRule);
  const apply = useAsyncAction(page.applyRules);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if ((await add.run(pattern, accountId)).ok) setPattern("");
  };

  return (
    <section className="list-card" aria-labelledby="income-rules-title">
      <div className="section-heading">
        <h2 id="income-rules-title">Income rules</h2>
        <span className="section-count">{page.rules.length}</span>
      </div>
      <p className="empty-state">
        Deposits whose description contains a rule’s text are marked Income when you import them, so
        they go straight to Available to Assign. Use a word from your paycheck, such as “PAYROLL” or
        your employer’s name.
      </p>

      {page.rules.length > 0 && (
        <ul className="item-list" aria-label="Income rules">
          {page.rules.map((rule) => (
            <li className="item" key={rule.id}>
              <span className="item-title">Contains “{rule.pattern}”</span>
              <button
                className="text-button danger"
                type="button"
                disabled={remove.pending}
                onClick={() => void remove.run(rule.id)}
              >
                Delete
              </button>
              <span className="item-detail">{rule.accountName}</span>
            </li>
          ))}
        </ul>
      )}
      <ErrorMessage error={remove.error} />

      <form className="form" onSubmit={submit} aria-label="Add an income rule">
        <label className="field">
          Description contains
          <input
            value={pattern}
            placeholder="PAYROLL"
            onChange={(e) => {
              setPattern(e.target.value);
              add.clearError();
            }}
          />
        </label>
        <label className="field">
          In account
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Any account</option>
            {page.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <button className="primary-button" type="submit" disabled={add.pending}>
          Add rule
        </button>
        <ErrorMessage error={add.error} />
      </form>

      {page.matchingCount > 0 && (
        <div className="notice stack" role="status">
          <span>
            {page.matchingCount} {page.matchingCount === 1 ? "inflow" : "inflows"} waiting for
            review {page.matchingCount === 1 ? "matches" : "match"} your rules.
          </span>
          <button
            className="secondary-button"
            type="button"
            disabled={apply.pending}
            onClick={() => void apply.run()}
          >
            Mark {page.matchingCount === 1 ? "it" : "them"} as Income
          </button>
          <ErrorMessage error={apply.error} />
        </div>
      )}
    </section>
  );
}
