export function ActivityPage() {
  return (
    <section className="page-view" aria-labelledby="activity-title">
      <header className="page-heading">
        <p className="eyebrow">Your spending trail</p>
        <h1 id="activity-title">Activity</h1>
        <p>Review transactions and keep your budget in sync with real life.</p>
      </header>

      <section className="list-card">
        <div className="section-heading">
          <h2>Recent activity</h2>
          <span className="section-count">0</span>
        </div>
        <p className="empty-state">Transactions will appear here once accounts are connected.</p>
      </section>
    </section>
  );
}
