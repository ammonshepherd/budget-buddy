import { useRef, useState, type KeyboardEvent } from "react";
import { centsToInput, formatCents } from "../../models/money";
import { Money } from "../components";
import { AmountInput } from "../AmountInput";

/**
 * A Planned or Assigned amount that turns into a text field when tapped.
 * Leaving the field (tapping anywhere else) or Enter saves; Escape cancels.
 */
export function EditableCell({
  className,
  label,
  what,
  envelopeName,
  cents,
  onSave,
}: {
  className: string;
  label: string;
  what: string;
  envelopeName: string;
  cents: number;
  onSave: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Enter and Escape end editing themselves; the blur that follows must not save again.
  const finished = useRef(false);

  const finish = (saveIt: boolean, refocus: boolean) => {
    if (finished.current || text === null) return;
    finished.current = true;
    const typed = text;
    setText(null);
    if (saveIt) void onSave(typed);
    // Back to the cell, unless the tap that ended editing went somewhere else.
    if (refocus) requestAnimationFrame(() => button.current?.focus());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true, true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false, true);
    }
  };

  if (text !== null) {
    return (
      <label className={`${className} editing`}>
        <span className="cell-label">{label}</span>
        <AmountInput
          aria-label={`${label} amount for ${envelopeName}`}
          autoFocus
          value={text}
          onFocus={(event) => event.target.select()}
          onChange={setText}
          onKeyDown={onKeyDown}
          onBlur={() => finish(true, false)}
        />
      </label>
    );
  }
  return (
    <button
      ref={button}
      className={className}
      type="button"
      aria-label={`Edit ${what} amount for ${envelopeName}, currently ${formatCents(cents)}`}
      onClick={() => {
        finished.current = false;
        setText(centsToInput(cents));
      }}
    >
      <span className="cell-label">{label}</span> <Money cents={cents} />
    </button>
  );
}
