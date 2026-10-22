import { useLayoutEffect, useRef, useState } from "react";
import { useAccountsPage } from "../../controllers/useAccountsPage";
import type { Budget } from "../../controllers/useBudget";
import { useSidebar } from "../../controllers/useLayout";
import { formatCents, formatSignedCents } from "../../models/money";
import { addMonths, formatMonth, type Month } from "../../models/month";
import { accountsHref, type AccountsView } from "../../models/routes";
import type { BudgetData } from "../../models/types";
import { AddAccount, type AccountRow } from "../AccountForm";
import { AccountView } from "../AccountView";
import { CardDebt } from "../CardDebt";
import { Sheet } from "../components";
import { PlusIcon } from "../icons";
import { SidePanel } from "../SidePanel";

type Page = ReturnType<typeof useAccountsPage>;

/**
 * Accounts: the list of accounts (nothing open), or with All accounts or one
 * account open (AccountView). What is open lives in the URL, so the
 * browser's Back button closes it and a reload keeps it. Coming back to the
 * list puts it where it was scrolled.
 */
export function AccountsPage({
  budget,
  data,
  month,
  open,
  userId,
  desktop = false,
  addRequest = 0,
}: {
  budget: Budget;
  data: BudgetData;
  month: Month;
  open: AccountsView;
  userId: string;
  desktop?: boolean;
  addRequest?: number;
}) {
  const page = useAccountsPage(budget, data, month);

  // Keep track of how far the list is scrolled; a newly opened view starts
  // at the top, and the list comes back where it was.
  const listScroll = useRef(0);
  useLayoutEffect(() => {
    window.scrollTo(0, open === null ? listScroll.current : 0);
    if (open !== null) return;
    const remember = () => (listScroll.current = window.scrollY);
    window.addEventListener("scroll", remember, { passive: true });
    return () => window.removeEventListener("scroll", remember);
  }, [open]);

  return (
    <section
      className={
        open === null ? "page-view activity-page accounts-page" : "page-view activity-page"
      }
      aria-labelledby="accounts-title"
    >
      {/* Read by screen readers; the accounts get the screen space. */}
      <h1 id="accounts-title" className="visually-hidden">
        Accounts
      </h1>
      {open === null ? (
        <AccountList page={page} data={data} month={month} userId={userId} desktop={desktop} />
      ) : (
        <AccountView
          // A different account (or All accounts in another month) starts fresh:
          // 100 rows, splits open, nothing ticked. An open account keeps its
          // list when the month changes; only the pane follows the month.
          key={open === "all" ? `all|${month}` : open}
          budget={budget}
          data={data}
          page={page}
          month={month}
          accountId={open === "all" ? null : open}
          userId={userId}
          desktop={desktop}
          addRequest={addRequest}
        />
      )}
    </section>
  );
}

/**
 * The accounts list: All accounts first (with the month's money in and out),
 * then Checking, Credit cards and Tracking, each row opening its account.
 * Closed accounts wait behind "Show closed accounts". Accounts are added
 * with + Add account under the list (a sheet), or on a desktop in the panel
 * on the right.
 */
function AccountList({
  page,
  data,
  month,
  userId,
  desktop,
}: {
  page: Page;
  data: BudgetData;
  month: Month;
  userId: string;
  desktop: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const panel = useSidebar("panel", userId);
  const { monthTotals } = page;

  const monthNav = (
    <div className="budget-month month-nav">
      <a href={accountsHref(null, addMonths(month, -1))} aria-label="Previous month">
        ‹
      </a>
      <span>{formatMonth(month)}</span>
      <a href={accountsHref(null, addMonths(month, 1))} aria-label="Next month">
        ›
      </a>
    </div>
  );
  // Phone: under the open accounts. Desktop: the form is in the panel.
  const addButton = !desktop && (
    <button className="account-list-add" type="button" onClick={() => setAdding(true)}>
      <PlusIcon />
      Add account
    </button>
  );
  const groups = (list: typeof page.openGroups, closed = false) =>
    list.map((group) => {
      const id = `accounts-${closed ? "closed-" : ""}${group.name.replace(/\W+/g, "-")}`;
      return (
        <section key={group.name} aria-labelledby={id}>
          <div className="group-heading account-group-heading">
            <h2 id={id}>{group.name}</h2>
          </div>
          <ul className="account-rows">
            {group.accounts.map((account) => (
              <AccountListRow key={account.id} account={account} month={month} />
            ))}
          </ul>
        </section>
      );
    });

  const list = (
    <div className="account-list">
      <a
        className="account-row all-accounts-row"
        href={accountsHref("all", month)}
        aria-label={`Open All accounts, ${formatMonth(month)}: in ${formatCents(monthTotals.moneyIn)}, out ${formatCents(monthTotals.moneyOut)}`}
      >
        <span className="account-row-name">
          All accounts
          <small>
            <span className="activity-in">In {formatSignedCents(monthTotals.moneyIn)}</span>
            {" · "}
            <span className="activity-out">Out {formatSignedCents(-monthTotals.moneyOut)}</span>
          </small>
        </span>
      </a>
      {page.openAccounts.length === 0 ? (
        <p className="activity-empty">
          No accounts yet. Add your checking account{" "}
          {desktop ? "on the right" : "with + Add account below"}.
        </p>
      ) : (
        groups(page.openGroups)
      )}
      {addButton}
      {page.closedAccounts.length > 0 && (
        <>
          <button
            className="text-button unused-toggle"
            type="button"
            aria-expanded={showClosed}
            onClick={() => setShowClosed((s) => !s)}
          >
            {showClosed ? "Hide" : "Show"} closed accounts ({page.closedAccounts.length})
          </button>
          {showClosed && (
            <div className="closed-accounts" aria-label="Closed accounts" role="group">
              {groups(page.closedGroups, true)}
            </div>
          )}
        </>
      )}
    </div>
  );

  if (desktop) {
    return (
      <>
        <div className="activity-band">{monthNav}</div>
        <CardDebt data={data} />
        <div className="activity-work">
          <div className="activity-table">{list}</div>
          <SidePanel label="Add an account" collapsed={panel.collapsed} onToggle={panel.toggle}>
            <AddAccount page={page} />
          </SidePanel>
        </div>
      </>
    );
  }
  return (
    <>
      {monthNav}
      <CardDebt data={data} />
      {list}
      <Sheet open={adding} label="Add an account" onClose={() => setAdding(false)}>
        {() => <AddAccount page={page} onDone={() => setAdding(false)} />}
      </Sheet>
    </>
  );
}

/** An account: name on the left, balance on the right; the whole row opens it. */
function AccountListRow({ account, month }: { account: AccountRow; month: Month }) {
  const balance = formatCents(account.balance);
  return (
    <li>
      <a
        className="account-row"
        href={accountsHref(account.id, month)}
        aria-label={`Open ${account.name}, balance ${balance}`}
      >
        <span className="account-row-name">{account.name}</span>
        <span
          className={account.balance < 0 ? "account-row-balance negative" : "account-row-balance"}
        >
          {balance}
        </span>
      </a>
    </li>
  );
}
