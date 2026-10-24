import { useEffect } from "react";
import { useAsyncAction } from "../../controllers/useAsyncAction";
import type { Budget } from "../../controllers/useBudget";
import { APP_VERSION } from "../../models/appInfo";
import type { SettingsSection } from "../../models/routes";
import type { BudgetData } from "../../models/types";
import { BackupSection } from "../BackupSection";
import { ErrorMessage } from "../components";
import { CardDebt } from "../CardDebt";
import { EnvelopeGroups } from "../EnvelopeGroups";
import { EnvelopePlanImport } from "../EnvelopePlanImport";
import { IncomeRules } from "../IncomeRules";
import { TransactionImport } from "../TransactionImport";
import { ActivityIcon, SettingsIcon } from "../icons";
import { MenuItem, PageMenu } from "../PageMenu";

export function SettingsPage({
  budget,
  data,
  email,
  onSignOut,
  desktop = false,
  section = null,
}: {
  budget: Budget;
  data: BudgetData;
  email: string;
  onSignOut: () => Promise<void>;
  /** A desktop has no page menu, so Sign out stays a button on the page. */
  desktop?: boolean;
  /** A section to scroll to ("#settings/groups", from the Budget menu's Edit groups). */
  section?: SettingsSection | null;
}) {
  const signOut = useAsyncAction(onSignOut);

  useEffect(() => {
    if (section === "groups") document.getElementById("groups-title")?.scrollIntoView();
  }, [section]);

  return (
    // On a desktop the sections sit in two columns (see .settings-page).
    <section className="page-view stack settings-page" aria-labelledby="settings-title">
      <PageMenu label="Settings menu">
        <MenuItem disabled={signOut.pending} onSelect={() => signOut.run()}>
          Sign out
        </MenuItem>
      </PageMenu>
      <CardDebt data={data} />
      <header className="page-heading">
        <p className="eyebrow">Your preferences</p>
        <h1 id="settings-title">Settings</h1>
        <p>Manage your preferences and prepare Enough Money for your household.</p>
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
            <strong>About Enough Money</strong>
            <small>Version {APP_VERSION}</small>
          </span>
        </div>
        {desktop && (
          <button
            className="secondary-button"
            type="button"
            disabled={signOut.pending}
            onClick={() => signOut.run()}
          >
            Sign out
          </button>
        )}
        <ErrorMessage error={signOut.error} />
      </section>

      <EnvelopeGroups budget={budget} data={data} />
      {/* Its preview table gets both columns on a desktop. */}
      <div className="settings-wide">
        <TransactionImport budget={budget} data={data} />
      </div>
      <IncomeRules budget={budget} data={data} />
      <EnvelopePlanImport budget={budget} data={data} />
      <BackupSection budget={budget} data={data} />
    </section>
  );
}
