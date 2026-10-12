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
