import { describe, expect, it } from "vitest";
import { budgetHref, parseLocation } from "./routes";

describe("parseLocation", () => {
  it("reads known routes regardless of case or a leading slash", () => {
    expect(parseLocation("#accounts")).toEqual({ route: "accounts", month: null });
    expect(parseLocation("#/Settings")).toEqual({ route: "settings", month: null });
  });

  it("reads the Budget month and ignores invalid ones", () => {
    expect(parseLocation(budgetHref("2026-10"))).toEqual({ route: "budget", month: "2026-10" });
    expect(parseLocation("#budget/2026-13")).toEqual({ route: "budget", month: null });
    expect(parseLocation("#activity/2026-10").month).toBeNull();
  });

  it("falls back to Budget", () => {
    expect(parseLocation("")).toEqual({ route: "budget", month: null });
    expect(parseLocation("#nope")).toEqual({ route: "budget", month: null });
  });
});
