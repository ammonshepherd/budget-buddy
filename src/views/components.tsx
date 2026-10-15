import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useAsyncAction } from "../controllers/useAsyncAction";
import { formatCents, type Cents } from "../models/money";

/** A formatted amount; negative amounts are shown in red. */
export function Money({ cents, className = "" }: { cents: Cents; className?: string }) {
  return (
    <span className={`money ${cents < 0 ? "negative" : ""} ${className}`.trim()}>
      {formatCents(cents)}
    </span>
  );
}

/**
 * A modal <dialog> sheet. Its content is built only while open (children is a
 * function), so a form inside starts fresh each time.
 */
export function Sheet({
  open,
  label,
  onClose,
  className = "sheet",
  children,
}: {
  open: boolean;
  label: string;
  /** "sheet" (centred) by default; "sheet bottom" sits at the bottom of the screen. */
  className?: string;
  onClose: () => void;
  children: () => ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  // A <dialog> opens with showModal(), which React has no prop for.
  useEffect(() => {
    const element = dialog.current;
    if (open && !element?.open) element?.showModal();
    if (!open && element?.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className={className}
      aria-label={label}
      // Escape closes the dialog itself; keep React's state in step.
      onClose={onClose}
    >
      {open && children()}
    </dialog>
  );
}

export function ErrorMessage({ error }: { error: string | null }) {
  return error ? (
    <p className="error-message" role="alert">
      {error}
    </p>
  ) : null;
}

/**
 * A one-field form (an amount or a name) with a submit button. The field
 * clears after a successful submit; errors appear underneath.
 */
export function SingleFieldForm({
  label,
  button,
  onSubmit,
  inputMode = "decimal",
  placeholder,
  initialValue = "",
}: {
  label: string;
  button: string;
  onSubmit: (value: string) => Promise<void>;
  inputMode?: "decimal" | "text";
  placeholder?: string;
  initialValue?: string;
}) {
  const [value, setValue] = useState(initialValue);
  const action = useAsyncAction(onSubmit);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if ((await action.run(value)).ok) setValue(initialValue);
  };

  return (
    <form className="form" onSubmit={submit}>
      <div className="form-row">
        <label className="field">
          {label}
          <input
            value={value}
            inputMode={inputMode}
            placeholder={placeholder}
            onChange={(event) => {
              setValue(event.target.value);
              action.clearError();
            }}
          />
        </label>
        <button className="secondary-button" type="submit" disabled={action.pending}>
          {button}
        </button>
      </div>
      <ErrorMessage error={action.error} />
    </form>
  );
}
