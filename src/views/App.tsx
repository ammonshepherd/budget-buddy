import { useState, type JSX, type ReactNode } from "react";
import { useBudget } from "../controllers/useBudget";
import { useHashRoute } from "../controllers/useHashRoute";
import { useInstallPrompt } from "../controllers/useInstallPrompt";
import { useDesktop, useSidebar } from "../controllers/useLayout";
import { useSession } from "../controllers/useSession";
import { APP_VERSION } from "../models/appInfo";
import type { UserSession } from "../models/dataStore";
import { currentMonth, type Month } from "../models/month";
import { ROUTE_TITLES, ROUTES, routeHref, type Route } from "../models/routes";
import { store } from "../models/store";
import { CreateHouseholdPage } from "./CreateHouseholdPage";
import { ErrorMessage } from "./components";
import {
  AccountsIcon,
  ActivityIcon,
  BudgetIcon,
  ChevronLeftIcon,
  InstallIcon,
  SettingsIcon,
} from "./icons";
import { AccountsPage } from "./pages/AccountsPage";
import { ActivityPage } from "./pages/ActivityPage";
import { BudgetPage } from "./pages/BudgetPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SignInPage } from "./SignInPage";
import { AddTransactionButton } from "./TransactionEntry";

/** Pages with the Add transaction button. */
const QUICK_ADD: Route[] = ["budget", "accounts", "activity"];

const NAV_ICONS: Record<Route, () => JSX.Element> = {
  budget: BudgetIcon,
  accounts: AccountsIcon,
  activity: ActivityIcon,
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
  const desktop = useDesktop() && session.status === "signedIn";

  return (
    <div className={desktop ? "app-shell desktop" : "app-shell"}>
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
  // The month last shown on Budget or Activity, so moving between pages keeps
  // it. (Updating state while rendering is React's way to follow a prop.)
  const [lastMonth, setLastMonth] = useState<Month | null>(null);
  if (location.month && location.month !== lastMonth) setLastMonth(location.month);
  // The account Activity is narrowed to (null: all); kept between months and pages.
  const [activityAccount, setActivityAccount] = useState<string | null>(null);
  // Counts Add transaction clicks on Activity on a desktop: each opens its new row.
  const [activityAdds, setActivityAdds] = useState(0);
  const month = location.month ?? lastMonth ?? currentMonth();
  const data = state.status === "ready" ? state.data : null;

  // The Add transaction button: round and floating on a phone, at the top of
  // the sidebar on a desktop. Not on Settings.
  const add =
    data && QUICK_ADD.includes(location.route) ? (
      <AddTransactionButton
        budget={budget}
        data={data}
        desktop={desktop}
        onAdd={
          desktop && location.route === "activity" ? () => setActivityAdds((n) => n + 1) : undefined
        }
      />
    ) : null;
  const nav = (
    <Navigation route={location.route} month={month} desktop={desktop} userId={session.userId}>
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
      <AccountsPage budget={budget} data={data} userId={session.userId} desktop={desktop} />
    ),
    // key: each month starts with every split open.
    activity: (
      <ActivityPage
        key={month}
        budget={budget}
        data={data}
        month={month}
        accountId={activityAccount}
        onAccountChange={setActivityAccount}
        userId={session.userId}
        desktop={desktop}
        addRequest={activityAdds}
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
 */
function Navigation({
  route,
  month,
  desktop,
  userId,
  children,
}: {
  route: Route;
  month: Month;
  desktop: boolean;
  userId: string;
  /** Desktop only: the Add transaction button and the sidebar's foot. */
  children?: ReactNode;
}) {
  const sidebar = useSidebar("nav", userId);
  const links = ROUTES.map((name) => {
    const NavIcon = NAV_ICONS[name];
    const active = name === route;
    return (
      <a
        key={name}
        href={routeHref(name, month)}
        className={active ? "active" : undefined}
        aria-current={active ? "page" : undefined}
        title={desktop && sidebar.collapsed ? ROUTE_TITLES[name] : undefined}
      >
        <NavIcon />
        <span className="nav-label">{ROUTE_TITLES[name]}</span>
      </a>
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
