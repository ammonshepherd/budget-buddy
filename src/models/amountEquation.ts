import { editEntry, fillCents } from "./amountEntry";
import { roundMoney, type Cents } from "./money";

/**
 * Amount equations, as typed for Assigned: "250" sets a new total, while
 * "120.00 + 50" or "+50" adds to (and "− 20" takes from) the amount already
 * there. Terms are worked out left to right in whole cents.
 */

/** Either minus sign: the keyboard's "-" or the true minus "−" the pad shows. */
const MINUS = /[−-]/g;

/**
 * Works out an equation as cents. A leading + or − starts from `current`;
 * anything else is the whole new amount. Returns null when it is not a
 * valid equation (a term that is not a number, or two signs in a row).
 */
export function evaluateAmount(text: string, current: Cents): Cents | null {
  const typed = text.replace(MINUS, "-").replace(/\s+/g, "");
  if (typed === "") return null;
  // Split into signed terms: "120+50-10" → ["120", "+50", "-10"].
  const terms = typed.match(/[+-]?[^+-]+|[+-]$/g);
  if (!terms || terms.join("") !== typed) return null;
  let total = /^[+-]/.test(typed) ? current : 0;
  for (const term of terms) {
    const cents = roundMoney(term.replace(/^\+/, ""));
    if (cents === null) return null;
    total += cents;
  }
  return Number.isSafeInteger(total) ? total : null;
}

/** A key on the number pad. */
export type PadKey =
  "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "+" | "−" | "back";

/**
 * What the pad shows. `fresh` is true while it still shows the amount it
 * opened with, so typing a digit replaces it (a new total) and + or −
 * builds on it. `centsFirst` is true until the period key is pressed:
 * digits fill in from the right ("5", "0" shows "0.50"; see `amountEntry.ts`).
 */
export type PadState = { text: string; fresh: boolean; centsFirst: boolean };

/** The pad as it opens on an amount, e.g. "120.00". */
export function padStart(text: string): PadState {
  return { text, fresh: true, centsFirst: true };
}

const OPERATOR = / [+−] $/;

/** The pad after one key press. */
export function padPress(state: PadState, key: PadKey): PadState {
  if (key === "+" || key === "−") {
    const base = state.text.replace(OPERATOR, "");
    // No amount yet: the sign applies to the amount the pad opened with.
    return { ...state, text: `${base === "" ? "0.00" : base} ${key} `, fresh: false };
  }
  if (key === "back") {
    if (state.fresh) return { text: "", fresh: false, centsFirst: true };
    const text = OPERATOR.test(state.text) ? state.text.slice(0, -3) : state.text.slice(0, -1);
    if (text === "") return { text, fresh: false, centsFirst: true };
    return { ...state, text: state.centsFirst ? fillCents(text, true) : text, fresh: false };
  }
  const text = state.fresh ? "" : state.text;
  if (state.centsFirst) {
    const entry = editEntry({ text, centsFirst: true }, text + key, key);
    return { ...entry, fresh: false };
  }
  const term = text.split(/ [+−] /).pop() ?? "";
  if (key === ".") {
    if (term.includes(".")) return { ...state, fresh: false, text };
    return { ...state, text: `${text}${term === "" ? "0" : ""}.`, fresh: false };
  }
  // At most two decimals, and no leading zeros ("05" → "5").
  if (/\.\d\d$/.test(term)) return { ...state, text, fresh: false };
  if (term === "0") return { ...state, text: text.slice(0, -1) + key, fresh: false };
  return { ...state, text: text + key, fresh: false };
}
