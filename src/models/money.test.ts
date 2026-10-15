import { describe, expect, it } from "vitest";
import { assertCents, centsToInput, formatCents, parseCents, roundMoney } from "./money";

describe("assertCents", () => {
  it("accepts whole cents and rejects fractions and non-numbers", () => {
    expect(() => assertCents(-123)).not.toThrow();
    expect(() => assertCents(1.5)).toThrow(TypeError);
    expect(() => assertCents(Number.NaN)).toThrow(TypeError);
  });
});

describe("formatCents", () => {
  it("formats cents as US dollars", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(123_456)).toBe("$1,234.56");
    expect(formatCents(-5)).toBe("-$0.05");
  });
});

describe("parseCents", () => {
  it("reads dollar amounts as cents", () => {
    expect(parseCents("12")).toBe(1200);
    expect(parseCents("12.3")).toBe(1230);
    expect(parseCents("$1,234.56")).toBe(123456);
    expect(parseCents(" -4.05 ")).toBe(-405);
    expect(parseCents("-$4.05")).toBe(-405);
    expect(parseCents(".5")).toBe(50);
    expect(parseCents("0")).toBe(0);
  });

  it("rejects anything else", () => {
    for (const bad of ["", "abc", "1.234", "1,23", "--1", "1e3", "."]) {
      expect(parseCents(bad), bad).toBeNull();
    }
  });
});

describe("roundMoney", () => {
  it("reads typed amounts the way the Budget page accepts them", () => {
    expect(roundMoney("300")).toBe(30_000);
    expect(roundMoney("300.5")).toBe(30_050);
    expect(roundMoney("300.50")).toBe(30_050);
    expect(roundMoney("$300.50")).toBe(30_050);
    expect(roundMoney("1,200")).toBe(120_000);
    expect(roundMoney(" -4.05 ")).toBe(-405);
  });

  it("rounds further decimals to the nearest cent, half away from zero", () => {
    expect(roundMoney("2.344")).toBe(234);
    expect(roundMoney("2.345")).toBe(235);
    expect(roundMoney("2.3449")).toBe(234);
    expect(roundMoney("0.999")).toBe(100);
    expect(roundMoney("-2.345")).toBe(-235);
    // No floating-point drift: 1.005 * 100 is 100.49999… as a float.
    expect(roundMoney("1.005")).toBe(101);
  });

  it("rejects anything that is not a number", () => {
    for (const bad of ["", "abc", "1,23", "--1", "1e3", ".", "12abc"]) {
      expect(roundMoney(bad), bad).toBeNull();
    }
  });
});

describe("centsToInput", () => {
  it("writes cents as plain dollars that parseCents reads back", () => {
    for (const cents of [0, 5, 100, 123_456, -1_862, -5]) {
      expect(parseCents(centsToInput(cents))).toBe(cents);
    }
    expect(centsToInput(123_456)).toBe("1234.56");
    expect(centsToInput(-5)).toBe("-0.05");
  });
});
