// The v0.0.1 SVG icons as components: <BudgetIcon /> renders the drawing.

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

export const BudgetIcon = () => (
  <Icon path="M4 6.5h16v13H4zM7 6.5V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.5M8 12h8M8 15.5h5" />
);
export const AccountsIcon = () => <Icon path="M4 7.5h16v12H4zM4 7.5l2-3h12l2 3M4 10h16M8 15h3" />;
export const ActivityIcon = () => <Icon path="M5 5h14v14H5zM8 9h8M8 12h8M8 15h5" />;
export const SettingsIcon = () => (
  <Icon path="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5v2m0 13v2M3.5 12h2m13 0h2M5.99 5.99l1.41 1.42m9.2 9.18 1.41 1.42m0-12.02-1.41 1.42m-9.2 9.18-1.41 1.42" />
);
export const InstallIcon = () => (
  <Icon path="M12 3v11m0 0 4-4m-4 4-4-4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
);
export const PlusIcon = () => <Icon path="M12 5v14M5 12h14" />;
export const PencilIcon = () => <Icon path="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />;
/** A bank: roof, four columns, base. The reconciled mark on Accounts. */
export const BankIcon = () => (
  <Icon path="M3 9.5 12 4l9 5.5zM5.5 10.5v7M10 10.5v7M14 10.5v7M18.5 10.5v7M3.5 20h17" />
);
export const ChevronDownIcon = () => <Icon path="M6 9l6 6 6-6" />;
export const ChevronLeftIcon = () => <Icon path="M15 6l-6 6 6 6" />;
/** A full arrow (shaft and head): the info pane's way back to the accounts list. */
export const ArrowLeftIcon = () => <Icon path="M19 12H5M11 5l-7 7 7 7" />;
/** A window with a side column: shows or hides a desktop sidebar. */
export const SidebarIcon = () => <Icon path="M4 5h16v14H4zM9 5v14" />;

/** Six dots in two columns: "drag me". */
export const GripIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {[6, 12, 18].map((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />))}
  </svg>
);

/**
 * The app icon in miniature (a purple envelope with two green bills), shown
 * on every Budget row. Decorative; one component so per-envelope icons can
 * replace it later.
 */
export const EnvelopeIcon = () => (
  <svg className="envelope-icon" width="22" height="18" viewBox="0 0 22 18" aria-hidden="true">
    <rect x="6" y="0.5" width="11" height="9" rx="1.2" fill="#3E9A62" transform="rotate(-8 11 5)" />
    <rect x="9" y="1.5" width="10" height="8" rx="1.2" fill="#5DB97E" transform="rotate(6 14 5)" />
    <rect x="1" y="6" width="20" height="11.5" rx="2" fill="#4B2A68" />
    <path
      d="M1.8 6.8 L11 13 L20.2 6.8"
      fill="none"
      stroke="#B48BE0"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </svg>
);
