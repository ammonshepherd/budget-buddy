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
 * Formats cents with an explicit sign, as Accounts lists show amounts:
 * 245000 → "+$2,450.00", -8642 → "−$86.42" (a true minus sign), 0 → "$0.00".
 */
export function formatSignedCents(cents: Cents): string {
  const sign = cents > 0 ? "+" : cents < 0 ? "\u2212" : "";
  return sign + formatCents(Math.abs(cents));
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

/**
 * Reads a typed dollar amount ("300", "300.5", "$300.50", "1,200") as cents,
 * rounding any further decimals to the nearest cent (half away from zero:
 * "2.345" → 235). Works on the digits as text, so no floating-point error
 * creeps in. Returns null when it is not a number.
 */
export function roundMoney(text: string): Cents | null {
  const match = /^(-)?\$?(\d{1,10}(?:,\d{3})*|\d+)?(?:\.(\d*))?$/.exec(
    text.trim().replace(/^\$-/, "-$"),
  );
  if (!match || (match[2] === undefined && !match[3])) return null;
  const dollars = Number((match[2] ?? "0").replaceAll(",", ""));
  const decimals = (match[3] ?? "").padEnd(3, "0");
  const cents = Number(decimals.slice(0, 2)) + (Number(decimals[2]) >= 5 ? 1 : 0);
  const value = dollars * 100 + cents;
  if (!Number.isSafeInteger(value)) return null;
  return match[1] && value !== 0 ? -value : value;
}

/** Cents as plain text for an input field, e.g. -123456 → "-1234.56". */
export function centsToInput(cents: Cents): string {
  assertCents(cents);
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
