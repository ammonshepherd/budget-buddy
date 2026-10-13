import { useAsyncAction } from "../../controllers/useAsyncAction";
import type { Budget } from "../../controllers/useBudget";
import { APP_VERSION } from "../../models/appInfo";
import type { BudgetData } from "../../models/types";
import { ErrorMessage } from "../components";
import { EnvelopePlanImport } from "../EnvelopePlanImport";
import { IncomeRules } from "../IncomeRules";
import { TransactionImport } from "../TransactionImport";
import { ActivityIcon, SettingsIcon } from "../icons";

export function SettingsPage({
  budget,
  data,
  email,
  onSignOut,
}: {
  budget: Budget;
  data: BudgetData;
  email: string;
  onSignOut: () => Promise<void>;
}) {
  const signOut = useAsyncAction(onSignOut);
  return (
    <section className="page-view stack" aria-labelledby="settings-title">
      <header className="page-heading">
        <p className="eyebrow">Your preferences</p>
        <h1 id="settings-title">Settings</h1>
        <p>Manage your preferences and prepare Budget Buddy for your household.</p>
      </header>

      <section className="settings-list" aria-label="Application settings">
        <div className="settings-row">
          <span className="settings-row-icon" aria-hidden="true">
            <SettingsIcon />
          </span>
          <span className="settings-row-copy">
            <strong>{data.household.name}</strong>
            <small>Signed in as {email}</small>
          </span>
        </div>
        <div className="settings-row">
          <span className="settings-row-icon" aria-hidden="true">
            <ActivityIcon />
          </span>
          <span className="settings-row-copy">
            <strong>About Budget Buddy</strong>
            <small>Version {APP_VERSION}</small>
          </span>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={signOut.pending}
          onClick={() => signOut.run()}
        >
          Sign out
        </button>
        <ErrorMessage error={signOut.error} />
      </section>

      <TransactionImport budget={budget} data={data} />
      <IncomeRules budget={budget} data={data} />
      <EnvelopePlanImport budget={budget} data={data} />
    </section>
  );
}
