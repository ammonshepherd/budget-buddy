import { describe, expect, it } from "vitest";
import { accountsHref, budgetHref, locationHash, parseLocation, routeHref } from "./routes";

describe("parseLocation", () => {
  it("reads known routes regardless of case or a leading slash", () => {
    expect(parseLocation("#accounts")).toEqual({ route: "accounts", month: null, account: null });
    expect(parseLocation("#/Settings")).toEqual({ route: "settings", month: null, account: null });
  });

  it("reads the Budget month and ignores invalid ones", () => {
    expect(parseLocation(budgetHref("2026-10"))).toEqual({
      route: "budget",
      month: "2026-10",
      account: null,
    });
    expect(parseLocation("#budget/2026-13")).toEqual({
      route: "budget",
      month: null,
      account: null,
    });
    expect(parseLocation("#settings/2026-10").month).toBeNull();
  });

  it("reads what Accounts has open, with or without the month", () => {
    expect(parseLocation("#accounts/2026-10")).toEqual({
      route: "accounts",
      month: "2026-10",
      account: null,
    });
    expect(parseLocation("#accounts/all/2026-10")).toEqual({
      route: "accounts",
      month: "2026-10",
      account: "all",
    });
    expect(parseLocation("#Accounts/ALL")).toMatchObject({ account: "all", month: null });
    const id = "5f0c7c1e-2b9a-4f43-9a51-0d0e7b1f9a10";
    expect(parseLocation(`#accounts/${id}/2026-10`)).toEqual({
      route: "accounts",
      month: "2026-10",
      account: id,
    });
    expect(parseLocation(`#accounts/${id}`)).toMatchObject({ account: id, month: null });
  });

  it("reads the old Activity page as All accounts", () => {
    expect(parseLocation("#activity")).toEqual({ route: "accounts", month: null, account: "all" });
    expect(parseLocation("#activity/2026-10")).toEqual({
      route: "accounts",
      month: "2026-10",
      account: "all",
    });
  });

  it("falls back to Budget", () => {
    expect(parseLocation("")).toEqual({ route: "budget", month: null, account: null });
    expect(parseLocation("#nope")).toEqual({ route: "budget", month: null, account: null });
  });
});

describe("links", () => {
  it("link Budget and Accounts with the month, Settings without", () => {
    expect(routeHref("accounts", "2026-10")).toBe("#accounts/2026-10");
    expect(routeHref("budget", "2026-10")).toBe("#budget/2026-10");
    expect(routeHref("settings", "2026-10")).toBe("#settings");
  });

  it("link to what Accounts has open", () => {
    expect(accountsHref(null, "2026-10")).toBe("#accounts/2026-10");
    expect(accountsHref("all", "2026-10")).toBe("#accounts/all/2026-10");
    expect(accountsHref("abc", null)).toBe("#accounts/abc");
  });

  it("rewrite the old Activity link to All accounts", () => {
    expect(locationHash(parseLocation("#activity/2026-10"))).toBe("#accounts/all/2026-10");
    expect(locationHash(parseLocation("#activity"))).toBe("#accounts/all");
    expect(locationHash(parseLocation("#budget/2026-10"))).toBe("#budget/2026-10");
  });
});
