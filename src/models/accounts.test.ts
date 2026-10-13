import { describe, expect, it } from "vitest";
import { openingBalanceFromEntry, openingBalanceToEntry } from "./accounts";

describe("opening balance entry", () => {
  it("keeps checking balances as entered", () => {
    expect(openingBalanceFromEntry("checking", 12_000)).toBe(12_000);
    expect(openingBalanceFromEntry("checking", -500)).toBe(-500);
  });

  it("stores the amount owed on a card as a negative balance", () => {
    expect(openingBalanceFromEntry("credit_card", 45_010)).toBe(-45_010);
    // A card with a credit balance (overpaid) is entered as negative.
    expect(openingBalanceFromEntry("credit_card", -2_000)).toBe(2_000);
  });

  it("turns a stored balance back into what the form shows", () => {
    for (const type of ["checking", "credit_card"] as const) {
      expect(openingBalanceToEntry(type, openingBalanceFromEntry(type, 7_550))).toBe(7_550);
    }
  });
});
