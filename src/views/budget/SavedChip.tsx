import { Money } from "../components";

const STAR = "M12 1l2.6 8.4L23 12l-8.4 2.6L12 23l-2.6-8.4L1 12l8.4-2.6z";

const Star = ({ size, fill, className }: { size: number; fill: string; className?: string }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d={STAR} fill={fill} />
  </svg>
);

const GOLD = "#F3D36B";
const LILAC = "#B48BE0";

/** The six sparkles around a Saved chip, each placed by its class (sp1–sp6). */
const SPARKLES = [
  { size: 12, fill: GOLD },
  { size: 7, fill: LILAC },
  { size: 8, fill: LILAC },
  { size: 7, fill: GOLD },
  { size: 6, fill: LILAC },
  { size: 5, fill: "#FFFFFF" },
];

/**
 * Saved as a pill on the name line. Once money is saved it is the row's most
 * eye-catching part (solid purple, a star and sparkles), to encourage
 * saving; at $0.00 it is quiet.
 */
export function SavedChip({ cents }: { cents: number }) {
  if (cents <= 0) {
    return (
      <span className="saved-chip">
        Saved <Money cents={cents} />
      </span>
    );
  }
  return (
    <span className="saved-chip sparkle">
      <Star size={15} fill={GOLD} className="star" />
      Saved <Money cents={cents} />
      {SPARKLES.map((star, i) => (
        <Star key={i} {...star} className={`star sp sp${i + 1}`} />
      ))}
    </span>
  );
}
