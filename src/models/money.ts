/**
 * Money is always a whole number of cents. Floating-point dollars
 * (0.1 + 0.2 !== 0.3) would slowly drift; integer cents never do.
 *
 * `Cents` is a type alias: it documents intent but TypeScript still treats
 * it as a plain number, so `assertCents` checks it at runtime.
 */
export type Cents = number;

export function assertCents(value: number, name = "amount"): asserts value is Cents {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be a whole number of cents (got ${value})`);
  }
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Formats cents for display, e.g. -123456 → "-$1,234.56". */
export function formatCents(cents: Cents): string {
  assertCents(cents);
  return usd.format(cents / 100);
}

/**
 * Reads a typed dollar amount ("12", "-4.5", "$1,234.56") as cents.
 * Returns null when it is not a valid amount with at most two decimals.
 */
export function parseCents(text: string): Cents | null {
  const match = /^(-)?\$?(\d{1,10}(?:,\d{3})*|\d+)?(?:\.(\d{0,2}))?$/.exec(
    text.trim().replace(/^\$-/, "-$"),
  );
  if (!match || (match[2] === undefined && !match[3])) return null;
  const dollars = Number((match[2] ?? "0").replaceAll(",", ""));
  const cents = Number((match[3] ?? "").padEnd(2, "0"));
  const value = dollars * 100 + cents;
  if (!Number.isSafeInteger(value)) return null;
  return match[1] && value !== 0 ? -value : value;
}
