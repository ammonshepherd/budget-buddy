import { useBudgetSummary } from "../../controllers/useBudgetSummary";

export function BudgetPage() {
  const summary = useBudgetSummary();
  return (
    <section className="page-view" aria-labelledby="budget-title">
      <header className="page-heading">
        <p className="eyebrow">{summary.monthLabel}</p>
        <h1 id="budget-title">Budget</h1>
        <p>Give every dollar a job before the month gets busy.</p>
      </header>

      <section className="hero-card" aria-label="Available to Assign">
        <span className="card-label">Available to Assign</span>
        <strong className="hero-amount">{summary.availableToAssign}</strong>
        <span className="card-helper">Ready to give a job</span>
      </section>

      <section className="summary-grid" aria-label="Budget summary">
        <article className="summary-card">
          <span>Assigned</span>
          <strong>{summary.assigned}</strong>
        </article>
        <article className="summary-card">
          <span>Remaining</span>
          <strong>{summary.remaining}</strong>
        </article>
      </section>

      <section className="list-card">
        <div className="section-heading">
          <h2>Envelopes</h2>
          <span className="section-count">0</span>
        </div>
        <p className="empty-state">Your envelopes will appear here once accounts are connected.</p>
      </section>
    </section>
  );
}
