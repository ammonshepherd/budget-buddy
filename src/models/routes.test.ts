import { describe, expect, it } from "vitest";
import { activityHref, budgetHref, parseLocation, routeHref } from "./routes";

describe("parseLocation", () => {
  it("reads known routes regardless of case or a leading slash", () => {
    expect(parseLocation("#accounts")).toEqual({ route: "accounts", month: null });
    expect(parseLocation("#/Settings")).toEqual({ route: "settings", month: null });
  });

  it("reads the Budget and Activity month and ignores invalid ones", () => {
    expect(parseLocation(budgetHref("2026-10"))).toEqual({ route: "budget", month: "2026-10" });
    expect(parseLocation(activityHref("2026-10"))).toEqual({
      route: "activity",
      month: "2026-10",
    });
    expect(parseLocation("#budget/2026-13")).toEqual({ route: "budget", month: null });
    expect(parseLocation("#accounts/2026-10").month).toBeNull();
  });

  it("links Budget and Activity with the month, other pages without", () => {
    expect(routeHref("activity", "2026-10")).toBe("#activity/2026-10");
    expect(routeHref("budget", "2026-10")).toBe("#budget/2026-10");
    expect(routeHref("settings", "2026-10")).toBe("#settings");
  });

  it("falls back to Budget", () => {
    expect(parseLocation("")).toEqual({ route: "budget", month: null });
    expect(parseLocation("#nope")).toEqual({ route: "budget", month: null });
  });
});
