/**
 * Cents-first amount entry: digits fill in from the right, like a cash
 * register. Typing 1, 2, 3 shows "0.01", "0.12", "1.23", so the period never
 * has to be typed. Each part of an equation ("120.00 + 0.50") fills in on its
 * own, and a minus sign stays where it is.
 *
 * Typing a period yourself, or pasting a whole amount, switches the field to
 * plain entry: the text is then kept exactly as typed ("12.5" is $12.50).
 * Emptying the field switches it back to cents first.
 */

/** What an amount field shows, and whether it still fills in cents first. */
export type AmountEntry = { text: string; centsFirst: boolean };

/** An amount field as it opens on `text` (e.g. "120.00" or ""). */
export function startEntry(text: string): AmountEntry {
  return { text, centsFirst: true };
}

/** Splits text into amounts and the signs between them, keeping the signs (with spaces). */
const SIGNS = /(\s*[+\-−]\s*)/;

/** The digits of one amount, without leading zeros: "0.12" → "12", "0.00" → "". */
function digitsOf(amount: string): string {
  return amount.replace(/\D/g, "").replace(/^0+/, "");
}

/** Digits as dollars and cents: "5" → "0.05", "123" → "1.23", "" → "". */
function asCents(digits: string): string {
  if (digits === "") return "";
  const padded = digits.padStart(3, "0");
  return `${padded.slice(0, -2)}.${padded.slice(-2)}`;
}

/**
 * Fills each amount in `text` in cents first, keeping the signs between
 * them. An amount of zero shows as "0.00", except that `clearZero` empties
 * the last one (so backspace can clear it).
 */
export function fillCents(text: string, clearZero = false): string {
  const parts = text.split(SIGNS);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part;
      const cents = asCents(digitsOf(part));
      if (cents !== "" || !/\d/.test(part)) return cents;
      return clearZero && index === parts.length - 1 ? "" : "0.00";
    })
    .join("");
}

/**
 * The field after an edit. `next` is the field's new text; `inserted` is
 * what was typed or pasted (null for a deletion or any other edit).
 */
export function editEntry(entry: AmountEntry, next: string, inserted: string | null): AmountEntry {
  if (next.trim() === "") return { text: "", centsFirst: true };
  if (!entry.centsFirst) return { text: next, centsFirst: false };
  // A pasted (or autofilled) amount is taken as it is.
  if (inserted !== null && inserted.length > 1) return { text: next, centsFirst: false };
  if (inserted === ".") {
    // A period typed at the end turns the last amount's digits into dollars:
    // "0.12" then "." is "12." (what was meant all along).
    if (next === `${entry.text}.`) {
      const parts = entry.text.split(SIGNS);
      const last = parts.pop() ?? "";
      return { text: `${parts.join("")}${digitsOf(last) || "0"}.`, centsFirst: false };
    }
    return { text: next, centsFirst: false };
  }
  return { text: fillCents(next, inserted === null), centsFirst: true };
}
