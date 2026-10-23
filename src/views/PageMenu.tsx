import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CheckIcon, MenuIcon } from "./icons";

/**
 * Where the page menu goes: a spot in the phone header (top right). Null on
 * a desktop (no header), so pages render no menu there.
 */
const MenuSlot = createContext<HTMLElement | null>(null);
export const MenuSlotProvider = MenuSlot.Provider;

/** Closes the open menu; each item calls it before doing its job. */
const CloseMenu = createContext<() => void>(() => {});

const ITEM_SELECTOR = "[role^='menuitem']:not(:disabled)";

/**
 * The page's menu: a button with three bars in the header that opens a list
 * of options for the page showing. Each page renders its own `<PageMenu>`;
 * a portal (React's way to draw part of a component somewhere else in the
 * page) puts it in the header. Phone only: on a desktop it renders nothing.
 *
 * The list closes when an option is chosen, on Escape, or on a tap outside.
 * Arrow keys move between options.
 */
export function PageMenu({ label, children }: { label: string; children: ReactNode }) {
  const slot = useContext(MenuSlot);
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  // Open: focus the first option, and close on a tap anywhere else.
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  if (!slot) return null;

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...(list.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
  };

  return createPortal(
    <div className="page-menu" ref={wrapper}>
      <button
        ref={button}
        className="icon-button"
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        <MenuIcon />
      </button>
      {open && (
        <div
          ref={list}
          id={id}
          className="page-menu-list"
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
        >
          <CloseMenu.Provider value={close}>{children}</CloseMenu.Provider>
        </div>
      )}
    </div>,
    slot,
  );
}

/**
 * One option. With `checked` it is on or off (a green tick when on); with
 * `radio` too, it is one choice of its group (like the sort).
 */
export function MenuItem({
  onSelect,
  checked,
  radio = false,
  disabled = false,
  children,
}: {
  onSelect: () => void;
  checked?: boolean;
  radio?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  const close = useContext(CloseMenu);
  const role = checked === undefined ? "menuitem" : radio ? "menuitemradio" : "menuitemcheckbox";
  return (
    <button
      className="page-menu-item"
      type="button"
      role={role}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        close();
        onSelect();
      }}
    >
      <span className="page-menu-check" aria-hidden="true">
        {checked && <CheckIcon />}
      </span>
      <span>{children}</span>
    </button>
  );
}

/** A labelled group of options, set apart by a line. */
export function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="page-menu-group" role="group" aria-label={label}>
      <p className="page-menu-heading" aria-hidden="true">
        {label}
      </p>
      {children}
    </div>
  );
}
