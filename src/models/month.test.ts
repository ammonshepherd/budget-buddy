import { describe, expect, it } from "vitest";
import { addMonths, currentMonth, formatMonth, monthOf, todayIso } from "./month";

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
