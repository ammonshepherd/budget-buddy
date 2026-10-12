import { useState, type FormEvent } from "react";
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
