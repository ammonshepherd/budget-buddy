import { useRef, useState, type KeyboardEvent } from "react";
import { messageOf } from "../../controllers/errors";
import type { Budget } from "../../controllers/useBudget";
import { useAsyncAction } from "../../controllers/useAsyncAction";
import { useBudgetPage } from "../../controllers/useBudgetPage";
import { useCollapsedGroups } from "../../controllers/useCollapsedGroups";
import { useCompactRows, useSidebar } from "../../controllers/useLayout";
import { formFromTransaction } from "../../controllers/useTransactionEntry";
import { envelopeLeft, type EnvelopeRow } from "../../models/budgetMath";
import { centsToInput, formatCents, formatSignedCents } from "../../models/money";
import type { Month } from "../../models/month";
import type { WatchItem } from "../../models/envelopeDetail";
import { accountsHref } from "../../models/routes";
import type { BudgetData } from "../../models/types";
import { ErrorMessage, Money, Sheet, SingleFieldForm } from "../components";
import { AssignFromAvailable } from "../AssignFromAvailable";
import { PadAmount } from "../AssignPad";
import { CardDebt } from "../CardDebt";
import { EnvelopePlanImport } from "../EnvelopePlanImport";
import { EnvelopeSheet } from "../EnvelopeSheet";
import { MoveFromEnvelope } from "../MoveFromEnvelope";
import { ChevronDownIcon, EnvelopeIcon } from "../icons";
import { SidePanel } from "../SidePanel";
import { TransactionDialog, TransactionEntry } from "../TransactionEntry";

type Page = ReturnType<typeof useBudgetPage>;
type Group = Page["groups"][number];

export function BudgetPage({
  budget,
  data,
  month,
  userId,
  desktop = false,
}: {
  budget: Budget;
  data: BudgetData;
  month: Month;
  userId: string;
  /**
   * The desktop layout: the month and Available to Assign share one band,
   * envelopes are one-line table rows, and the envelope (or a transaction
   * being edited) shows in a panel on the right instead of a sheet.
   */
  desktop?: boolean;
}) {
  const page = useBudgetPage(budget, data, month);
  const collapse = useCollapsedGroups(
    userId,
    data.groups.map((g) => g.id),
  );
  const { view } = page;
  // The envelope whose sheet is open; it closes by itself if the envelope goes.
  const [openId, setOpenId] = useState<string | null>(null);
  const detail = openId ? page.detail(openId) : null;
  const over = view.overAssigned > 0;
  const [uploading, setUploading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  // The envelope whose left amount was tapped: the move dialog is open for it.
  const [movingId, setMovingId] = useState<string | null>(null);
  const moving = movingId ? (page.detail(movingId)?.row ?? null) : null;
  // A transaction tapped in the envelope sheet; the dialog closes if it goes.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = editingId ? page.transaction(editingId) : undefined;
  const panel = useSidebar("panel", userId);
  // Phone only: rows down to name, Saved and what is left (desktop rows are one line).
  const rows = useCompactRows(userId);
  const compact = !desktop && rows.compact;
  const openEnvelope = (id: string) => {
    setOpenId(id);
    setEditingId(null);
    if (desktop) panel.expand();
  };
  const closeEnvelope = () => {
    setOpenId(null);
    setEditingId(null);
  };

  const monthNav = (
    <div className="budget-month month-nav">
      <a href={page.previousHref} aria-label="Previous month">
        ‹
      </a>
      <span>{page.monthLabel}</span>
      <a href={page.nextHref} aria-label="Next month">
        ›
      </a>
    </div>
  );
  // Hidden when there is nothing left to assign (but shown when over assigned).
  // Tapping it opens a dialog to assign to an envelope (or take back, when over).
  const assignCard = view.availableToAssign !== 0 && (
    <section className={over ? "assign-card over" : "assign-card"} aria-label="Available to Assign">
      <button type="button" aria-haspopup="dialog" onClick={() => setAssigning(true)}>
        <span className="assign-label">{over ? "Over Assigned" : "Available to Assign"}</span>
        <Money cents={over ? view.overAssigned : view.availableToAssign} />
      </button>
    </section>
  );
  const groups = page.groups.map((group) => (
    <GroupSection
      key={group.id}
      group={group}
      page={page}
      collapsed={collapse.isCollapsed(group.id)}
      onToggle={() => collapse.toggle(group.id)}
      onExpand={() => collapse.expand(group.id)}
      onOpen={openEnvelope}
      onMove={setMovingId}
      desktop={desktop}
      selectedId={desktop ? openId : null}
    />
  ));
  const unusedToggle = view.unusedCount > 0 && (
    <p className="unused-toggle">
      <button className="text-button" type="button" onClick={page.toggleUnused}>
        {page.showUnused
          ? "Hide envelopes not used this month"
          : `Show ${view.unusedCount} ${view.unusedCount === 1 ? "envelope" : "envelopes"} not used this month`}
      </button>
    </p>
  );
  /** Desktop: back from editing a transaction to its envelope. */
  const stopEditing = () => setEditingId(null);

  return (
    <section
      className={compact ? "page-view budget-page compact-rows" : "page-view budget-page"}
      aria-labelledby="budget-title"
    >
      {/* Read by screen readers; the envelopes get the screen space. */}
      <h1 id="budget-title" className="visually-hidden">
        Budget
      </h1>

      {desktop ? (
        // One band for both, pinned to the top while the envelopes scroll.
        <div className="budget-band">
          {monthNav}
          {assignCard}
        </div>
      ) : (
        <>
          {monthNav}
          <div className="budget-band-tools">
            <button
              className="compact-toggle"
              type="button"
              aria-pressed={compact}
              onClick={rows.toggle}
            >
              <span className="compact-switch" aria-hidden="true" />
              Compact rows
            </button>
          </div>
          <CardDebt data={data} />
          {/* Stays at the top while the envelopes scroll under it. */}
          {assignCard && <div className="assign-wrap">{assignCard}</div>}
        </>
      )}
      {desktop && <CardDebt data={data} />}

      {view.toReview.count > 0 && (
        <p className="notice compact">
          {view.toReview.count} {view.toReview.count === 1 ? "transaction" : "transactions"} to
          review (<Money cents={view.toReview.inflow} /> in, <Money cents={view.toReview.outflow} />{" "}
          out) {view.toReview.count === 1 ? "is" : "are"} not in Available to Assign yet.{" "}
          <a href={accountsHref("all", month)}>Review them in All accounts</a>.
        </p>
      )}

      {data.accounts.length === 0 && (
        <p className="notice compact">
          Start by <a href="#accounts">adding an account</a>; its balance becomes money to assign.
        </p>
      )}

      {view.groups.length === 0 && (
        <p className="notice compact">
          No envelopes yet. <a href="#settings">Add an envelope group in Settings</a>, then add
          envelopes to it here with its + button.
        </p>
      )}

      {page.planStart && <PlanStart page={page} onUpload={() => setUploading(true)} />}

      {desktop ? (
        <div className="budget-work">
          <div className="envelope-table">
            {page.groups.length > 0 && (
              <div className="envelope-colhead" aria-hidden="true">
                <span>Envelope</span>
                <span>Planned</span>
                <span>Assigned</span>
                <span>Spent</span>
                <span>Remaining</span>
              </div>
            )}
            {groups}
            {unusedToggle}
          </div>
          <SidePanel
            label={detail ? `${detail.row.name} envelope` : `${page.monthLabel} summary`}
            collapsed={panel.collapsed}
            onToggle={panel.toggle}
          >
            {editing ? (
              <div className="panel-edit">
                <button className="text-button panel-back" type="button" onClick={stopEditing}>
                  ‹ Back to {detail ? detail.row.name : "the summary"}
                </button>
                <TransactionEntry
                  key={editing.id}
                  budget={budget}
                  data={data}
                  initial={formFromTransaction(editing, data)}
                  heading="Edit transaction"
                  onDone={stopEditing}
                  onCancel={stopEditing}
                  onDelete={async () => {
                    await page.deleteTransaction(editing.id);
                    stopEditing();
                  }}
                />
              </div>
            ) : detail ? (
              <EnvelopeSheet
                key={detail.row.id}
                detail={detail}
                page={page}
                docked
                onClose={closeEnvelope}
                onEditTransaction={setEditingId}
              />
            ) : (
              <MonthSummary page={page} onOpen={openEnvelope} />
            )}
          </SidePanel>
        </div>
      ) : (
        <>
          {groups}
          {unusedToggle}
        </>
      )}

      <Sheet
        open={!desktop && detail !== null}
        label={`${detail?.row.name ?? "Envelope"} envelope`}
        className="sheet bottom"
        onClose={closeEnvelope}
      >
        {() => (
          <EnvelopeSheet
            detail={detail!}
            page={page}
            onClose={() => setOpenId(null)}
            onEditTransaction={setEditingId}
          />
        )}
      </Sheet>

      {/* Opens over the envelope sheet, which stays open underneath. */}
      <TransactionDialog
        budget={budget}
        data={data}
        open={!desktop && editing !== undefined}
        heading="Edit transaction"
        initial={() => formFromTransaction(editing!, data)}
        onClose={() => setEditingId(null)}
        onDelete={async () => {
          if (editing) await page.deleteTransaction(editing.id);
        }}
      />

      <Sheet
        open={assigning}
        label="Assign money"
        className="sheet assign-sheet"
        onClose={() => setAssigning(false)}
      >
        {() => <AssignFromAvailable page={page} onDone={() => setAssigning(false)} />}
      </Sheet>

      <Sheet
        open={moving !== null}
        label="Move money"
        className="sheet assign-sheet"
        onClose={() => setMovingId(null)}
      >
        {() => <MoveFromEnvelope page={page} from={moving!} onDone={() => setMovingId(null)} />}
      </Sheet>

      <Sheet
        open={uploading}
        label={`Upload a plan for ${page.monthLabel}`}
        className="sheet bottom"
        onClose={() => setUploading(false)}
      >
        {() => (
          <div className="envelope-sheet">
            <div className="sheet-handle" aria-hidden="true" />
            <header className="sheet-header">
              <span className="sheet-eyebrow">Plan for {page.monthLabel}</span>
              <button
                className="sheet-close"
                type="button"
                aria-label="Close"
                onClick={() => setUploading(false)}
              >
                ×
              </button>
            </header>
            <EnvelopePlanImport
              budget={budget}
              data={data}
              month={month}
              onDone={() => {
                setUploading(false);
                page.planStarted();
              }}
            />
          </div>
        )}
      </Sheet>
    </section>
  );
}

/**
 * Shown when the month opens with no plan (every Planned at $0.00): start it
 * from last month's Planned or Spent, or from a plan CSV. Copy buttons appear
 * only when last month has something to copy.
 */
function PlanStart({ page, onUpload }: { page: Page; onUpload: () => void }) {
  const copy = useAsyncAction(page.copyPlan);
  const start = page.planStart!;
  return (
    <section className="plan-start" aria-labelledby="plan-start-title">
      <h2 id="plan-start-title">No plan for {page.monthLabel} yet</h2>
      <p>Fill in Planned for every envelope at once, then adjust it here.</p>
      <div className="plan-start-actions">
        {start.planned.length > 0 && (
          <button
            className="secondary-button"
            type="button"
            disabled={copy.pending}
            onClick={() => void copy.run("planned")}
          >
            Copy {start.previousLabel}’s Planned
          </button>
        )}
        {start.spent.length > 0 && (
          <button
            className="secondary-button"
            type="button"
            disabled={copy.pending}
            onClick={() => void copy.run("spent")}
          >
            Copy {start.previousLabel}’s Spent
          </button>
        )}
        <button className="secondary-button" type="button" onClick={onUpload}>
          Upload a plan CSV
        </button>
      </div>
      <ErrorMessage error={copy.error} />
    </section>
  );
}

/**
 * A group: a bar whose name collapses or expands its envelopes (collapsed, it
 * shows how many and their total left) and a + to add an envelope.
 */
function GroupSection({
  group,
  page,
  collapsed,
  onToggle,
  onExpand,
  onOpen,
  onMove,
  desktop,
  selectedId,
}: {
  group: Group;
  page: Page;
  collapsed: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onOpen: (envelopeId: string) => void;
  /** Opens the move dialog for an envelope (its left amount was tapped). */
  onMove: (envelopeId: string) => void;
  desktop: boolean;
  /** The envelope shown in the desktop panel. */
  selectedId: string | null;
}) {
  const [adding, setAdding] = useState(false);
  const rows = useRef<HTMLDivElement>(null);
  const rowsId = `group-rows-${group.id}`;
  const count = group.envelopes.length;

  const toggle = () => {
    // A Planned or Assigned field open in this group saves before it is hidden.
    const active = document.activeElement;
    if (active instanceof HTMLElement && rows.current?.contains(active)) active.blur();
    onToggle();
  };

  return (
    <section
      className={collapsed ? "budget-group collapsed" : "budget-group"}
      aria-label={group.name}
    >
      <div className="group-heading">
        <h2>
          <button
            className="group-toggle"
            type="button"
            aria-expanded={!collapsed}
            aria-controls={rowsId}
            onClick={toggle}
          >
            <ChevronDownIcon />
            <span className="group-name">{group.name}</span>
            {collapsed && (
              <span className="group-summary">
                {count} {count === 1 ? "envelope" : "envelopes"}
              </span>
            )}
          </button>
        </h2>
        {collapsed && (
          <span className="group-total">
            <Money cents={group.left} />
            <span className="visually-hidden"> remaining</span>
          </span>
        )}
        <button
          className="add-envelope-button"
          type="button"
          aria-label={adding ? `Stop adding to ${group.name}` : `Add envelope to ${group.name}`}
          aria-expanded={adding}
          onClick={() => {
            // Opens the group too, so the new envelope shows up.
            if (!adding) onExpand();
            setAdding((open) => !open);
          }}
        >
          {adding ? "×" : "+"}
        </button>
      </div>
      {adding && (
        <div className="group-add">
          <SingleFieldForm
            label="New envelope"
            button="Add envelope"
            inputMode="text"
            onSubmit={(name) => page.addEnvelope(group.id, name)}
          />
        </div>
      )}
      <div id={rowsId} ref={rows} hidden={collapsed}>
        {count > 0 ? (
          <ul className="envelope-list">
            {group.envelopes.map((envelope) => (
              <li key={envelope.id}>
                <EnvelopeItem
                  envelope={envelope}
                  page={page}
                  onOpen={() => onOpen(envelope.id)}
                  onMove={() => onMove(envelope.id)}
                  desktop={desktop}
                  selected={envelope.id === selectedId}
                />
              </li>
            ))}
          </ul>
        ) : (
          !adding && <p className="empty-state group-empty">No envelopes yet. Tap + to add one.</p>
        )}
      </div>
    </section>
  );
}

/**
 * One envelope: name, Saved and what is left; then Planned (tap to edit in
 * place), Assigned (tap for the number pad) and Spent. Tapping the top line opens its sheet.
 * On a desktop it is one table row (name and Saved, Planned, Assigned,
 * Spent, Remaining) and the name shows the envelope in the panel.
 * Tapping what is left opens the move dialog (when some can be moved).
 */
function EnvelopeItem({
  envelope,
  page,
  onOpen,
  onMove,
  desktop,
  selected,
}: {
  envelope: EnvelopeRow;
  page: Page;
  onOpen: () => void;
  onMove: () => void;
  desktop: boolean;
  selected: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const card = envelope.card;
  const left = envelopeLeft(envelope);

  const save = (action: (id: string, text: string) => Promise<void>) => async (text: string) => {
    setError(null);
    try {
      await action(envelope.id, text);
    } catch (e) {
      setError(messageOf(e));
    }
  };

  const leftClass = left === 0 ? "envelope-left zero" : "envelope-left";
  const leftContent = (
    <>
      <span className="envelope-remaining">
        <Money cents={left} />
      </span>
      <span className="visually-hidden">{card ? " available to pay" : " remaining"}</span>
    </>
  );
  // A button when some can be moved out (not a card's envelope, not a past month).
  const leftAmount =
    page.movable(envelope.id) > 0 ? (
      <button
        className={`${leftClass} movable`}
        type="button"
        aria-haspopup="dialog"
        aria-label={`Move money from ${envelope.name}: ${formatCents(left)} remaining`}
        onClick={onMove}
      >
        {leftContent}
      </button>
    ) : (
      <span className={leftClass}>{leftContent}</span>
    );
  const classes = ["envelope", envelope.inUse ? "" : "unused", selected ? "selected" : ""];

  return (
    <div className={classes.join(" ").trim()}>
      <div className="envelope-head">
        <button
          className="envelope-top"
          type="button"
          aria-haspopup={desktop ? undefined : "dialog"}
          aria-expanded={desktop ? selected : undefined}
          onClick={onOpen}
        >
          <EnvelopeIcon />
          <span className="envelope-title">
            <span className="envelope-name">
              {envelope.name}
              {!envelope.inUse && <small> · not used this month</small>}
            </span>
            {!card && <SavedChip cents={envelope.saved} />}
          </span>
        </button>
        {/* On a desktop, what is left is the row's last column instead. */}
        {!desktop && leftAmount}
      </div>

      {card ? (
        <div className="envelope-cells two">
          <span className="cell">
            <span className="cell-label">Available to pay</span>{" "}
            <Money cents={envelope.envelopeMoney} />
          </span>
          <span className={card.uncovered > 0 ? "cell debt" : "cell"}>
            <span className="cell-label">Remaining debt</span> <Money cents={card.uncovered} />
          </span>
        </div>
      ) : (
        <div className="envelope-cells">
          <EditableCell
            className="cell planned"
            label="Planned"
            what="planned"
            envelopeName={envelope.name}
            cents={envelope.planned}
            onSave={save(page.setPlanned)}
          />
          {desktop ? (
            // Typed in place; "+50" or "120 + 50" adds to what is there.
            <EditableCell
              className="cell assigned"
              label="Assigned"
              what="assigned"
              envelopeName={envelope.name}
              cents={envelope.assigned}
              onSave={save(page.setAssigned)}
            />
          ) : (
            // A phone: the number pad, with + and − to add to or take from it.
            <PadAmount
              className="cell assigned"
              labelClassName="cell-label"
              label="Assigned"
              envelopeName={envelope.name}
              cents={envelope.assigned}
              onSave={(text) => page.setAssigned(envelope.id, text)}
            />
          )}
          <span className={envelope.overPlan ? "cell spent over" : "cell spent"}>
            {/* Orange when over Planned; screen readers hear it in words. */}
            <span className="cell-label">
              Spent{envelope.overPlan && <span className="visually-hidden"> (over Planned)</span>}
            </span>{" "}
            {/* Money out of the envelope, so shown with a minus (not red). */}
            <span className="money">{formatSignedCents(-envelope.outflow)}</span>
          </span>
        </div>
      )}
      {desktop && leftAmount}

      {(envelope.refunded > 0 || envelope.shortfall > 0) && (
        <p className="envelope-extra">
          {envelope.refunded > 0 && (
            <span>
              Refunded <Money cents={envelope.refunded} />
            </span>
          )}
          {envelope.shortfall > 0 && (
            <span className="short">
              Short <Money cents={envelope.shortfall} />
            </span>
          )}
        </p>
      )}
      <ErrorMessage error={error} />
    </div>
  );
}

/**
 * A Planned or Assigned amount that turns into a text field when tapped.
 * Leaving the field (tapping anywhere else) or Enter saves; Escape cancels.
 */
function EditableCell({
  className,
  label,
  what,
  envelopeName,
  cents,
  onSave,
}: {
  className: string;
  label: string;
  what: string;
  envelopeName: string;
  cents: number;
  onSave: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Enter and Escape end editing themselves; the blur that follows must not save again.
  const finished = useRef(false);

  const finish = (saveIt: boolean, refocus: boolean) => {
    if (finished.current || text === null) return;
    finished.current = true;
    const typed = text;
    setText(null);
    if (saveIt) void onSave(typed);
    // Back to the cell, unless the tap that ended editing went somewhere else.
    if (refocus) requestAnimationFrame(() => button.current?.focus());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true, true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false, true);
    }
  };

  if (text !== null) {
    return (
      <label className={`${className} editing`}>
        <span className="cell-label">{label}</span>
        <input
          aria-label={`${label} amount for ${envelopeName}`}
          inputMode="decimal"
          autoFocus
          value={text}
          onFocus={(event) => event.target.select()}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => finish(true, false)}
        />
      </label>
    );
  }
  return (
    <button
      ref={button}
      className={className}
      type="button"
      aria-label={`Edit ${what} amount for ${envelopeName}, currently ${formatCents(cents)}`}
      onClick={() => {
        finished.current = false;
        setText(centsToInput(cents));
      }}
    >
      <span className="cell-label">{label}</span> <Money cents={cents} />
    </button>
  );
}

const STAR = "M12 1l2.6 8.4L23 12l-8.4 2.6L12 23l-2.6-8.4L1 12l8.4-2.6z";

const Star = ({ size, fill, className }: { size: number; fill: string; className?: string }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d={STAR} fill={fill} />
  </svg>
);

const GOLD = "#F3D36B";
const LILAC = "#B48BE0";

/** The six sparkles around a Saved chip, each placed by its class (sp1–sp6). */
const SPARKLES = [
  { size: 12, fill: GOLD },
  { size: 7, fill: LILAC },
  { size: 8, fill: LILAC },
  { size: 7, fill: GOLD },
  { size: 6, fill: LILAC },
  { size: 5, fill: "#FFFFFF" },
];

/**
 * Saved as a pill on the name line. Once money is saved it is the row's most
 * eye-catching part (solid purple, a star and sparkles), to encourage
 * saving; at $0.00 it is quiet.
 */
function SavedChip({ cents }: { cents: number }) {
  if (cents <= 0) {
    return (
      <span className="saved-chip">
        Saved <Money cents={cents} />
      </span>
    );
  }
  return (
    <span className="saved-chip sparkle">
      <Star size={15} fill={GOLD} className="star" />
      Saved <Money cents={cents} />
      {SPARKLES.map((star, i) => (
        <Star key={i} {...star} className={`star sp sp${i + 1}`} />
      ))}
    </span>
  );
}

/**
 * The desktop panel when no envelope is chosen: this month's income,
 * assigned, spent and saved, then envelopes worth a look (each opens in the
 * panel). Display only.
 */
function MonthSummary({ page, onOpen }: { page: Page; onOpen: (envelopeId: string) => void }) {
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
            <Money cents={view.totals.spent} />
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
