import { useRef, useState, type ReactNode } from "react";
import type { useAccountsPage } from "../controllers/useAccountsPage";
import { ROWS_PER_PAGE, useAccountView } from "../controllers/useAccountView";
import type { Budget } from "../controllers/useBudget";
import { useAccountPaneCollapsed, useSidebar } from "../controllers/useLayout";
import { formFromTransaction } from "../controllers/useTransactionEntry";
import { formatCents, formatSignedCents } from "../models/money";
import type { Month } from "../models/month";
import { accountsHref } from "../models/routes";
import type { BudgetData, Transaction } from "../models/types";
import { EditAccount } from "./AccountForm";
import { CardDebt } from "./CardDebt";
import { Sheet } from "./components";
import { ArrowLeftIcon, PencilIcon } from "./icons";
import { MenuGroup, MenuItem, PageMenu } from "./PageMenu";
import { SidePanel } from "./SidePanel";
import { TransactionDialog, TransactionEntry } from "./TransactionEntry";
import { TransactionImport } from "./TransactionImport";
import { TransactionList } from "./transactions/TransactionList";
import { TransactionSearch } from "./transactions/TransactionSearch";
import { NewTransactionRow, ReviewCard, SelectionBar } from "./transactions/TransactionTools";

type Page = ReturnType<typeof useAccountsPage>;

/** What the desktop panel (or a sheet on a phone) holds besides a transaction being edited. */
type Tool = "review" | "edit" | "import";

/**
 * Accounts with something open: All accounts (one month, like the old
 * Activity page) or one account (all its transactions). An info pane pinned
 * to the top holds the back arrow, the figures, and for an open account the
 * pencil (edit) and Import CSV; To review and the transaction list follow.
 * An open account adds a search field and sort menu, pinned between the
 * pane and the ticked-rows bar; while a search is on, To review steps
 * aside so only the matches show.
 * On a desktop, editing (a transaction or the account), importing and To
 * review sit in the panel on the right, and Add transaction opens a new row
 * at the top of the list.
 * On a phone the page menu folds every day to its heading (each day heading
 * also folds its own day), collapses the info pane to the balance, and for
 * an open account sorts the list.
 */
export function AccountView({
  budget,
  data,
  page,
  month,
  accountId,
  userId,
  desktop,
  addRequest,
}: {
  budget: Budget;
  data: BudgetData;
  page: Page;
  month: Month;
  /** The open account; null for All accounts. */
  accountId: string | null;
  userId: string;
  desktop: boolean;
  /** Goes up each time the sidebar's Add transaction is clicked (desktop). */
  addRequest: number;
}) {
  const view = useAccountView(budget, data, month, accountId);
  const account = view.account;
  /** The open account's row, with what the edit form needs; null when closed (read only). */
  const editable = page.openAccounts.find((a) => a.id === accountId) ?? null;
  const panel = useSidebar("panel", userId);
  const pencil = useRef<HTMLButtonElement>(null);
  const listHref = accountsHref(null, month);

  /** The transaction open in the edit dialog (in the panel on a desktop). */
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [tool, setTool] = useState<Tool>("review");
  const edit = (tx: Transaction) => {
    setEditing(tx);
    if (desktop) panel.expand();
  };
  const openTool = (next: Tool) => {
    setEditing(null);
    setTool(next);
    if (desktop) panel.expand();
  };
  /** Back to To review; focus returns to the pencil (a <dialog> does that by itself). */
  const closeTool = () => {
    const wasEdit = tool === "edit";
    setTool("review");
    if (desktop && wasEdit) pencil.current?.focus();
  };

  // The new transaction row (desktop): opened by Add transaction, closed by
  // adding, Cancel or Escape. (A click seen while rendering, like lastMonth in App.)
  const [adding, setAdding] = useState(false);
  const [addsSeen, setAddsSeen] = useState(addRequest);
  if (addRequest !== addsSeen) {
    setAddsSeen(addRequest);
    setAdding(true);
  }

  // Folded days: all of them after "Collapse all dates", except those tapped
  // open (or, with none folded, just those tapped shut). Not remembered.
  const [folds, setFolds] = useState({
    all: false,
    flipped: new Set<string>() as ReadonlySet<string>,
  });
  const isFolded = (date: string) => folds.all !== folds.flipped.has(date);
  const toggleDay = (date: string) =>
    setFolds((f) => {
      const flipped = new Set(f.flipped);
      if (!flipped.delete(date)) flipped.add(date);
      return { ...f, flipped };
    });
  const paneFold = useAccountPaneCollapsed(userId);
  const paneCollapsed = paneFold.collapsed && !desktop;

  /** Splits the user closed (they start open). */
  const [closedSplits, setClosedSplits] = useState<ReadonlySet<string>>(new Set());
  const toggleSplit = (id: string) =>
    setClosedSplits((closed) => {
      const next = new Set(closed);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  if (accountId !== null && !account) {
    return (
      <p className="notice activity-notice">
        That account is not in this household. <a href={listHref}>Back to accounts</a>
      </p>
    );
  }

  const title = account?.name ?? "All accounts";
  const monthNav = (
    <div className="budget-month month-nav">
      <a href={view.previousHref} aria-label="Previous month">
        ‹
      </a>
      <span>{view.monthLabel}</span>
      <a href={view.nextHref} aria-label="Next month">
        ›
      </a>
    </div>
  );

  const pane = (
    <section className="account-pane" aria-labelledby="account-pane-title">
      <div className="account-pane-head">
        <a className="pane-icon-button pane-back" href={listHref} aria-label="Back to accounts">
          <ArrowLeftIcon />
        </a>
        <h2 id="account-pane-title">
          {title}
          {account?.closedAt && <span className="account-closed-tag">Closed</span>}
        </h2>
        {editable && (
          <button
            ref={pencil}
            className="pane-icon-button"
            type="button"
            aria-label={`Edit ${editable.name}`}
            onClick={() => openTool("edit")}
          >
            <PencilIcon />
          </button>
        )}
      </div>
      {paneCollapsed ? (
        <dl className="account-figures folded" aria-label={`${title} balance`}>
          {view.figures ? (
            <Figure label="Current balance" cents={view.figures.current} />
          ) : (
            <Figure label="Balance today" cents={view.balance.today} />
          )}
        </dl>
      ) : view.figures ? (
        <dl className="account-figures" aria-label={`${title} figures for ${view.monthLabel}`}>
          <Figure label="Money in" cents={view.figures.moneyIn} signed tone="in" />
          <Figure label="Money out" cents={-view.figures.moneyOut} signed tone="out" />
          <Figure label="Current balance" cents={view.figures.current} />
          {view.figures.extraPaid === null ? (
            <Figure label="Opening balance" cents={view.figures.opening} />
          ) : (
            <Figure label="Extra paid" cents={view.figures.extraPaid} />
          )}
          <Figure label="Month start" cents={view.figures.monthStart} />
          <Figure label="Reconciled" cents={view.figures.reconciled} />
        </dl>
      ) : (
        <AllAccountsTotals view={view} />
      )}
      {editable && !paneCollapsed && (
        <div className="account-actions">
          <button className="pane-action" type="button" onClick={() => openTool("import")}>
            Import CSV
          </button>
        </div>
      )}
    </section>
  );

  const list = (
    <TransactionList
      days={view.days}
      months={account ? view.months : undefined}
      flatRows={view.flatRows}
      highlightEnvelopeId={view.search.envelopeId}
      leftCount={view.leftCount}
      pageSize={ROWS_PER_PAGE}
      onShowMore={view.showMore}
      emptyText={
        view.search.searching
          ? "No transactions match."
          : account
            ? `No transactions in ${account.name} yet.`
            : `No transactions in ${view.monthLabel}.`
      }
      showAccount={!account}
      selected={view.selected}
      onToggleSelected={view.toggleSelected}
      closedSplits={closedSplits}
      onToggleSplit={toggleSplit}
      onEdit={edit}
      editingId={editing?.id ?? null}
      desktop={desktop}
      isFolded={isFolded}
      onToggleDay={toggleDay}
    />
  );
  const review = <ReviewCard view={view} onEdit={edit} />;
  // The sort menu sits beside the search on a desktop; a phone has it in the page menu.
  const search = account && <TransactionSearch search={view.search} showSort={desktop} />;

  // Day headings show unless the list is sorted other than by date.
  const shownDays = view.flatRows ? [] : view.days.map((day) => day.date);
  const allFolded = shownDays.length > 0 && shownDays.every(isFolded);
  const menu = (
    <PageMenu label={`${title} menu`}>
      <MenuGroup label="View">
        {shownDays.length > 0 && (
          <MenuItem onSelect={() => setFolds({ all: !allFolded, flipped: new Set() })}>
            {allFolded ? "Expand all dates" : "Collapse all dates"}
          </MenuItem>
        )}
        <MenuItem checked={paneFold.collapsed} onSelect={paneFold.toggle}>
          Collapse info pane
        </MenuItem>
      </MenuGroup>
      {account && (
        <>
          <MenuGroup label="Sort by">
            {view.search.sortKeys.map((key) => (
              <MenuItem
                key={key.value}
                radio
                checked={view.search.sort.key === key.value}
                onSelect={() => view.search.setSortKey(key.value)}
              >
                {key.label}
              </MenuItem>
            ))}
          </MenuGroup>
          <MenuGroup label="Order">
            <MenuItem
              radio
              checked={view.search.sort.direction === "asc"}
              onSelect={() => view.search.setSortDirection("asc")}
            >
              Ascending
            </MenuItem>
            <MenuItem
              radio
              checked={view.search.sort.direction === "desc"}
              onSelect={() => view.search.setSortDirection("desc")}
            >
              Descending
            </MenuItem>
          </MenuGroup>
        </>
      )}
    </PageMenu>
  );
  const notice = !view.hasOpenAccounts && (
    <p className="notice activity-notice">
      <a href={listHref}>Add an account</a> before entering transactions.
    </p>
  );
  const editAccount = editable && (
    <EditAccount
      key={editable.id}
      account={editable}
      page={page}
      onDone={closeTool}
      onClosed={() => {
        setTool("review");
        window.location.hash = listHref;
      }}
    />
  );
  const importCsv = editable && (
    <TransactionImport budget={budget} data={data} accountId={editable.id} />
  );

  // A tracking account has nothing to review: the panel says what it is instead.
  const tracking = account?.onBudget === false;
  const backLabel = tracking ? "‹ Back" : "‹ Back to To review";

  /** The desktop panel: a transaction being edited, the account form, import, or To review. */
  let panelLabel = tracking ? "Tracking account" : "To review";
  let panelBody: ReactNode = tracking ? (
    <div className="month-summary">
      <h2>Tracking account</h2>
      <p className="empty-state">
        {account.name} stands alone, outside the budget: it never counts toward Available to Assign,
        and its transactions have no envelopes or transfers.
      </p>
      <p className="panel-hint">Choose a transaction to edit it here.</p>
    </div>
  ) : view.toReview.length > 0 ? (
    review
  ) : (
    <div className="month-summary">
      <h2>To review</h2>
      <p className="empty-state">
        Nothing to review{account ? ` in ${account.name}` : ""}. Every transaction has an envelope,
        is Income, or is a Transfer.
      </p>
      <p className="panel-hint">Choose a transaction to edit it here.</p>
    </div>
  );
  if (editing) {
    panelLabel = "Edit transaction";
    panelBody = (
      <PanelBack label={backLabel} onBack={() => setEditing(null)}>
        <TransactionEntry
          key={editing.id}
          budget={budget}
          data={data}
          initial={formFromTransaction(editing, data)}
          heading="Edit transaction"
          onDone={() => setEditing(null)}
          onCancel={() => setEditing(null)}
          onDelete={async () => {
            await view.deleteTransaction(editing.id);
            setEditing(null);
          }}
        />
      </PanelBack>
    );
  } else if (tool === "edit" && editAccount) {
    panelLabel = `Edit ${editable.name}`;
    panelBody = (
      <PanelBack label={backLabel} onBack={closeTool}>
        {editAccount}
      </PanelBack>
    );
  } else if (tool === "import" && importCsv) {
    panelLabel = `Import CSV into ${editable.name}`;
    panelBody = (
      <PanelBack label={backLabel} onBack={closeTool}>
        {importCsv}
      </PanelBack>
    );
  }

  return (
    <>
      {desktop ? (
        <>
          <div className="activity-band">{monthNav}</div>
          <CardDebt data={data} />
          {notice}
          <div className="activity-work">
            <div className="activity-table">
              <div className="account-sticky">
                {pane}
                {search}
                <SelectionBar view={view} />
              </div>
              {adding && view.hasOpenAccounts && (
                <NewTransactionRow
                  budget={budget}
                  data={data}
                  accountId={editable?.id ?? null}
                  onClose={() => setAdding(false)}
                />
              )}
              {list}
            </div>
            <SidePanel label={panelLabel} collapsed={panel.collapsed} onToggle={panel.toggle}>
              {panelBody}
            </SidePanel>
          </div>
        </>
      ) : (
        <>
          {menu}
          {monthNav}
          <CardDebt data={data} />
          <div className="account-sticky">
            {pane}
            {search}
            <SelectionBar view={view} />
          </div>
          {notice}
          {!view.search.searching && review}
          {list}
          <TransactionDialog
            budget={budget}
            data={data}
            open={editing !== null}
            heading="Edit transaction"
            initial={() => formFromTransaction(editing!, data)}
            onClose={() => setEditing(null)}
            onDelete={async () => {
              if (editing) await view.deleteTransaction(editing.id);
            }}
          />
          <Sheet
            open={tool === "edit" && editable !== null}
            label={`Edit ${editable?.name ?? "account"}`}
            onClose={closeTool}
          >
            {() => editAccount}
          </Sheet>
          <Sheet
            open={tool === "import" && editable !== null}
            label={`Import CSV into ${editable?.name ?? "account"}`}
            onClose={closeTool}
          >
            {() => (
              <>
                {importCsv}
                <button className="secondary-button sheet-close" type="button" onClick={closeTool}>
                  Close
                </button>
              </>
            )}
          </Sheet>
        </>
      )}
    </>
  );
}

/** One labeled figure in the info pane's grid. */
function Figure({
  label,
  cents,
  signed = false,
  tone,
}: {
  label: string;
  cents: number;
  signed?: boolean;
  tone?: "in" | "out";
}) {
  return (
    <div className={tone ? `account-figure ${tone}` : "account-figure"}>
      <dt>{label}</dt>
      <dd>{signed ? formatSignedCents(cents) : formatCents(cents)}</dd>
    </div>
  );
}

/** All accounts: the month's money in and out, and today's balance (cash and card debt under it). */
function AllAccountsTotals({ view }: { view: ReturnType<typeof useAccountView> }) {
  const { balance, totals } = view;
  return (
    <dl className="activity-totals" aria-label={`Totals for ${view.monthLabel}`}>
      <div>
        <dt>In</dt>
        <dd className="activity-in">{formatSignedCents(totals.moneyIn)}</dd>
      </div>
      <div>
        <dt>Out</dt>
        <dd className="activity-out">{formatSignedCents(-totals.moneyOut)}</dd>
      </div>
      <div className="activity-balance">
        <dt>Balance today</dt>
        <dd>{formatCents(balance.today)}</dd>
        <dd className="activity-balance-detail">
          {balance.hasCards
            ? `Cash ${formatCents(balance.cash)} · Cards owe ${formatCents(balance.cardsOwe)}`
            : `Reconciled ${formatCents(balance.reconciled)}`}
        </dd>
      </div>
    </dl>
  );
}

function PanelBack({
  label,
  onBack,
  children,
}: {
  label: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="panel-edit">
      <button className="text-button panel-back" type="button" onClick={onBack}>
        {label}
      </button>
      {children}
    </div>
  );
}
