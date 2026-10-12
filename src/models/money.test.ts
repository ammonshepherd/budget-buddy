import { describe, expect, it } from "vitest";
import { assertCents, formatCents, parseCents } from "./money";

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
