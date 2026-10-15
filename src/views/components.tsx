import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useAsyncAction } from "../controllers/useAsyncAction";
import { formatCents, type Cents } from "../models/money";
import { PencilIcon } from "./icons";

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

/**
 * A sheet's title with a pencil button to rename it. While renaming, Enter
 * or leaving the field saves (when it changed); Escape puts the name back.
 */
export function EditableTitle({
  name,
  label,
  onSave,
}: {
  name: string;
  /** "Envelope name" or "Group name": the field's label. */
  label: string;
  onSave: (name: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);
  const action = useAsyncAction(onSave);
  // Enter saves and the field then loses focus: save only once.
  const saving = useRef(false);

  const commit = async () => {
    if (saving.current) return;
    if (text.trim() === name) {
      setEditing(false);
      action.clearError();
      return;
    }
    saving.current = true;
    const result = await action.run(text);
    saving.current = false;
    if (result.ok) setEditing(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    } else if (event.key === "Escape") {
      // Only undo the typing; do not close the sheet.
      event.preventDefault();
      setText(name);
      setEditing(false);
      action.clearError();
    }
  };

  if (!editing) {
    return (
      <div className="editable-title">
        <h2>{name}</h2>
        <button
          className="title-edit"
          type="button"
          aria-label={`Rename ${name}`}
          onClick={() => {
            setText(name);
            setEditing(true);
          }}
        >
          <PencilIcon />
        </button>
      </div>
    );
  }
  return (
    <div className="editable-title editing">
      <input
        className="title-input"
        aria-label={label}
        maxLength={100}
        autoFocus
        value={text}
        onFocus={(event) => event.target.select()}
        onChange={(event) => {
          setText(event.target.value);
          action.clearError();
        }}
        onKeyDown={onKeyDown}
        onBlur={() => void commit()}
      />
      <ErrorMessage error={action.error} />
    </div>
  );
}
