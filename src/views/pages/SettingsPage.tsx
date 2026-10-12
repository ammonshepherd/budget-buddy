import { APP_VERSION } from "../../models/appInfo";
import { ActivityIcon } from "../icons";

export function SettingsPage() {
  return (
    <section className="page-view" aria-labelledby="settings-title">
      <header className="page-heading">
        <p className="eyebrow">Your preferences</p>
        <h1 id="settings-title">Settings</h1>
        <p>Manage your preferences and prepare Budget Buddy for your household.</p>
      </header>

      <section className="settings-list" aria-label="Application settings">
        <div className="settings-row">
          <span className="settings-row-icon" aria-hidden="true">
            <ActivityIcon />
          </span>
          <span className="settings-row-copy">
            <strong>About Budget Buddy</strong>
            <small>Version {APP_VERSION}</small>
          </span>
        </div>
      </section>
    </section>
  );
}
