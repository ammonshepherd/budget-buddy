import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { useAccountView } from "../../controllers/useAccountView";
import { exactOption, matchOptions, type PickerOption } from "../../models/envelopeSearch";
import { formatSignedCents } from "../../models/money";
import { SORT_ORDERS, type SortOrder } from "../../models/transactionSearch";
import { SearchIcon } from "../icons";

type Search = ReturnType<typeof useAccountView>["search"];

/** The last drop-down line: keep what is typed as a payee/memo search. */
const TEXT = "__text__";

/**
 * Searching an open account's transactions, with a sort menu. One field:
 * typing filters by payee, memo or amount as you go, and drops down the
 * envelopes and kinds that match (like the envelope picker). Choosing one
 * becomes a chip, so only its transactions show; chips stack (an envelope
 * or kind, plus Not reconciled). Backspace in the empty field removes the
 * last chip, a chip's ✕ removes it. Enter keeps the typed text, unless it
 * is exactly an envelope's name.
 */
export function TransactionSearch({ search }: { search: Search }) {
  const id = useId();
  const listId = `${id}-list`;
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const typed = search.text;

  const matches: PickerOption[] = open ? matchOptions(search.choices, typed) : [];
  const options: PickerOption[] =
    open && typed.trim()
      ? [...matches, { value: TEXT, label: `Search “${typed.trim()}” in payee and memo` }]
      : matches;
  const activeOption = options[active];

  /** Typing: highlight an exact envelope name, else the text search line. */
  const defaultActive = (text: string, list: PickerOption[]) => {
    const exact = exactOption(list, text);
    return exact ? list.indexOf(exact) : text.trim() ? list.length : 0;
  };

  const pick = (option: PickerOption | undefined) => {
    setOpen(false);
    if (option && option.value !== TEXT) search.choose(option.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) return setOpen(true);
      if (options.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((active + step + options.length) % options.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (open) pick(activeOption);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === "Backspace" && typed === "" && search.chips.length > 0) {
      search.remove(search.chips[search.chips.length - 1]!.value);
    }
  };

  return (
    <section className="tx-search" aria-label="Search and sort">
      <div className="tx-search-row">
        <div className="envelope-picker tx-search-field">
          <label htmlFor={id} className="visually-hidden">
            Search transactions
          </label>
          <div className="tx-search-box">
            <span className="tx-search-glyph" aria-hidden="true">
              <SearchIcon />
            </span>
            {search.chips.map((chip) => (
              <button
                key={chip.value}
                className="tx-search-chip"
                type="button"
                aria-label={`Remove ${chip.label} filter`}
                onClick={() => {
                  search.remove(chip.value);
                  input.current?.focus();
                }}
              >
                {chip.label} <span aria-hidden="true">✕</span>
              </button>
            ))}
            <input
              ref={input}
              id={id}
              type="search"
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={open && activeOption ? `${id}-${active}` : undefined}
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              placeholder={search.chips.length > 0 ? "Search within" : "Search or pick an envelope"}
              value={typed}
              onFocus={() => {
                setOpen(true);
                setActive(0);
              }}
              onClick={() => setOpen(true)}
              onChange={(event) => {
                const text = event.target.value;
                search.setText(text);
                setOpen(true);
                const list = matchOptions(search.choices, text);
                setActive(defaultActive(text, list));
              }}
              onKeyDown={onKeyDown}
              onBlur={() => setOpen(false)}
            />
            {search.searching && (
              <button
                className="tx-search-clear"
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  search.clear();
                  input.current?.focus();
                }}
              >
                ✕
              </button>
            )}
          </div>
          {open && options.length > 0 && (
            <ul className="picker-list" id={listId} role="listbox" aria-label="Matches">
              {options.flatMap((option, index) => {
                const heading = option.group !== options[index - 1]?.group && option.group;
                return [
                  heading && (
                    <li key={`g-${option.group}`} className="picker-group" role="presentation">
                      {option.group}
                    </li>
                  ),
                  <li
                    key={option.value}
                    id={`${id}-${index}`}
                    role="option"
                    aria-selected={index === active}
                    className={
                      option.value === TEXT ? "picker-option tx-search-text" : "picker-option"
                    }
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pick(option)}
                  >
                    <span className="picker-name">{option.label}</span>{" "}
                    {option.detail && <span className="picker-detail">{option.detail}</span>}
                  </li>,
                ];
              })}
            </ul>
          )}
        </div>
        <label className="tx-sort">
          <span className="visually-hidden">Sort by</span>
          <select
            value={search.sort}
            onChange={(event) => search.setSort(event.target.value as SortOrder)}
          >
            {SORT_ORDERS.map((order) => (
              <option key={order.value} value={order.value}>
                {order.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="tx-search-summary" aria-live="polite">
        {search.searching &&
          `${search.matchCount} ${search.matchCount === 1 ? "match" : "matches"} · ${formatSignedCents(search.matchTotal)}`}
      </p>
    </section>
  );
}
