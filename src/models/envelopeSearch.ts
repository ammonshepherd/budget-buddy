/**
 * Finding a choice in an envelope picker by typing part of its name. Pure,
 * so the picker (a view) only shows what this returns.
 */

/** One choice: an envelope (with its group) or a fixed one like "Uncategorized". */
export type PickerOption = {
  value: string;
  label: string;
  /** The envelope's group; fixed choices have none. */
  group?: string;
  /** Shown after the name, e.g. "has $12.00". */
  detail?: string;
  disabled?: boolean;
};

const fold = (text: string) => text.toLocaleLowerCase().replace(/\s+/g, " ").trim();

/** Words of a name, split at spaces and punctuation ("Transfer (not spending…)"). */
const wordsOf = (text: string) =>
  fold(text)
    .split(/[\s()/&,.-]+/)
    .filter(Boolean);

/**
 * The choices matching what is typed, in their original order: every word
 * typed must start a word of the name or group, in any order ("gro" finds
 * Groceries, "car ins" finds Car insurance, "bills" finds every envelope in
 * Bills). Nothing typed matches everything.
 */
export function matchOptions(options: PickerOption[], typed: string): PickerOption[] {
  const words = wordsOf(typed);
  if (words.length === 0) return options;
  return options.filter((option) => {
    const starts = wordsOf(`${option.label} ${option.group ?? ""}`);
    return words.every((word) => starts.some((start) => start.startsWith(word)));
  });
}

/** The choice whose name is exactly what is typed (ignoring case and spaces), if one can be chosen. */
export function exactOption(options: PickerOption[], typed: string): PickerOption | undefined {
  const name = fold(typed);
  return options.find((option) => !option.disabled && fold(option.label) === name);
}
