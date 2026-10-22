import { useState } from "react";
import type { Budget } from "../../controllers/useBudget";
import { useBudgetPage } from "../../controllers/useBudgetPage";
import { useCollapsedGroups } from "../../controllers/useCollapsedGroups";
import { useCompactRows, useSidebar } from "../../controllers/useLayout";
import { formFromTransaction } from "../../controllers/useTransactionEntry";
import type { Month } from "../../models/month";
import { accountsHref } from "../../models/routes";
import type { BudgetData } from "../../models/types";
import { Money, Sheet } from "../components";
import { AssignFromAvailable } from "../AssignFromAvailable";
import { CardDebt } from "../CardDebt";
import { EnvelopePlanImport } from "../EnvelopePlanImport";
import { EnvelopeSheet } from "../EnvelopeSheet";
import { MoveFromEnvelope } from "../MoveFromEnvelope";
import { SidePanel } from "../SidePanel";
import { TransactionDialog, TransactionEntry } from "../TransactionEntry";
import { GroupSection } from "../budget/GroupSection";
import { MonthSummary } from "../budget/MonthSummary";
import { PlanStart } from "../budget/PlanStart";

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
