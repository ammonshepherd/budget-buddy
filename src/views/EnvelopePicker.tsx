import { useId, useRef, useState, type KeyboardEvent } from "react";
import { exactOption, matchOptions, type PickerOption } from "../models/envelopeSearch";

export type { PickerOption };

/**
 * Choosing an envelope by typing: a text field whose matches drop down
 * under it (grouped, with what each envelope has). Tap a match, use the
 * arrow keys and Enter, or type the full name. Leaving the field with
 * anything else puts the current choice back.
 */
export function EnvelopePicker({
  label,
  hideLabel = false,
  className = "field",
  value,
  options,
  onChange,
  placeholder = "Type an envelope",
}: {
  label: string;
  /** The label is for screen readers only (split lines). */
  hideLabel?: boolean;
  className?: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const chosen = options.find((option) => option.value === value);
  // What is typed while the list is open; null while closed (the field shows the choice).
  const [typed, setTyped] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  // Set when a tap picked a match, so the blur that follows changes nothing.
  const picked = useRef(false);
  const open = typed !== null;
  const matches = open ? matchOptions(options, typed) : [];
  const activeOption = matches[active];

  const choose = (option: PickerOption | undefined) => {
    setTyped(null);
    if (option && !option.disabled && option.value !== value) onChange(option.value);
  };
  const openList = () => {
    setTyped("");
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
  };
  const move = (step: number) => {
    if (!open) return openList();
    if (matches.length === 0) return;
    let next = active;
    // Skip disabled choices.
    for (let i = 0; i < matches.length; i++) {
      next = (next + step + matches.length) % matches.length;
      if (!matches[next]?.disabled) break;
    }
    setActive(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" && open) {
      // Picks the highlighted match (not submit the form).
      event.preventDefault();
      choose(exactOption(matches, typed) ?? (activeOption?.disabled ? undefined : activeOption));
    } else if (event.key === "Escape" && open) {
      // Closes the list only, not the dialog around it.
      event.preventDefault();
      event.stopPropagation();
      setTyped(null);
    }
  };

  return (
    <div className={`${className} envelope-picker`}>
      <label htmlFor={id} className={hideLabel ? "visually-hidden" : undefined}>
        {label}
      </label>
      <div className="picker-box">
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && activeOption ? `${id}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={open ? (chosen?.label ?? placeholder) : placeholder}
          value={open ? typed : (chosen?.label ?? "")}
          onFocus={openList}
          onClick={() => !open && openList()}
          onChange={(event) => {
            setTyped(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (picked.current) picked.current = false;
            else if (open) choose(exactOption(options, typed));
          }}
        />
        {!open && chosen?.detail && (
          <span className="picker-detail" aria-hidden="true">
            {chosen.detail}
          </span>
        )}
      </div>
      {open && (
        <ul className="picker-list" id={listId} role="listbox" aria-label="Matches">
          {matches.length === 0 && <li className="picker-empty">No envelope matches “{typed}”</li>}
          {matches.flatMap((option, index) => {
            // A group's name heads its first match.
            const heading = option.group !== matches[index - 1]?.group && option.group;
            return [
              heading && (
                <li key={`g-${option.group}`} className="picker-group" role="presentation">
                  {option.group}
                </li>
              ),
              <li
                key={option.value || "none"}
                id={`${id}-${index}`}
                role="option"
                aria-selected={index === active}
                aria-disabled={option.disabled || undefined}
                className={option.value === value ? "picker-option chosen" : "picker-option"}
                // Keeps focus in the field, so its blur does not undo the pick.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => {
                  if (option.disabled) return;
                  choose(option);
                  picked.current = true;
                  input.current?.blur();
                }}
              >
                <span className="picker-name">{option.label}</span>{" "}
                {option.detail && <span className="picker-detail">{option.detail}</span>}
              </li>,
            ];
          })}
        </ul>
      )}
    </div>
  );
}
