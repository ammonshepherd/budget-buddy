import { Fragment, useState, type JSX, type ReactNode } from "react";
import { useAppUpdate } from "../controllers/useAppUpdate";
import { useBudget } from "../controllers/useBudget";
import { useHashRoute } from "../controllers/useHashRoute";
import { useInstallPrompt } from "../controllers/useInstallPrompt";
import { useDesktop, useSidebar } from "../controllers/useLayout";
import { useSession } from "../controllers/useSession";
import { sidebarAccounts } from "../models/accounts";
import { APP_VERSION } from "../models/appInfo";
import type { UserSession } from "../models/dataStore";
import type { Account } from "../models/types";
import { currentMonth, type Month } from "../models/month";
import {
  accountsHref,
  ROUTE_TITLES,
  ROUTES,
  routeHref,
  type AccountsView,
  type Route,
} from "../models/routes";
import { store } from "../models/store";
import { CreateHouseholdPage } from "./CreateHouseholdPage";
import { ErrorMessage } from "./components";
import { AccountsIcon, BudgetIcon, ChevronLeftIcon, InstallIcon, SettingsIcon } from "./icons";
import { AccountsPage } from "./pages/AccountsPage";
import { BudgetPage } from "./pages/BudgetPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SignInPage } from "./SignInPage";
import { AddTransactionButton } from "./TransactionEntry";
import { UpdateBanner } from "./UpdateBanner";

/** Pages with the Add transaction button. */
const QUICK_ADD: Route[] = ["budget", "accounts"];

const NAV_ICONS: Record<Route, () => JSX.Element> = {
  budget: BudgetIcon,
  accounts: AccountsIcon,
  settings: SettingsIcon,
};

type Install = (() => Promise<void>) | null;

/**
 * The app frame: header, then sign-in, household setup, or the budget itself.
 * Signed in on a wide window (desktop), a sidebar takes the header's place.
 */
export function App() {
  const session = useSession(store);
  const { install } = useInstallPrompt();
  const update = useAppUpdate();
  const desktop = useDesktop() && session.status === "signedIn";

  return (
    <div className={desktop ? "app-shell desktop" : "app-shell"}>
      {update.ready && <UpdateBanner onRefresh={update.refresh} onDismiss={update.dismiss} />}
      {!desktop && (
        <header className="app-header">
          <Brand />
          <div className="header-actions">
            <span className="app-version" aria-label="Application version">
              v{APP_VERSION}
            </span>
            {install && (
              <button
                className="icon-button"
                type="button"
                aria-label="Install Budget Buddy"
                onClick={install}
              >
                <InstallIcon />
              </button>
            )}
          </div>
        </header>
      )}

      {session.status === "loading" && <Message text="Loading Budget Buddy..." />}
      {session.status === "error" && <Message error={session.error} />}
      {session.status === "signedOut" && (
        <main className="page-content">
          <SignInPage onSignIn={store.signIn} />
        </main>
      )}
      {session.status === "signedIn" && (
        // key: a different user gets a fresh budget, never the previous one's.
        <SignedInApp
          key={session.session.userId}
          session={session.session}
          desktop={desktop}
          install={install}
        />
      )}
    </div>
  );
}

function Brand() {
  return (
    <a className="brand" href="#budget" aria-label="Budget Buddy home">
      <img src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" width="36" height="36" />
      <span>Budget Buddy</span>
    </a>
  );
}

function SignedInApp({
  session,
  desktop,
  install,
}: {
  session: UserSession;
  desktop: boolean;
  install: Install;
}) {
  const budget = useBudget(store);
  const location = useHashRoute();
  const { state } = budget;
  // The month last shown on Budget or Accounts, so moving between pages keeps
  // it. (Updating state while rendering is React's way to follow a prop.)
  const [lastMonth, setLastMonth] = useState<Month | null>(null);
  if (location.month && location.month !== lastMonth) setLastMonth(location.month);
  // Counts Add transaction clicks with an account (or All accounts) open on a
  // desktop: each opens its new row.
  const [listAdds, setListAdds] = useState(0);
  const month = location.month ?? lastMonth ?? currentMonth();
  const data = state.status === "ready" ? state.data : null;
  /** What Accounts has open: All accounts, an account, or nothing (also on other pages). */
  const opened = location.route === "accounts" ? location.account : null;

  // The Add transaction button: round and floating on a phone, at the top of
  // the sidebar on a desktop. Not on Settings.
  const add =
    data && QUICK_ADD.includes(location.route) ? (
      <AddTransactionButton
        budget={budget}
        data={data}
        desktop={desktop}
        accountId={opened === "all" ? null : opened}
        onAdd={desktop && opened !== null ? () => setListAdds((n) => n + 1) : undefined}
      />
    ) : null;
  const nav = (
    <Navigation
      route={location.route}
      month={month}
      desktop={desktop}
      userId={session.userId}
      accounts={data?.accounts ?? []}
      opened={opened}
    >
      {desktop && add}
      {desktop && (
        <SidebarFoot
          install={install}
          household={data?.household.name ?? null}
          email={session.email}
        />
      )}
    </Navigation>
  );
  const frame = (content: JSX.Element) => (
    <>
      {desktop && nav}
      <main className="page-content" aria-live="polite">
        {content}
      </main>
      {!desktop && add}
      {/* The bottom bar only once there is a budget to move around in. */}
      {!desktop && data && nav}
    </>
  );

  if (state.status === "loading") {
    return frame(<p className="loading-message">Loading your budget...</p>);
  }
  if (state.status === "error") return frame(<ErrorMessage error={state.error} />);
  if (!data) return frame(<CreateHouseholdPage onCreate={budget.createHousehold} />);

  const pages: Record<Route, JSX.Element> = {
    // key: each month starts fresh (unused envelopes hidden, rows closed).
    budget: (
      <BudgetPage
        key={month}
        budget={budget}
        data={data}
        month={month}
        userId={session.userId}
        desktop={desktop}
      />
    ),
    accounts: (
      <AccountsPage
        budget={budget}
        data={data}
        month={month}
        open={opened}
        userId={session.userId}
        desktop={desktop}
        addRequest={listAdds}
      />
    ),
    settings: (
      <SettingsPage budget={budget} data={data} email={session.email} onSignOut={store.signOut} />
    ),
  };

  return frame(pages[location.route]);
}

/**
 * The pages: a bottom bar on a phone; on a desktop, a sidebar on the left
 * (brand, pages, then `children` at the bottom) that collapses to icons.
 * On a desktop, Accounts lists every open account under it.
 */
function Navigation({
  route,
  month,
  desktop,
  userId,
  accounts,
  opened,
  children,
}: {
  route: Route;
  month: Month;
  desktop: boolean;
  userId: string;
  /** Desktop only: the accounts listed under Accounts, and which one is open. */
  accounts: Account[];
  opened: AccountsView;
  /** Desktop only: the Add transaction button and the sidebar's foot. */
  children?: ReactNode;
}) {
  const sidebar = useSidebar("nav", userId);
  const links = ROUTES.map((name) => {
    const NavIcon = NAV_ICONS[name];
    const active = name === route;
    const link = (
      <a
        href={routeHref(name, month)}
        className={active ? "active" : undefined}
        aria-current={active ? "page" : undefined}
        title={desktop && sidebar.collapsed ? ROUTE_TITLES[name] : undefined}
      >
        <NavIcon />
        <span className="nav-label">{ROUTE_TITLES[name]}</span>
      </a>
    );
    return (
      <Fragment key={name}>
        {link}
        {desktop && name === "accounts" && (
          <SidebarAccounts accounts={accounts} opened={opened} month={month} />
        )}
      </Fragment>
    );
  });

  if (!desktop) {
    return (
      <nav className="bottom-nav" aria-label="Primary navigation">
        {links}
      </nav>
    );
  }
  return (
    <aside className={sidebar.collapsed ? "sidebar collapsed" : "sidebar"} aria-label="Sidebar">
      <div className="sidebar-brand">
        <Brand />
        <span className="app-version" aria-label="Application version">
          v{APP_VERSION}
        </span>
      </div>
      <nav className="sidebar-nav" aria-label="Primary navigation">
        {links}
      </nav>
      {children}
      <button
        className="sidebar-toggle"
        type="button"
        aria-expanded={!sidebar.collapsed}
        aria-label={sidebar.collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={sidebar.collapsed ? "Expand sidebar" : "Collapse sidebar"}
        onClick={sidebar.toggle}
      >
        <ChevronLeftIcon />
        <span className="nav-label">Collapse</span>
      </button>
    </aside>
  );
}

/**
 * The desktop sidebar's sub-menu under Accounts: All accounts and the open
 * budget accounts, then a gap and the tracking accounts. Hidden while the
 * sidebar shows icons only.
 */
function SidebarAccounts({
  accounts,
  opened,
  month,
}: {
  accounts: Account[];
  opened: AccountsView;
  month: Month;
}) {
  const { budget, tracking } = sidebarAccounts(accounts);
  if (budget.length + tracking.length === 0) return null;
  const item = (view: "all" | string, label: string) => {
    const active = opened === view;
    return (
      <li key={view}>
        <a
          href={accountsHref(view, month)}
          className={active ? "active" : undefined}
          aria-current={active ? "true" : undefined}
          title={label}
        >
          {label}
        </a>
      </li>
    );
  };
  return (
    <div className="sidebar-accounts">
      <ul aria-label="Budget accounts">
        {item("all", "All accounts")}
        {budget.map((a) => item(a.id, a.name))}
      </ul>
      {tracking.length > 0 && (
        <ul className="sidebar-tracking" aria-label="Tracking accounts">
          {tracking.map((a) => item(a.id, a.name))}
        </ul>
      )}
    </div>
  );
}

/** The bottom of the desktop sidebar: Install (when offered) and who is signed in. */
function SidebarFoot({
  install,
  household,
  email,
}: {
  install: Install;
  household: string | null;
  email: string;
}) {
  return (
    <div className="sidebar-foot">
      {install && (
        <button
          className="sidebar-install"
          type="button"
          aria-label="Install Budget Buddy"
          title="Install Budget Buddy"
          onClick={install}
        >
          <InstallIcon />
          <span className="nav-label">Install app</span>
        </button>
      )}
      <p className="sidebar-household nav-label">
        {household && <strong>{household}</strong>}
        <span>{email}</span>
      </p>
    </div>
  );
}

function Message({ text, error }: { text?: string; error?: string }) {
  return (
    <main className="page-content">
      {text && <p className="loading-message">{text}</p>}
      <ErrorMessage error={error ?? null} />
    </main>
  );
}
