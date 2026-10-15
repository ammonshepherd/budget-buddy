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
export const ChevronDownIcon = () => <Icon path="M6 9l6 6 6-6" />;

/** Six dots in two columns: "drag me". */
export const GripIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {[6, 12, 18].map((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />))}
  </svg>
);
