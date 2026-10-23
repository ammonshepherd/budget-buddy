import { useState, type ComponentProps } from "react";
import { editEntry, startEntry, type AmountEntry } from "../models/amountEntry";

type Props = Omit<ComponentProps<"input">, "value" | "onChange"> & {
  value: string;
  /** The field's new text, already filled in cents first. */
  onChange: (text: string) => void;
};

/**
 * A text field for a money amount that fills in cents first: typing 1, 2, 3
 * shows "0.01", "0.12", "1.23". Typing a period or pasting an amount keeps
 * the text as typed instead (`editEntry` in `src/models/amountEntry.ts`).
 */
export function AmountInput({ value, onChange, ...rest }: Props) {
  const [entry, setEntry] = useState<AmountEntry>(() => startEntry(value));
  // The form set a new value itself (opened on another amount, or cleared
  // after saving): start over, cents first.
  const current = entry.text === value ? entry : startEntry(value);

  return (
    <input
      inputMode="decimal"
      {...rest}
      value={value}
      onChange={(event) => {
        const input = event.nativeEvent as InputEvent;
        const kind = input.inputType ?? "";
        // A paste or drop carries no `data`; what it inserted is the whole new text.
        const typed = kind.startsWith("delete")
          ? null
          : (input.data ?? (kind.startsWith("insert") ? event.target.value : null));
        const next = editEntry(current, event.target.value, typed);
        setEntry(next);
        onChange(next.text);
      }}
    />
  );
}
