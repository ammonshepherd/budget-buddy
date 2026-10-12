import { describe, expect, it } from "vitest";
import { assertCents, formatCents } from "./money";

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
