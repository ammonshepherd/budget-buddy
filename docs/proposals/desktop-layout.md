# Proposal: a landscape layout for desktop browsers

Status: **partly decided, not built.** Written 2026-10-17 against v0.25.0.
This is a brief for making mockups. Nothing here changes the app until the
owner has picked a direction and the layout is built.

Mockups so far: `docs/mockups/budget-desktop.html` (Budget). Decided on
2026-10-17 from it: decisions 2 and 3 below (variant A for both). Its
variant switcher stays only so the choice can be revisited.

## The request

The app is built for phones. On a laptop or desktop browser it shows the phone
column (max 30rem) floating in the middle of the screen, so most of the
window goes unused. The owner wants a landscape view that uses the width.

This is about the **layout in a browser** (and the installed PWA window), not
a native wrapper such as Tauri or Electron.

## For whoever makes the mockups

Read these first:

- `CLAUDE.md`: the decided math and rules. They apply at every width. A
  desktop layout may move things around but must not change what a number
  means, hide money, or skip a prompt.
- `docs/SPEC.md` §5 (Screens) and §8 (Look and feel): what each screen shows
  today, in detail.
- `docs/mockups/budget-screen.html` and `docs/mockups/activity-screen.html`:
  the approved phone designs. Reuse their colour tokens, type and components
  so the desktop mockups read as the same app.
- `src/styles.css`: the app's real tokens (`:root`).

Making the mockups:

- One standalone HTML file per screen in `docs/mockups/`, named
  `budget-desktop.html`, `activity-desktop.html`, `accounts-desktop.html`,
  `settings-desktop.html`. Inline CSS and JS, no build step, so the owner can
  open each one by double-clicking it. Google Fonts is fine.
- Design for 1280×800 first, and check 1024 and 1440+ wide.
- Use made-up sample data only, never anything from `private/`. Use realistic
  household envelopes (Groceries, Gas, Rent, Kids' clothes, a credit card
  payment envelope, etc.) and enough rows to fill the screen.
- Include a small fixed "Variant A / B" switcher where an open decision below
  has more than one reasonable answer, so the owner can compare in place.
- Make the important interactions work in the mockup (selecting an envelope
  opens its panel, collapsing a group, switching months). Static is fine for
  the rest.
- Put a comment at the top of each file: what it shows, what is sample data,
  what is not wired up (same style as the existing mockups).

## Principles

1. **Same app, wider.** One codebase, with a breakpoint (suggested 64rem /
   1024px). Below it, the phone layout stays exactly as decided. Only
   `src/views/` and `styles.css` would change; models and controllers would not.
2. **Use the width for a second pane, not bigger rows.** On the phone, details
   open in bottom sheets because there is no room. On a desktop they can sit
   beside the list, so you can see the list and one item's details at once.
3. **Keep the identity.** Purple month band, sticky Available to Assign card,
   tinted group bars, the Saved pill with sparkles, the amber Uncategorized
   label.
4. **Desktop affordances.** Hover states, visible focus, keyboard shortcuts,
   and wider click targets are fine, but nothing may depend on hover alone.
   Numbers keep tabular figures and right alignment.

## App shell

- **Left sidebar navigation** (about 220px) replaces the bottom nav: logo +
  "Budget Buddy" + version at the top, then Budget, Accounts, Activity,
  Settings with their icons, the current page highlighted. Install button and
  signed-in household at the bottom.
- **Add transaction**: the floating round + could become a "+ Add transaction"
  button at the top of the sidebar or in each page's header. The dialog stays
  a centred modal (it may grow wider, e.g. to show a split's lines in a table).
- Content area takes the rest, with a sensible max width (about 1400px) so
  rows don't stretch too far on huge monitors.

## Budget

The screen that gains the most.

- **Top bar:** month picker (‹ OCTOBER 2026 ›) in the purple band. Available
  to Assign sits in the same band on the right (still hidden at exactly $0.00,
  green when positive, red "Over Assigned" when over). Notices (transactions to
  review, no plan yet) go in a row under the band.
- **Envelope table, left (about 60%):** the phone's two-line rows become one
  line with columns: icon + name + Saved pill | Planned | Assigned | Spent |
  Remaining. Group bars stay full-width and collapsible, with the + button.
  When a group is collapsed, its bar shows its total in the Remaining column.
  Planned and Assigned stay editable in place; Tab moves to the next cell.
  Refunded and Short still show (a small second line or a badge in the cell).
- **Envelope panel, right (about 40%):** clicking an envelope shows what the
  `EnvelopeSheet` shows today (group picker, name and rename, Remaining and how
  it adds up, plan line, Planned/Assigned fields, Saved panel with "Move some
  into Remaining…", this month's transactions, Delete envelope), as a docked
  panel instead of a bottom sheet. When nothing is selected, the panel could
  show a month summary (see open decisions).
- Card payment envelopes keep their own cells (Available to pay, Remaining
  debt) and their own panel contents.
- "Show N envelopes not used this month" stays at the bottom of the table.

## Activity

- **Top bar:** month band, then the account picker and the In / Out /
  Transfers totals on one line.
- **Transactions, left:** day headings with each day's net, and rows with more
  columns than the phone has room for: status mark | date | payee | account |
  envelope | memo | amount. Splits keep the "Split (N)" pill and their parts
  underneath. Transfers still show once ("From → To").
- **Right column:** the "To review" card (Mark as Income, Apply income rules,
  Mark all as Income) and/or the edit form for the selected transaction
  inline, instead of a modal. See open decisions.

## Accounts

- Account cards in a grid (2–3 across) or a list on the left, with the
  selected account's edit form docked on the right (Close account at the
  bottom, same rules). "Add an account" as its own card or panel. Closed
  accounts in a separate section below.
- Optional: the selected account's recent transactions under its details
  (just a view; editing still goes through the transaction dialog).

## Settings

- Two columns: a section list on the left (Household, Envelope groups, Import
  transactions, Income rules, Import envelope plan) and the chosen section on
  the right. Or a two-column grid of section cards.
- Envelope groups: the group's envelopes can show beside the group list
  instead of in a sheet, keeping drag handles and "Move to…".
- CSV import preview benefits most from width: a real table with every column
  of the bank file visible.

## Keyboard shortcuts (optional, for discussion)

- `N`: add transaction. `←` / `→` (or `[` / `]`): previous / next month on
  Budget and Activity. `Esc`: close a panel or dialog. `/`: focus a search
  box later, when search exists.
- Show them in a small "Keyboard shortcuts" list (e.g. under `?`).

## Open decisions for the owner

1. **Breakpoint.** Switch at 1024px, or also have a middle (tablet landscape,
   ~768–1023px) layout with the sidebar but no second pane?
2. **Budget, nothing selected:** _Decided: a month summary in the right
   panel_ (income, assigned, spent, saved this month; variant A in
   `budget-desktop.html`). Not chosen: an empty panel with a hint, or no panel
   until an envelope is clicked.
3. **Budget row:** _Decided: one line with all five columns_ (variant A).
   Not chosen: the phone's two-line row made wider.
4. **Activity right column:** To review always shown, the selected
   transaction's edit form, or both stacked?
5. **Editing transactions on desktop:** keep the modal dialog everywhere
   (simplest, one code path), or edit inline in the right panel?
6. **Sidebar:** always expanded, or collapsible to icons only?
7. **Max content width** on very wide screens: cap it (centred), or let the
   table fill it?

## Out of scope here

- Native desktop wrappers (Tauri/Electron). The PWA already installs on
  desktop Chrome/Edge and on Safari (File → Add to Dock).
- Any change to the envelope math or rules in `CLAUDE.md`.
- Dark mode (not in the app at any width yet).

## Building it afterwards (for later, not the mockup step)

Once the mockups are approved: one screen per PR, Budget first. Each PR adds
the wide layout behind the breakpoint, adds a desktop viewport project to
Playwright so UI tests run at both widths, records the decided layout in
`CLAUDE.md` / `docs/SPEC.md`, and keeps the phone layout pixel-for-pixel
unchanged.
