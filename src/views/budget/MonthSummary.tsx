import type { BudgetPageState as Page } from "../../controllers/useBudgetPage";
import type { WatchItem } from "../../models/envelopeDetail";
import { Money, SpentAmount } from "../components";

/**
 * The desktop panel when no envelope is chosen: this month's income,
 * assigned, spent and saved, then envelopes worth a look (each opens in the
 * panel). Display only.
 */
export function MonthSummary({
  page,
  onOpen,
}: {
  page: Page;
  onOpen: (envelopeId: string) => void;
}) {
  const { view, watch } = page;
  return (
    <div className="month-summary">
      <header>
        <h2>{page.monthLabel}</h2>
        <p className="empty-state">This month at a glance</p>
      </header>
      <dl className="summary-stats">
        <div className="summary-stat income">
          <dt>Income</dt>
          <dd>
            <Money cents={view.income} />
          </dd>
        </div>
        <div className="summary-stat">
          <dt>Assigned</dt>
          <dd>
            <Money cents={view.totals.assigned} />
          </dd>
        </div>
        <div className="summary-stat">
          <dt>Spent</dt>
          <dd>
            <SpentAmount cents={view.totals.spent} />
          </dd>
        </div>
        <div className="summary-stat saved">
          <dt>In Saved</dt>
          <dd>
            <Money cents={view.totals.saved} />
          </dd>
        </div>
      </dl>
      <WatchList title="Spent over Planned" items={watch.overPlan} suffix=" over" onOpen={onOpen} />
      <WatchList title="Short" items={watch.short} onOpen={onOpen} />
      <WatchList title="Card debt not covered" items={watch.uncoveredDebt} onOpen={onOpen} />
      <p className="panel-hint">Choose an envelope to see its details here.</p>
    </div>
  );
}

function WatchList({
  title,
  items,
  suffix = "",
  onOpen,
}: {
  title: string;
  items: WatchItem[];
  suffix?: string;
  onOpen: (envelopeId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="watch-list" aria-label={title}>
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => onOpen(item.id)}>
              <span>{item.name}</span>
              <strong>
                <Money cents={item.amount} />
                {suffix}
              </strong>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
