import type { ReactNode } from "react";
import { SidebarIcon } from "./icons";

/**
 * The desktop layout's right-hand panel (Budget, Activity, Accounts): it
 * sits beside the page's list and collapses to a thin rail with one button
 * that opens it again. Whether it is collapsed is the page's to keep
 * (useSidebar("panel", …)), so choosing something can open it.
 */
export function SidePanel({
  label,
  collapsed,
  onToggle,
  children,
}: {
  /** What the panel holds, for screen readers ("Envelope details"). */
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <aside className={collapsed ? "side-panel collapsed" : "side-panel"} aria-label={label}>
      <button
        className="side-panel-toggle"
        type="button"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Show panel" : "Hide panel"}
        title={collapsed ? "Show panel" : "Hide panel"}
        onClick={onToggle}
      >
        <SidebarIcon />
      </button>
      {!collapsed && <div className="side-panel-body">{children}</div>}
    </aside>
  );
}
