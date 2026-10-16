import { useState, type JSX } from "react";
import { useBudget } from "../controllers/useBudget";
import { useHashRoute } from "../controllers/useHashRoute";
import { useInstallPrompt } from "../controllers/useInstallPrompt";
import { useSession } from "../controllers/useSession";
import { APP_VERSION } from "../models/appInfo";
import type { UserSession } from "../models/dataStore";
import { currentMonth, type Month } from "../models/month";
import { ROUTE_TITLES, ROUTES, routeHref, type Route } from "../models/routes";
import { store } from "../models/store";
import { CreateHouseholdPage } from "./CreateHouseholdPage";
import { ErrorMessage } from "./components";
import { AccountsIcon, ActivityIcon, BudgetIcon, InstallIcon, SettingsIcon } from "./icons";
import { AccountsPage } from "./pages/AccountsPage";
import { ActivityPage } from "./pages/ActivityPage";
import { BudgetPage } from "./pages/BudgetPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SignInPage } from "./SignInPage";
import { AddTransactionButton } from "./TransactionEntry";

/** Pages with the floating Add transaction button. */
const QUICK_ADD: Route[] = ["budget", "accounts", "activity"];

const NAV_ICONS: Record<Route, () => JSX.Element> = {
  budget: BudgetIcon,
  accounts: AccountsIcon,
  activity: ActivityIcon,
  settings: SettingsIcon,
};

/** The app frame: header, then sign-in, household setup, or the budget itself. */
export function App() {
  const session = useSession(store);
  const { install } = useInstallPrompt();

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#budget" aria-label="Budget Buddy home">
          <img src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" width="36" height="36" />
          <span>Budget Buddy</span>
        </a>
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

      {session.status === "loading" && <Message text="Loading Budget Buddy..." />}
      {session.status === "error" && <Message error={session.error} />}
      {session.status === "signedOut" && (
        <main className="page-content">
          <SignInPage onSignIn={store.signIn} />
        </main>
      )}
      {session.status === "signedIn" && (
        // key: a different user gets a fresh budget, never the previous one's.
        <SignedInApp key={session.session.userId} session={session.session} />
      )}
    </div>
  );
}

function SignedInApp({ session }: { session: UserSession }) {
  const budget = useBudget(store);
  const location = useHashRoute();
  const { state } = budget;
  // The month last shown on Budget or Activity, so moving between pages keeps
  // it. (Updating state while rendering is React's way to follow a prop.)
  const [lastMonth, setLastMonth] = useState<Month | null>(null);
  if (location.month && location.month !== lastMonth) setLastMonth(location.month);
  // The account Activity is narrowed to (null: all); kept between months and pages.
  const [activityAccount, setActivityAccount] = useState<string | null>(null);

  if (state.status === "loading") return <Message text="Loading your budget..." />;
  if (state.status === "error") return <Message error={state.error} />;
  if (state.status === "noHousehold") {
    return (
      <main className="page-content">
        <CreateHouseholdPage onCreate={budget.createHousehold} />
      </main>
    );
  }

  const { data } = state;
  const month = location.month ?? lastMonth ?? currentMonth();
  const pages: Record<Route, JSX.Element> = {
    // key: each month starts fresh (unused envelopes hidden, rows closed).
    budget: (
      <BudgetPage key={month} budget={budget} data={data} month={month} userId={session.userId} />
    ),
    accounts: <AccountsPage budget={budget} data={data} />,
    // key: each month starts with every split open.
    activity: (
      <ActivityPage
        key={month}
        budget={budget}
        data={data}
        month={month}
        accountId={activityAccount}
        onAccountChange={setActivityAccount}
      />
    ),
    settings: (
      <SettingsPage budget={budget} data={data} email={session.email} onSignOut={store.signOut} />
    ),
  };

  return (
    <>
      <main className="page-content" aria-live="polite">
        {pages[location.route]}
      </main>
      {QUICK_ADD.includes(location.route) && <AddTransactionButton budget={budget} data={data} />}
      <nav className="bottom-nav" aria-label="Primary navigation">
        {ROUTES.map((name) => {
          const NavIcon = NAV_ICONS[name];
          const active = name === location.route;
          return (
            <a
              key={name}
              href={routeHref(name, month)}
              className={active ? "active" : undefined}
              aria-current={active ? "page" : undefined}
            >
              <NavIcon />
              <span>{ROUTE_TITLES[name]}</span>
            </a>
          );
        })}
      </nav>
    </>
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
