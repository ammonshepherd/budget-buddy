import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { messageOf } from "../controllers/errors";
import {
  evaluateAmount,
  padPress,
  padStart,
  type PadKey,
  type PadState,
} from "../models/amountEquation";
import { centsToInput, formatCents, type Cents } from "../models/money";
import { ErrorMessage, Money } from "./components";

/**
 * Assigned on a phone: tapping the amount opens a number pad at the bottom
 * of the screen. Digits type a new total; + and − add to or take from the
 * amount already there ("120.00 + 50"), shown in the field as it is typed.
 * Assign saves; tapping outside or × cancels.
 */
export function PadAmount({
  className,
  labelClassName,
  valueClassName,
  label,
  envelopeName,
  cents,
  onSave,
}: {
  className: string;
  labelClassName: string;
  valueClassName?: string;
  label: string;
  envelopeName: string;
  cents: Cents;
  /** Saves what the pad shows (an amount or an equation); throws to keep the pad open. */
  onSave: (text: string) => Promise<void>;
}) {
  const [pad, setPad] = useState<PadState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  const close = () => {
    setPad(null);
    setError(null);
  };
  const assign = async () => {
    if (!pad || pending) return;
    setPending(true);
    try {
      await onSave(pad.text);
      close();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button
        ref={button}
        className={pad ? `${className} editing` : className}
        type="button"
        aria-haspopup="dialog"
        aria-label={`Edit ${label.toLowerCase()} amount for ${envelopeName}, currently ${formatCents(cents)}`}
        onClick={() => {
          setError(null);
          setPad(padStart(centsToInput(cents)));
        }}
      >
        <span className={labelClassName}>{label}</span>{" "}
        {pad ? (
          // The equation as it is typed, in place of the amount.
          <span className={`${valueClassName ?? "money"} pad-equation`}>{pad.text || "0"}</span>
        ) : (
          <span className={valueClassName}>
            <Money cents={cents} />
          </span>
        )}
      </button>
      {pad && (
        <NumberPad
          title={`${label} for ${envelopeName}`}
          state={pad}
          result={evaluateAmount(pad.text, cents)}
          error={error}
          pending={pending}
          anchor={button}
          onPress={(key) => {
            setError(null);
            setPad((state) => state && padPress(state, key));
          }}
          onAssign={() => void assign()}
          onClose={close}
        />
      )}
    </>
  );
}

const KEYS: (PadKey | "assign")[] = [
  "7",
  "8",
  "9",
  "back",
  "4",
  "5",
  "6",
  "−",
  "1",
  "2",
  "3",
  "+",
  ".",
  "0",
  "assign",
];

const KEY_NAMES: Partial<Record<PadKey, string>> = {
  back: "Delete",
  "−": "Minus",
  "+": "Plus",
  ".": "Decimal point",
};

/** A typed key as a pad key (so a keyboard works too). */
function padKeyOf(key: string): PadKey | null {
  if (/^[0-9.+]$/.test(key)) return key as PadKey;
  if (key === "-" || key === "−") return "−";
  if (key === "Backspace") return "back";
  return null;
}

/** The pad itself: a modal <dialog> along the bottom of the screen. */
function NumberPad({
  title,
  state,
  result,
  error,
  pending,
  anchor,
  onPress,
  onAssign,
  onClose,
}: {
  title: string;
  state: PadState;
  result: Cents | null;
  error: string | null;
  pending: boolean;
  /** The field the pad edits: scrolled clear of the pad so the equation shows. */
  anchor: RefObject<HTMLElement | null>;
  onPress: (key: PadKey) => void;
  onAssign: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    // Keep the field being edited above the pad. The pad is still sliding
    // up, so its final top is worked out from its height.
    const field = anchor.current;
    if (field) {
      const padTop = window.innerHeight - element.offsetHeight;
      const overlap = field.getBoundingClientRect().bottom - padTop;
      if (overlap > -16) scrollParent(field).scrollBy({ top: overlap + 24 });
    }
    return () => element.close();
  }, [anchor]);

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onAssign();
      return;
    }
    const key = padKeyOf(event.key);
    if (key) {
      event.preventDefault();
      onPress(key);
    }
  };

  return (
    <dialog
      ref={dialog}
      className="number-pad"
      aria-label={title}
      onKeyDown={onKeyDown}
      // Escape closes the dialog itself; tapping outside the pad closes it too.
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="pad-inner">
        <header className="pad-header">
          <span className="pad-title">{title}</span>
          <button className="sheet-close" type="button" aria-label="Cancel" onClick={onClose}>
            ×
          </button>
        </header>
        <p className="pad-display" aria-live="polite">
          <span className="pad-typed">{state.text || "0"}</span>
          {state.text.includes(" ") && (
            <span className="pad-result">= {result === null ? "…" : formatCents(result)}</span>
          )}
        </p>
        <ErrorMessage error={error} />
        <div className="pad-keys">
          {KEYS.map((key) =>
            key === "assign" ? (
              <button
                key={key}
                className="pad-key assign"
                type="button"
                disabled={pending || result === null}
                onClick={onAssign}
              >
                Assign
              </button>
            ) : (
              <button
                key={key}
                className={/[0-9.]/.test(key) ? "pad-key" : "pad-key op"}
                type="button"
                aria-label={KEY_NAMES[key]}
                onClick={() => onPress(key)}
              >
                {key === "back" ? "⌫" : key}
              </button>
            ),
          )}
        </div>
      </div>
    </dialog>
  );
}

/** The nearest ancestor that scrolls (the sheet, or else the page). */
function scrollParent(element: HTMLElement): Element {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight)
      return node;
  }
  return document.scrollingElement ?? document.documentElement;
}
