# Proposal: a landscape layout for desktop browsers

Status: **decided; being built** (shell and Budget in v0.26.0, Activity in v0.26.1). Written 2026-10-17 against v0.25.0.
This is a brief for making mockups. Nothing here changes the app until the
layout is built.

Mockups so far: `docs/mockups/budget-desktop.html` (Budget). The owner made
the layout decisions on 2026-10-17 (see "Decisions").

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
- Design for 1280×800 first, and check 1000 and 1600+ wide.
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

1. **Same app, wider.** One codebase, with a breakpoint at **1000px** (62.5rem;
   decision 1). Below it, the phone layout stays exactly as decided. Mostly
   `src/views/` and `styles.css` change. Editing a transaction in a side panel
   (decision 5) also means the transaction form and its cover prompts must
   render in a panel as well as in the dialog, so the form's controller may
   need small changes. No model or math changes.
2. **Use the width for a second pane, not bigger rows.** On the phone, details
   open in bottom sheets because there is no room. On a desktop they sit
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
- **Both sidebars collapse to icons** (decision 6). The left one shrinks to a
  rail of the four page icons (names as tooltips and accessible labels). The
  right panel on Budget and Activity shrinks to a thin rail with an icon
  button that opens it again. Selecting an envelope or transaction opens a
  collapsed right panel. Each panel's state is remembered per device in
  localStorage (like collapsed groups), never in Supabase.
- **Add transaction** (decision 8): a "+ Add transaction" button at the top
  of the left sidebar (a + icon when collapsed). On Budget and Accounts it
  opens the centred dialog; on Activity it opens a new transaction row at the
  top of the list.
- Content is capped at **1600px** wide, centred (decision 7).

## Budget

The screen that gains the most. Mockup: `docs/mockups/budget-desktop.html`.

- **Top bar:** month picker (‹ OCTOBER 2026 ›) in the purple band. Available
  to Assign sits in the same band on the right (still hidden at exactly $0.00,
  green when positive, red "Over Assigned" when over). Notices (transactions to
  review, no plan yet) go in a row under the band.
- **Envelope table, left (about 60%):** one line per envelope with columns
  (decision 3): icon + name + Saved pill | Planned | Assigned | Spent |
  Remaining. Group bars stay full-width and collapsible, with the + button.
  When a group is collapsed, its bar shows its total in the Remaining column.
  Planned and Assigned stay editable in place; Tab moves to the next cell.
  Refunded and Short still show (a small second line or a badge in the cell).
- **Right panel (about 40%):**
  - Nothing selected: a month summary (decision 2): income, assigned, spent
    and saved this month.
  - An envelope selected: what the `EnvelopeSheet` shows today (group picker,
    name and rename, Remaining and how it adds up, plan line, Planned/Assigned
    fields, Saved panel with "Move some into Remaining…", this month's
    transactions, Delete envelope).
  - A transaction in that list clicked: its edit form replaces the envelope's
    details in the panel (decision 5), with a Back link to the envelope. Save,
    Cancel and Delete return to the envelope. Cover prompts run in the panel.
- Card payment envelopes keep their own cells (Available to pay, Remaining
  debt) and their own panel contents.
- "Show N envelopes not used this month" stays at the bottom of the table.

## Activity

- **Top bar:** month band, then the account picker and the In / Out /
  Transfers totals on one line.
- **Transactions, left:** day headings with each day's net, and rows with more
  columns than the phone has room for: status mark | date | payee | account |
  envelope | memo | amount. Splits keep the "Split (N)" pill and their parts
  underneath. Transfers still show once ("From → To"). The selected row is
  highlighted.
- **Right panel** (decision 4):
  - Nothing selected: the "To review" card (Mark as Income, Apply income
    rules, Mark all as Income).
  - A transaction selected (in the list or in To review): its edit form, in
    the panel instead of the dialog (decision 5), with the same fields, split
    lines, transfer "Other side" choice and Delete. Save, Cancel or Escape
    returns the panel to To review. Cover prompts run in the panel.

## Accounts

- Account cards in a grid (2–3 across) or a list on the left, with the
  selected account's edit form docked on the right (Close account at the
  bottom, same rules). "Add an account" as its own card or panel. Closed
  accounts in a separate section below.
- Later: the selected account's recent transactions under its details, each
  editing in the panel (decision 9).

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

## Decisions (owner, 2026-10-17)

1. **Breakpoint:** desktop layout from **1000px** wide. No separate tablet
   layout.
2. **Budget, nothing selected:** a month summary in the right panel (variant A
   in `budget-desktop.html`).
3. **Budget row:** one line with all five columns (variant A).
4. **Activity right panel:** the To review card when nothing is selected; the
   selected transaction's edit form when one is.
5. **Editing transactions:** in the right panel on Budget and Activity, not in
   the dialog.
6. **Sidebars:** both the left navigation and the right panel can collapse to
   icons.
7. **Max content width:** 1600px, centred.

8. **Adding a transaction:** on Budget, the dialog (as on the phone). On
   Activity, a new transaction row opens at the top of the list with its
   fields to fill in.
9. **Accounts:** account details don't list transactions yet; when they do,
   a transaction edits in the panel.

## Next mockups

- Update `budget-desktop.html`: breakpoint 1000px (it sets `min-width: 1024px`
  today), 1600px cap, collapsible left and right sidebars, and editing a
  transaction from the envelope panel. Its variant switcher can go.
- Make `activity-desktop.html` (To review / edit form panel), then Accounts
  and Settings.

## Out of scope here

- Native desktop wrappers (Tauri/Electron). The PWA already installs on
  desktop Chrome/Edge and on Safari (File → Add to Dock).
- Any change to the envelope math or rules in `CLAUDE.md`.
- Dark mode (not in the app at any width yet).

## Building it afterwards (for later, not the mockup step)

Once the remaining mockups are approved: one screen per PR, Budget first. Each PR adds
the wide layout behind the breakpoint, adds a desktop viewport project to
Playwright so UI tests run at both widths, records the decided layout in
`CLAUDE.md` / `docs/SPEC.md`, and keeps the phone layout pixel-for-pixel
unchanged.
