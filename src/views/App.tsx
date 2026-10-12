import type { JSX } from "react";
import { useHashRoute } from "../controllers/useHashRoute";
import { useInstallPrompt } from "../controllers/useInstallPrompt";
import { APP_VERSION } from "../models/appInfo";
import { ROUTE_TITLES, ROUTES, type Route } from "../models/routes";
import { AccountsIcon, ActivityIcon, BudgetIcon, InstallIcon, SettingsIcon } from "./icons";
import { AccountsPage } from "./pages/AccountsPage";
import { ActivityPage } from "./pages/ActivityPage";
import { BudgetPage } from "./pages/BudgetPage";
import { SettingsPage } from "./pages/SettingsPage";

const PAGES: Record<Route, () => JSX.Element> = {
  budget: BudgetPage,
  accounts: AccountsPage,
  activity: ActivityPage,
  settings: SettingsPage,
};

const NAV_ICONS: Record<Route, () => JSX.Element> = {
  budget: BudgetIcon,
  accounts: AccountsIcon,
  activity: ActivityIcon,
  settings: SettingsIcon,
};

/** The app frame: header, the current page, and the bottom navigation. */
export function App() {
  const route = useHashRoute();
  const { install } = useInstallPrompt();
  const Page = PAGES[route];

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#budget" aria-label="Budget Buddy home">
          <img
            src={`${import.meta.env.BASE_URL}icons/logo-icon.svg`}
            alt=""
            width="36"
            height="36"
          />
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

      <main className="page-content" aria-live="polite">
        <Page />
      </main>

      <nav className="bottom-nav" aria-label="Primary navigation">
        {ROUTES.map((name) => {
          const NavIcon = NAV_ICONS[name];
          const active = name === route;
          return (
            <a
              key={name}
              href={`#${name}`}
              className={active ? "active" : undefined}
              aria-current={active ? "page" : undefined}
            >
              <NavIcon />
              <span>{ROUTE_TITLES[name]}</span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}
