/**
 * The Credit card debt strip's colours: 30 shades of red, light to dark,
 * each with the text colour (near-black or white) that reads best on it.
 * One is picked when the app loads, so it changes with every refresh.
 */

export interface Shade {
  /** Background, as #rrggbb. */
  background: string;
  /** Text on it: DARK_TEXT or LIGHT_TEXT, whichever contrasts more. */
  text: string;
}

export const SHADE_COUNT = 30;
export const DARK_TEXT = "#1f0505";
export const LIGHT_TEXT = "#ffffff";

const hex = (n: number) =>
  Math.round(n * 255)
    .toString(16)
    .padStart(2, "0");

/** HSL (hue in degrees, saturation and lightness 0–1) as #rrggbb. */
export function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/** WCAG relative luminance of #rrggbb. */
function luminance(color: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(color.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG contrast ratio between two #rrggbb colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** The 30 shades, from pale pink-red to deep maroon. */
export const SHADES: readonly Shade[] = Array.from({ length: SHADE_COUNT }, (_, i) => {
  const t = i / (SHADE_COUNT - 1);
  const hue = (352 + (12 * ((i * 7) % 5)) / 4) % 360; // 352°–4°: crimson to scarlet
  const background = hslToHex(hue, 0.78 - 0.18 * t, 0.9 - 0.7 * t);
  const text =
    contrast(background, DARK_TEXT) >= contrast(background, LIGHT_TEXT) ? DARK_TEXT : LIGHT_TEXT;
  return { background, text };
});

/** A shade for a random number in [0, 1) (Math.random()). */
export function pickShade(random: number): Shade {
  const i = Math.min(SHADE_COUNT - 1, Math.max(0, Math.floor(random * SHADE_COUNT)));
  return SHADES[i]!;
}
