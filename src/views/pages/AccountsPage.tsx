export function AccountsPage() {
  return (
    <section className="page-view" aria-labelledby="accounts-title">
      <header className="page-heading">
        <p className="eyebrow">Your money sources</p>
        <h1 id="accounts-title">Accounts</h1>
        <p>See the accounts that provide money for your budget.</p>
      </header>

      <section className="list-card">
        <div className="section-heading">
          <h2>Your accounts</h2>
          <span className="section-count">0</span>
        </div>
        <p className="empty-state">
          Account balances will appear here once accounts are connected.
        </p>
      </section>
    </section>
  );
}
