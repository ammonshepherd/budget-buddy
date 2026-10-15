/** Calendar helpers. Months are "YYYY-MM"; dates are "YYYY-MM-DD" in local time. */
import type { IsoDate } from "./types";

/** A calendar month as "YYYY-MM", e.g. "2026-10". Sorts correctly as a string. */
export type Month = string;

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonth(value: string): value is Month {
  return MONTH_PATTERN.test(value);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Today's date in the user's time zone (toISOString would use UTC). */
export function todayIso(now = new Date()): IsoDate {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function currentMonth(now = new Date()): Month {
  return todayIso(now).slice(0, 7);
}

export function monthOf(date: IsoDate): Month {
  return date.slice(0, 7);
}

/** addMonths("2026-12", 1) → "2027-01". */
export function addMonths(month: Month, count: number): Month {
  if (!isMonth(month)) throw new RangeError(`"${month}" is not a YYYY-MM month`);
  const [year, mon] = month.split("-").map(Number) as [number, number];
  const index = year * 12 + (mon - 1) + count;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** "2026-10" → "October 2026". */
export function formatMonth(month: Month): string {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  return new Date(year, mon - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/** "2026-10-12" → "Oct 12" (short dates in lists). */
export function formatShortDay(date: IsoDate): string {
  const [year, mon, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(year, mon - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** "2026-10-12" → "Monday, October 12, 2026" (the Activity page's date headings). */
export function formatDay(date: IsoDate): string {
  const [year, mon, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(year, mon - 1, day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
