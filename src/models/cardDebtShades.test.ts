import { describe, expect, it } from "vitest";
import { contrast, hslToHex, pickShade, SHADES, SHADE_COUNT } from "./cardDebtShades";

describe("card debt shades", () => {
  it("has 30 different shades of red", () => {
    expect(SHADES).toHaveLength(SHADE_COUNT);
    expect(new Set(SHADES.map((s) => s.background)).size).toBe(SHADE_COUNT);
    for (const { background } of SHADES) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(background.slice(i, i + 2), 16));
      expect(r).toBeGreaterThan(g!);
      expect(r).toBeGreaterThanOrEqual(b!);
    }
  });

  it("keeps the text readable on every shade (WCAG AA, 4.5:1)", () => {
    for (const { background, text } of SHADES) {
      expect(contrast(background, text)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("picks a shade for any random number", () => {
    expect(pickShade(0)).toBe(SHADES[0]);
    expect(pickShade(0.999999)).toBe(SHADES[SHADE_COUNT - 1]);
    expect(pickShade(1)).toBe(SHADES[SHADE_COUNT - 1]);
  });

  it("converts HSL to hex", () => {
    expect(hslToHex(0, 1, 0.5)).toBe("#ff0000");
    expect(hslToHex(0, 0, 1)).toBe("#ffffff");
  });
});
