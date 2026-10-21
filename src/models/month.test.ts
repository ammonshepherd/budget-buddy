import { describe, expect, it } from "vitest";
import { addMonths, currentMonth, formatDay, formatMonth, monthOf, todayIso } from "./month";

describe("month helpers", () => {
  it("uses the local calendar for today", () => {
    const lateEvening = new Date(2026, 9, 31, 23, 30);
    expect(todayIso(lateEvening)).toBe("2026-10-31");
    expect(currentMonth(lateEvening)).toBe("2026-10");
  });

  it("adds months across year boundaries", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-10", 0)).toBe("2026-10");
  });

  it("formats and extracts months", () => {
    expect(formatMonth("2026-10")).toBe("October 2026");
    expect(monthOf("2026-10-05")).toBe("2026-10");
  });
});

describe("formatDay", () => {
  it("names the weekday and date, in the local calendar", () => {
    expect(formatDay("2026-10-12")).toBe("Mon Oct 12");
    expect(formatDay("2030-01-01")).toBe("Tue Jan 1");
  });

  it("adds the year when it is not this year's", () => {
    expect(formatDay("2025-12-12", "2026-10-21")).toBe("Fri Dec 12, 2025");
    expect(formatDay("2026-10-12", "2026-10-21")).toBe("Mon Oct 12");
  });
});
