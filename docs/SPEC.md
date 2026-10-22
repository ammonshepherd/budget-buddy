# Budget Buddy — specification

What the app does and how it is built, in enough detail to rebuild it. Three
sources together are the full picture; when they disagree, fix the docs:

| Source                      | Authoritative for                                  |
| --------------------------- | -------------------------------------------------- |
| `CLAUDE.md`                 | Decided envelope math, budgeting rules, process    |
| `supabase/migrations/*.sql` | The exact database: columns, constraints, SQL, RLS |
| This file                   | Everything else: structure, screens, import, look  |

Version described: 0.30.0.

## 1. Purpose

An envelope-budgeting Progressive Web App for one small household. Money in
checking accounts gets a job in envelopes; spending comes out of envelopes;
credit card spending is set aside in a payment envelope per card. Bank and card
CSV exports are imported and reviewed. Works on a phone first, installable,
hosted on GitHub Pages with Supabase as the back end.

## 2. Project structure

```
src/models/       types, pure functions, data stores (no React)
src/controllers/  React hooks: load data, handle actions, call models
src/views/        React components (pages in src/views/pages/)
src/styles.css    all styling
public/icons/     app icons (see CLAUDE.md "App icons")
supabase/migrations/  every schema change, applied in order
docs/mockups/     static design mockups (reference only, not shipped)
e2e/              Playwright UI tests (in-memory store)
e2e-db/           Playwright UI tests against the test database
integration/      integration and RLS tests against the test database
scripts/          test-database seed script and its safety guard
```

Key model modules: `budgetMath.ts` (all budget math), `money.ts` (parse and
format cents), `month.ts` (`YYYY-MM` helpers, `formatDay`), `routes.ts`,
`accounts.ts` (card opening balance sign, list groups), `activity.ts` (the
Accounts page's lists: All accounts' month and an open account's history by
day, day nets, totals, info pane figures, 100 rows at a time), `transfers.ts` (linked transfers and
matching), `transactionImport.ts` + `csv.ts` (bank CSV, matching typed transactions), `envelopePlan.ts` (plan
CSV), `incomeRules.ts`, `dataStore.ts` (the store interface), `supabaseStore.ts`,
`memoryStore.ts`, `store.ts` (picks one), `layoutPrefs.ts` (desktop
breakpoint and collapsed sidebars).

### Data stores

`DataStore` (in `dataStore.ts`) is the only way controllers read or write data.
Two implementations:

- `supabaseStore` — the real one. Loads the whole household at once (`load()`
  returns `BudgetData`: household, accounts, groups, envelopes, envelope months,
  transactions with allocations, income rules; each table is read in pages by
  `fetchAll`, since Supabase returns at most 1000 rows per request without
  saying so) and writes through table
  inserts/updates for simple changes and SQL functions for multi-row ones.
- `memoryStore` — in-memory, any password signs in. Used when the build sets
  `VITE_DATA_STORE=memory` (the Playwright build). It must enforce the same rules
  as the database (card credits, transfers, payment envelopes, income).

After every change the controller reloads all data (`budget.change`), so pages
always show what the store holds.

### Configuration

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — in `.env.local` locally and as
  repository Actions variables for the deploy build. Never the service-role key.
- `VITE_DATA_STORE=memory` — the in-memory store (UI tests).
- `.env.test` — the test project (`--mode test`, seed script, database tests);
  see `docs/testing.md`.
- `vite.config.ts`: `base: "/budget-buddy/"`, `vite-plugin-pwa` with
  `registerType: "autoUpdate"`, manifest (name/short name "Budget Buddy",
  `start_url`/`scope`/`id` = base, `display: standalone`, background `#faf8fc`,
  theme `#4b2a68`, icons per CLAUDE.md), `__APP_VERSION__` from `package.json`,
  a build check (no secret-looking `VITE_` variable; production never points
  at the test project), and the Vitest projects `unit` and `integration`.

### Commands and CI

`npm run dev | build | preview | typecheck | lint | format | format:check |
test (= test:unit) | test:ui | test:integration | test:ui:db | db:seed:test`.
UI tests build with the memory store into `dist-e2e/` and run against
`vite preview` on port 4173: every spec at phone width (Pixel 7), and
`*.desktop.spec.ts` at 1280×800 (the desktop layout); `test:ui:db` builds with
`--mode test` into `dist-e2e-db/` (port 4174) and signs in as test user A.

GitHub Actions: `deploy.yml` runs on pushes to `main` and on pull requests:
`npm ci`, `format:check`, `lint`, `npm test` (unit), `build`. Only pushes to
`main` deploy to Pages. `tests.yml` runs on pull requests: the UI tests, and
the integration and `test:ui:db` tests against the test project using
repository secrets (skipped without them).

## 3. Data model

All money is integer cents (`bigint`), signed: inflow positive, outflow negative.
Every table except `households` has `household_id`; foreign keys between
household tables include `household_id`, so rows can never point into another
household. Row Level Security on every table allows a signed-in user only rows
of a household they belong to (`private.is_household_member`). Signed-out
visitors get nothing.

| Table                     | Key columns and rules                                                                                                                                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `households`              | name (1–100 chars). Created only by `create_household`.                                                                                                                                                                                                                 |
| `household_members`       | household, user (one household per user), role `owner`/`member`.                                                                                                                                                                                                        |
| `accounts`                | name, `type` (`checking`/`credit_card`), `on_budget`, `opening_balance`, `opening_date`, `closed_at`, `import_format` (JSON, ≤ 8 KB). Never deleted.                                                                                                                    |
| `category_groups`         | name, `position`. Deletable only when empty.                                                                                                                                                                                                                            |
| `categories` (envelopes)  | group, name, `position`, `card_account_id` (set on a card's payment envelope; unique per card). Deletable only with no transactions; deleting removes its months (their Assigned returns to Available to Assign).                                                       |
| `category_months`         | (envelope, `YYYY-MM`) → `assigned` (may be negative after moves), `released` (≥ 0), `planned` (≥ 0).                                                                                                                                                                    |
| `transactions`            | account, date, amount (≠ 0), payee (≤ 200), memo (≤ 500), `is_transfer`, `transfer_id`, `is_income`, `voided`, `source` (`manual`/`csv`), `import_key` (unique per account), `reconciled` (a mark only).                                                                |
| `transaction_allocations` | transaction, envelope, amount. One row per envelope (several = a split), each envelope at most once, each with the transaction's sign. Must sum to the transaction amount (checked at commit). None for transfers, income or card credits; never to a payment envelope. |
| `income_rules`            | `pattern` (2–100 chars), `account_id` (null = any account).                                                                                                                                                                                                             |

Database checks (constraint triggers, deferred to commit where noted):
`is_transfer = (transfer_id is not null)`; a transfer is exactly two rows in
different accounts that cancel out (deferred); `is_income` only on positive,
non-transfer rows and never on a card account; allocations balance and share
the transaction's sign (deferred).
Foreign keys that mark something "in use" are deferred `no action`, so deleting
a whole household cascades but deleting a used account/envelope/group fails.

SQL functions (all `security invoker` except `create_household`):

| Function                                                         | Does                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_household(name)`                                         | Creates a household and makes the caller its owner (refuses a second one).                                                                                                                                                                                                                                                 |
| `adjust_category_month(envelope, month, Δassigned, Δreleased)`   | Adds to (never overwrites) a month's Assigned/Released, creating the row.                                                                                                                                                                                                                                                  |
| `move_between_envelopes(from, to, month, amount)`                | Moves Assigned between envelopes in one step.                                                                                                                                                                                                                                                                              |
| `save_transaction(…, is_transfer=false, is_income, allocations)` | Creates/updates one non-transfer transaction and its allocations (≤ 50 lines of `{category_id, amount}`; empty = Uncategorized); turning a transfer side into an ordinary transaction releases the other side.                                                                                                             |
| `save_transfer(transfer_id, legs)`                               | Saves both sides of a transfer (new rows or existing ones, e.g. an imported row being linked); sides the transfer no longer has are released.                                                                                                                                                                              |
| `import_transactions(account, format, rows)`                     | Inserts imported rows (≤ 2000) as `source='csv'`, skipping existing `import_key`s, applies `is_income` (never on cards); a row with `match_id` gives that typed-in transaction its `import_key` (and `source='csv'`) instead, all or nothing; saves the account's `import_format`, returns how many were added or matched. |
| `import_envelope_plan(household, month, rows)`                   | Creates missing groups/envelopes (names match ignoring case) and sets Planned for the month (≤ 500 rows).                                                                                                                                                                                                                  |
| `mark_income(ids)`                                               | Marks plain Uncategorized inflows (not on cards) as Income; returns the count.                                                                                                                                                                                                                                             |
| `set_reconciled(ids, reconciled)`                                | Marks (or unmarks) up to 2000 transactions reconciled with the bank; rows already so are left alone; returns how many changed.                                                                                                                                                                                             |
| `reorder_category_groups(household, ids)`                        | Saves the order of the household's groups; the list must name every group once.                                                                                                                                                                                                                                            |
| `reorder_categories(group, ids)`                                 | Saves the order of a group's envelopes; the list must name every envelope of the group once.                                                                                                                                                                                                                               |
| `export_backup(household)`                                       | Returns the whole household as one backup JSON object (one statement, so a consistent snapshot); see "Backup" under Settings.                                                                                                                                                                                              |
| `restore_backup(household, backup)`                              | Loads a backup into an empty household, all or nothing (cards inserted closed so the trigger-made payment envelopes can be swapped for the exported ones); renames the household.                                                                                                                                          |

Triggers also: create/rename/protect each card's payment envelope (in the
group that holds the other cards' payment envelopes, else "Credit card
payments"; named "⟨card⟩ payment" and renamed only with its card); release a transfer's other
side when one side is deleted (a typed-in side is deleted, an imported one kept
as Uncategorized). Errors with codes `23514`, `23505`, `P0002`, `22023`, `42501`
carry readable messages shown to the user; `23503` shows "It is still in use".

## 4. Budget rules beyond CLAUDE.md

These are implemented in `budgetMath.ts` and the controllers:

- **Assign limit:** assigning in month M is limited to the smallest Available to
  Assign of M and every later month with data (`assignableIn`), never below 0.
  Message: "Only $X is available to assign in ⟨Month YYYY⟩."
- **Take back:** a negative Assign may take back at most the envelope's current
  Remaining.
- **Release from Saved:** amount above 0 and at most Saved.
- **Planned:** 0 or more; input only.
- **Cover prompt** (spending into an envelope, or a card payment from its payment
  envelope, that would make Remaining negative): title "⟨Envelope⟩ would be $X
  short in ⟨Month⟩". Step 1 releases this envelope's Saved automatically; for the
  rest, a "Cover $X from" envelope picker offers other envelopes with enough Remaining
  this month (moved) and Available to Assign (assigned, only if `assignable`
  allows). If neither can cover it, saving is blocked with an explanation (card
  payments never suggest Uncategorized). Cover actions happen in the
  transaction's month.
- **Covering a split:** each envelope the split would overdraw gets its own
  prompt, one at a time ("Envelope 1 of 2 to cover", "Cover and continue", then
  "Cover and save"). Choices are worked out as the budget would be after the
  save and the covers already chosen (`budgetWith`), so an envelope this split
  also spends from offers only what it has left, and Available to Assign shrinks
  by earlier covers. Nothing is saved until the last prompt; Back returns to the
  form.
- **Envelope visibility:** `envelopeInUse` (CLAUDE.md Rules).
- **Envelope months:** an envelope with no record in a month carries Saved
  forward from its last month.

## 5. Screens

### App shell

- Max width 30rem, centred; on wider screens it floats as a rounded card.
- Header: icon + "Budget Buddy" (links to `#budget`), the version (e.g. "v0.24.0"), and
  an Install button when the browser offers installing.
- Bottom navigation (fixed): Budget, Accounts, Settings, with icons; the
  current page is highlighted. Page title is "⟨Page⟩ | Budget Buddy".
- Hash routes (`src/models/routes.ts`): `#budget`, `#budget/YYYY-MM`,
  `#accounts` (the list), `#accounts/all` (All accounts open),
  `#accounts/<account id>` (one account open), each Accounts route with an
  optional `/YYYY-MM` at the end, and `#settings`; anything else shows
  Budget. The old `#activity` and `#activity/YYYY-MM` open All accounts, and
  the address is rewritten (`history.replaceState`). Without a month, Budget
  and Accounts show the month last shown on either (else the current month),
  and their nav links carry it (`routeHref`).
- Floating round + button (bottom right, above the nav) on Budget and
  Accounts opens the transaction dialog; with an open account on Accounts it
  starts in that account.
- Credit card debt: while the cards owe anything today (`cardDebt` in
  `src/models/accounts.ts`, display only), every page shows "CREDIT CARD
  DEBT" (14px) and the amount (26px) in a rounded strip with 12px space
  above and below: under the month band on Budget (above Available to
  Assign) and Accounts, and at the top of Settings. Its background is one of 30 reds, pale to deep
  (`SHADES` in `src/models/cardDebtShades.ts`), picked at random once per
  page load, so it changes with every refresh; the text is near-black or
  white, whichever reads better (at least 4.5:1). Hidden at $0.00 or less.
- States: "Loading Budget Buddy…", sign-in, create household, or the app.

### Desktop layout (1000px and up)

Proposal and decisions: `docs/proposals/desktop-layout.md`. Signed in on a
window at least 1000px wide (`DESKTOP_QUERY` in `layoutPrefs.ts`, followed
live by `useDesktop`), App adds `.desktop` to the shell; below that, or
signed out, everything is as above.

- No header or bottom bar. A sidebar on the left (`aside` "Sidebar",
  13rem): the logo, "Budget Buddy" and the version; "+ Add transaction"
  (not on Settings; opens the same dialog); the pages ("Primary
  navigation"); Install (when offered); the household name and email; and
  "Collapse" (`Collapse sidebar` / `Expand sidebar`), which shrinks it to
  icons (names kept for screen readers). From 1000 to 1199px it always shows
  icons only and has no Collapse button.
- Collapsed sidebars are remembered per device and user in localStorage
  (`bb.layout.navCollapsed.<userId>`, `bb.layout.panelCollapsed.<userId>`,
  "1" or "0"; unreadable means expanded), never in Supabase.
- "+ Add transaction" opens the dialog on Budget and the Accounts list; with
  All accounts or an account open it opens the new transaction row instead.
- Every page uses the width up to 1600px, centred.
- A right-hand panel (`SidePanel`, an `aside` named for what it shows) sits
  beside a page's list, sticky under its band. Its top-right button ("Hide
  panel" / "Show panel") collapses it to a thin rail; choosing something
  opens it again.

### Sign in

Email and password, and Sign in. There is no create-account form or link:
public sign-up is off in Supabase Auth, and the owner adds each household
member in the dashboard (Authentication → Users → Add user, with a password of
at least 12 characters and "Auto confirm"). Sign-in uses PKCE so a `?code=` in
the URL leaves the `#route` alone.

### Create household

One field, "Household name", and Create. Shown when the signed-in user has no
household yet.

### Budget

Mockup: `docs/mockups/budget-screen.html` (design "J"; sample amounts).

- No page title or totals (the `h1` exists for screen readers only).
- Month picker (‹ OCTOBER 2026 ›, 44px buttons) in a purple band; changes
  `#budget/YYYY-MM` and scrolls away.
- Sticky "Available to Assign" banner pinned to the top (hidden at exactly
  $0.00), styled like the Credit card debt strip (14px uppercase label, 26px
  amount, rounded) on solid green with white text, no purple behind it. Over
  assigned: solid red, labelled "Over Assigned" with the amount over. The
  banner is a button that opens "Assign money" (a dialog): an envelope picker
  (every envelope, unused and payment envelopes too, each with "has $X", its
  Remaining) and "Amount to add" (above zero), added on top of the envelope's
  Assigned (`assignFromAvailable`; refused beyond Available to Assign). When
  over assigned it is "Take back from an envelope" with "Amount to take back"
  (starting at the amount over; at most the envelope's Remaining), which
  returns money to Available to Assign. This month's income is on the desktop
  month summary only.
- Notices: "N transactions to review ($X in, $Y out) are not in Available to
  Assign yet. Review them in All accounts."; no accounts → link to Accounts; no
  groups → link to Settings.
- "No plan for ⟨month⟩ yet" (a dashed purple card under the notices), when the
  month opens with every Planned at $0.00: "Copy ⟨last month⟩’s Planned" and
  "Copy ⟨last month⟩’s Spent" (each only when last month has some; they fill
  Planned only where it is still $0.00, card payment envelopes left out) and
  "Upload a plan CSV" (a bottom sheet with the plan import for this month, no
  month field; it closes after importing). The card goes after a copy or an
  upload, and otherwise stays until the month is opened again.
- Each group: a full-width tinted bar. Its name (with a chevron) is a button
  that collapses or expands the group's envelopes (`aria-expanded`,
  `aria-controls`); open, the bar shows no numbers; collapsed, the chevron
  points right and the bar shows "N envelopes" and the group's total left
  ("$650.33", heard as "$650.33 remaining"). Collapsed groups are kept in
  localStorage under `bb.budget.collapsedGroups.<userId>` (a JSON array of
  group ids; ids of deleted groups are pruned on the next save; unreadable
  storage means all open), so they stay collapsed across reloads, pages,
  months and renames; new groups start open. Collapsing saves an open
  Planned/Assigned field first. The + opens "New envelope" (+ becomes ×) and
  opens a collapsed group.
- "Compact rows" (phone only; a switch under the month in the purple band,
  `aria-pressed`): every envelope shows only line 1 (name, Saved and what is
  left); Planned, Assigned, Spent, Refunded and Short are hidden until it is
  switched off (the sheet still shows them). Kept in localStorage under
  `bb.budget.compactRows.<userId>` ("1" or "0"; unreadable means off).
- Envelope rows as in CLAUDE.md. Spent shows with a minus ("−$45.20", a true
  minus sign; "$0.00" when nothing is spent), in the cell's usual colour. Planned and Assigned cells are buttons ("Edit
  planned amount for Groceries, currently $300.00"). Planned turns into a text
  field in place. On a phone Assigned opens the number pad (`PadAmount`,
  `src/views/AssignPad.tsx`): a dialog along the bottom ("Assigned for
  ⟨name⟩") with 0–9, a decimal point, delete, − and + and a green Assign key;
  the field is scrolled clear of it. Digits first type a new total; + or −
  builds an equation on the current amount ("120.00 + 50", "120.00 − 20",
  several terms allowed), shown in the Assigned cell as it is typed and in the
  pad with its result ("= $170.00"). Assign saves the result (minus returns
  money to Available to Assign); × or tapping outside cancels; a refused
  amount keeps the pad open with the reason. A keyboard works in the pad too
  (digits, ., + and −, Backspace, Enter). On a desktop Assigned is typed in
  place and takes the same equations ("+50", "350 − 100";
  `evaluateAmount` in `src/models/amountEquation.ts`). Errors show under the
  row (in the pad for the pad) ("Only $X available to assign.", "Some is
  already spent: Assigned can go no lower than $X.", "Planned cannot be
  negative."). Edits show at once (an optimistic update) and are undone if the
  save fails. Card payment envelopes show Available to pay and Remaining debt
  cells.
- Tapping an envelope's top line opens its sheet ("⟨name⟩ envelope", a bottom
  sheet; close with × or Escape):
  - the group as a small purple picker ("Group for ⟨name⟩"; choosing another
    group moves the envelope to the bottom of it, money and history included;
    a card's payment envelope shows its group as plain text) over the envelope
    name, with a pencil button to rename it
    ("Envelope name"; blur or Enter saves, Escape puts the name back; not on
    a card's payment envelope, which is named after its card);
  - "Remaining this month" (large) and how it adds up ("$300.00 assigned +
    $20.00 released − $187.06 spent"; released and refunded only when used),
    plus Short if overspent;
  - the plan line: "Spent $X of $Y planned" with "$Z under", "On plan" or
    "$Z over" (orange), or "nothing planned this month";
  - Planned and Assigned fields (blur or Enter saves, Escape undoes the typing
    without closing; same checks as the cells; on a phone Assigned opens the
    number pad over the sheet) and Spent;
  - Saved: purple with sparkles and "Move some into Remaining…" (opens "Amount
    to move into Remaining" + Move, i.e. Release from Saved); at $0.00 a quiet
    "Nothing saved yet" panel;
  - "This month's transactions": date, payee, account, this envelope's amount
    (a split shows "part of a $X split"); each is a button ("Edit ⟨payee⟩,
    ⟨amount⟩, ⟨date⟩") that opens the transaction edit dialog over the sheet,
    which stays open and updates after a save or delete;
  - Delete envelope (confirm: money assigned returns to Available to Assign).
    A card's payment envelope sheet shows Available to pay, "Owed $X · Remaining
    debt $Y", "Assign (negative to take back)", the Saved panel and how it fills,
    and no Delete.
- "Show N envelopes not used this month" toggle when some are hidden.
- **Desktop** (see Desktop layout):
  - One purple band, pinned to the top, holds the month picker (left) and
    the Available to Assign banner centred across the band (same rules).
  - Envelopes are a table with a sticky column head (Envelope, Planned,
    Assigned, Spent, Remaining): one line per envelope (name and Saved pill,
    then the cells without their labels, then what is left). A card's payment
    envelope shows Available to pay and Remaining debt, labelled, across the
    three cell columns. Group bars show their total under Remaining when
    collapsed and the + in the last column. Refunded and Short sit on a line
    below, under the cells.
  - Clicking an envelope's name shows it in the panel instead of a sheet
    (highlighted row, `aria-expanded`): the sheet's content without its
    handle; × goes back to the summary. Tapping one of its transactions
    puts the edit form in the panel ("‹ Back to ⟨envelope⟩", Save, Cancel,
    Delete and cover prompts all return to the envelope).
  - With no envelope chosen the panel shows the month at a glance (display
    only): Income, Assigned, Spent and In Saved (`totals` of the month), then
    lists of envelopes "Spent over Planned" ("$X over"), "Short" and "Card
    debt not covered" (`monthWatchList` in `envelopeDetail.ts`; each opens
    its envelope), and "Choose an envelope to see its details here."

### Accounts

Accounts and Activity became one page in v0.29.0
(`src/views/pages/AccountsPage.tsx`, `AccountView.tsx`,
`src/views/transactions/`). A visually hidden "Accounts" heading; rows run
edge to edge. What is open lives in the URL (see App shell), so Back closes
it and a reload keeps it. Opening something starts at the top of the page;
the list comes back where it was scrolled.

**The list** (nothing open):

- The month band as on Budget ("OCTOBER 2026", ‹ › links to
  `#accounts/YYYY-MM`) with "+ Add account" on the right (phone), which opens
  "Add an account" in a sheet: Checking / Credit card choice, Account name,
  "Opening balance" (checking) or "Amount owed on the opening date" (card),
  Opening date (default today); a card shows a short explanation of its
  payment envelope. Adding closes the sheet. Then the card debt strip.
- "All accounts" first, with the month's money in and out under it ("In
  +$X · Out −$Y", transfers left out, as on All accounts).
- Then groups (`groupAccounts` in `src/models/accounts.ts`): CHECKING,
  CREDIT CARDS, TRACKING (off-budget accounts; none can be created yet), each
  a tinted bar like Budget's groups, empty ones left out; accounts by name.
- An account row is a link ("Open ⟨name⟩, balance $X"), at least 48px tall:
  name (15px, 800) on the left, balance (20px, 800, tabular; red when
  negative, so a card shows what it owes as −$X) on the right. Balance =
  opening balance plus every transaction (`accountBalance`).
- Closed accounts are hidden behind "Show closed accounts (N)" at the bottom
  (not remembered); their transactions still show in All accounts.
- Empty: "No accounts yet. Add your checking account with + Add account."

**An account open** (`#accounts/<id>`):

- The month band (‹ › keep the account open), the card debt strip, then the
  info pane, pinned to the top while the list scrolls (with the bar of
  ticked rows under it): an edge-to-edge `#F3EEF8` band, no frame around it.
  - Line 1: back arrow (44×44, a full arrow, white on a solid purple
    circle, "Back to accounts", a link to the list), the account name
    (`<h2>`; "Closed" tag on a closed account), and a pencil (44×44, "Edit
    ⟨name⟩") on an open account.
  - Figures (`accountFigures` in `activity.ts`, display only; label 9px
    uppercase, amount 15px 800), three columns. Row 1: MONEY IN (green) and
    MONEY OUT (red) for the month shown (the account's inflows and outflows
    dated in it, transfers (card payments too) left out, a split once at
    its full amount, inflows to review included), CURRENT BALANCE (every
    transaction, any date). Row 2: OPENING BALANCE (as entered, signed: a
    card owing $50 shows −$50.00), MONTH START (every transaction dated
    before the month's first day: `accountBalance` with `before`),
    RECONCILED (opening balance plus reconciled transactions). Month start
    plus the month's net activity is the next month's start. Only the month
    figures follow the month picker.
  - "Import CSV" (an open account only) opens the bank import already set to
    this account (no account picker) in a sheet with Close.
- The To review card for this account only (as on All accounts).
- Every transaction in the account, any month, newest first
  (`accountHistory`): a month divider ("OCTOBER 2026", 12px, purple, an
  `<h2>`) above each month, then day headings (`<h3>`, "FRI DEC 12, 2025"
  when not this year) whose net leaves transfers out. Rows as on All
  accounts without the account line, except a transfer's "From → To"; a
  transfer is signed by its side in this account and edits its money-out
  side. Changing the month does not change or reload the list.
  Empty: "No transactions in ⟨account⟩ yet."
- The pencil opens "Edit ⟨name⟩" in a sheet (focus returns to the pencil
  when it closes): Save changes, Cancel, and Close account at the bottom
  (confirm; only at $0.00), which returns to the list. Edit keeps the type;
  the opening date cannot move past the first transaction. Saving updates
  the pane at once.

**All accounts open** (`#accounts/all`, the old Activity page, one month):

Mockup: `docs/mockups/activity-screen.html` (from v0.21.0; the account
picker it shows is gone).

- The info pane has the back arrow, "All accounts", and the totals strip,
  display figures from `activityMonth` and `activityBalance`, not Available
  to Assign: IN (green, "+$X") and OUT (red, "−$X") for the month, dated in
  it, budget accounts only, voided left out, a split once, transfers left
  out (their sides cancel). BALANCE TODAY: opening balances plus everything
  dated today or earlier, whatever month is shown (`accountBalance` with
  `through`), to compare with the bank. Under it, without a card:
  "Reconciled $X" (opening balances plus reconciled transactions); with a
  card the balance is cash minus card debt (it can be negative), with "Cash
  $X · Cards owe $Y" under it. No pencil or import.
- "No accounts" notice, then the "To review" card when anything waits (from
  any month): totals in and out, rows (tap to edit), "Mark as Income" on
  non-card inflows, "Apply income rules (N matches)", "Mark all N inflows as
  Income" (confirm), link to Settings income rules.
- Days with transactions, newest first: a tinted heading ("THU OCT 15", an
  `<h2>`) with the day's net on the right (signed; transfers left out, so
  $0.00 for a day of only transfers). Within a day, newest first.
- Empty month: "No transactions in ⟨Month YYYY⟩." with $0.00 totals.

**Both lists:**

- 100 rows at first (`firstRows`); "Show N more (M left)" (full width, 44px)
  adds 100 more and disappears when everything shows. Everything is already
  loaded, so a page is a slice of one sorted list: no rows repeat or go
  missing when one is added between pages. A split is one row (its parts
  come with it); a day cut short keeps its heading and full net, and the
  next rows continue under it. Edits keep the rows shown and the scroll
  position. A different account (or month on All accounts) starts at 100.
- Row (grid 22px | 16px | payee | envelope | 84px): a checkbox ("Select
  ⟨payee⟩, ⟨amount⟩"); a bank icon (`role="img"`): grey outline "Not
  reconciled", green and filled "Reconciled" (imported or typed makes no
  difference); payee over account (a button, "Edit ⟨payee⟩, ⟨amount⟩,
  ⟨account⟩", that opens the edit dialog; the payee is regular weight, bold
  only while the row is to review; the amount is always bold); the envelope,
  Income, Transfer, Card credit, or Uncategorized (amber label); the amount
  ("−$X" red, "+$X" green, a transfer the same by its side in the open
  account, or on All accounts by the side it is shown from, usually "−$X"; a
  split's parts the same). Closed accounts keep their name.
- Ticking rows (reconciling): a ticked row is highlighted. While any is
  ticked, a purple toolbar ("Selected transactions") sits under the info
  pane: "N selected", their total (signed), "Mark reconciled" (when one is
  not), "Mark unreconciled" (when one is), and × to clear; the count is
  announced (`aria-live`). Marking saves in one step (`setReconciled`) and
  clears the ticks. A split is ticked as a whole. A transfer stands for its
  side in the open account, or both sides (adding $0.00) on All accounts; it
  shows reconciled when every side it stands for is. Opening something else
  (or another month on All accounts) clears the ticks. Reconciled is only a
  mark: it changes no budget math and does not stop editing. To review rows
  have no checkboxes.
- A transfer is one row: its money-out side's date and payee, "From → To".
- A split shows a "Split (N)" pill (`aria-expanded`, "Close/Open split for
  ⟨payee⟩", chevron) instead of an envelope, and its parts underneath (dashed
  top border, "↳ ⟨envelope⟩", envelope, signed amount). Every split starts
  open; closing is kept until something else opens.

**Desktop** (see Desktop layout):

- One purple band, pinned to the top, holds only the month picker; the card
  debt strip sits under it.
- The list: in a card on the left; the panel on the right holds "Add an
  account" ("No accounts yet. Add your checking account on the right."); no
  - Add account button.
- Something open: the info pane (pinned under the band), the ticked-rows
  bar and the rows sit in a card: checkbox | bank icon | payee over account
  | envelope | memo (muted, cut short with …) | amount; a split's parts line
  up below.
- The panel shows the To review card (same content and buttons; "Nothing to
  review…" when empty) until something is chosen: a transaction (in the
  list or in To review; the row is highlighted), the pencil ("Edit ⟨name⟩",
  focus returns to the pencil after), or Import CSV ("Import CSV into
  ⟨name⟩"). "‹ Back to To review", Save, Cancel and Delete return to To
  review; closing the account returns to the list.
- Add transaction opens "New transaction" at the top of the list: the
  transaction form with its fields side by side in their usual order
  (wrapping as needed; splits, transfer notes and errors on lines of their
  own), starting in the open account, with Payee focused. Save (after any
  cover prompt, shown in the row), Cancel or Escape closes it.

### Transaction dialog (add and edit)

Fields: Outflow/Inflow, Amount (> 0), Payee, Envelope, Account, Date (default
today), Memo; then Save (adding) / Save changes, Cancel, and (editing)
Delete transaction / Delete transfer.

Envelopes are chosen with the envelope picker (`EnvelopePicker`, used for the
Envelope field, split lines, the cover prompt and the Assign dialog): a text
field (a combobox) whose matches drop down under it, grouped under their group
names, each with "has $X" on the right. Every typed word must start a word of
the envelope's name or group, in any order ("car ins"; `matchOptions` in
`src/models/envelopeSearch.ts`). Tap a match, use the arrows and Enter, or type
the full name (Enter or leaving the field picks it); anything else puts the
choice back. Escape closes the list only. The chosen envelope shows its "has
$X" in the field.

Envelope choices: Uncategorized; Income (to Available to Assign) — disabled for
outflows; Split across envelopes; Transfer — needs two open accounts; then each
group's envelopes (payment envelopes excluded), each with "has $X", its
Remaining in the month of the form's Date as the
Budget page shows it now (before this save; `useEnvelopeRemaining`). The split lines' envelope
choices show the same amounts. On a credit card with Inflow,
only "Card credit (lowers what you owe)" and Transfer are offered (so card
purchases can be split, card credits cannot).

Split shows lines of envelope + amount (positive; the transaction's direction
applies to every line), starting with two (the envelope already chosen fills
the first). "+ Add line" (up to 50), × removes a line (at least two stay),
a live "$X left to split" / "$X too much" / "Adds up", and "Put the rest in the
last line". Saving needs the lines to add up, each line an envelope and an
amount above $0.00, and no envelope twice (`src/models/splits.ts`). Picking a
single envelope (or anything else) again undoes the split. Editing a split
loads all its lines.

Transfer adds "To account" (outflow) / "From account" (inflow), an "Other side"
choice when there are candidates (bank rows up to 31 days away, "Keep …", "Add a
new transaction instead"), and a note saying what will happen ("Links to the
⟨account⟩ transaction on DATE (PAYEE), so it is not added twice.", "Also adds
the matching inflow in ⟨account⟩.", "Also updates the ⟨account⟩ side.").

### Settings

In order: household name and "Signed in as ⟨email⟩"; About (version); Sign out;
Envelope groups; Import transactions; Income rules; Import envelope plan;
Backup.

- **Envelope groups:** list with envelope counts, a six-dot drag handle on the
  left of each row (mouse, touch, or keyboard: Space, arrows, Space) to reorder
  the groups on the Budget page, and "Group name" + Add group. Tapping a group
  opens its bottom sheet: the name with a pencil button to rename it, its
  envelopes with drag handles to reorder them (tap a name to rename it; a
  "Move to…" picker moves it to the bottom of another group and says "Moved
  ⟨name⟩ to ⟨group⟩."; a card's payment envelope can do neither), and Delete
  group (confirm) when
  it has no envelopes ("Only an empty group can be deleted." otherwise). A
  new order shows at once and is saved for the whole list.
- **Import transactions:** see §6.
- **Income rules:** list ("Contains “TEXT”", account or Any account, Delete);
  "Description contains" + "In account" + Add rule; when waiting inflows match:
  "N inflows waiting for review match your rules. Mark them as Income".
- **Import envelope plan:** month (default current), CSV file, preview with
  new groups/envelopes and Planned changes, invalid rows by line, then Import.
- **Backup** (`src/models/backup.ts`, `useBackup`, `BackupSection`): "Export
  all data" saves `budget-buddy-backup-YYYY-MM-DD.json` (format
  `budget-buddy-backup`, version 1) and says what it holds (counts and the
  months with transactions or a stored Planned/Assigned/Released). The file
  mirrors the tables without `household_id`: household name, accounts (closed
  ones, `import_format`), groups, envelopes (`card_account_id`), envelope
  months, transactions (`reconciled`, `voided`, `import_key`, `source`,
  `transfer_id`, `is_income`, `created_at`), allocations and income rules.
  "Restore from a backup" reads a file, checks every database rule first
  (`validateBackup`: types and limits, unique ids/months/split
  envelopes/import keys per account, links, one payment envelope per card and
  none allocated to, transfer pairs, split sums and signs, Income and card
  credits) and shows what it holds. Restore only works while the household
  has no budget data (otherwise the file can still be checked); every row
  gets a fresh id (`withFreshIds`) and the household takes the backup's name.
  Collapsed groups and layout preferences (localStorage) are not included.
- **Desktop:** the sections in two columns under the heading; Import
  transactions (and its preview) spans both. Group sheets stay sheets.

## 6. Bank CSV import

1. Choose an open account and a `.csv` (≤ 2 MB). RFC 4180 parsing; a UTF-8 BOM
   is ignored.
2. **Table:** the most common number of cells per row decides the table; rows
   above it (bank titles, date ranges) are skipped. The first row is a header
   unless a cell looks like a date. At most 2000 rows.
3. **Format** (saved per account and reused when the headers match): columns
   are matched by normalized header name (lowercase letters and digits only):
   - Date: `date, transactiondate, transdate, posteddate, postingdate, postdate`
   - Amount: `amount, transactionamount, amountusd`; else Money out `debit,
debits, withdrawal, withdrawals, moneyout, debitamount, outflow` with Money
     in `credit, credits, deposit, deposits, moneyin, creditamount, inflow`
   - Description: `description, payee, name, merchant, details,
transactiondescription, originaldescription, merchantname`
   - Notes: `memo, notes, note, extendeddescription`
   - Bank transaction ID: `transactionid, referencenumber, reference, refnumber,
fitid, transactionnumber, id`
   - Without a match: a column where 80%+ of values look like dates/amounts
     (skipping a `balance` column); description = the longest remaining text.
   - Date order: month-first unless a value proves day-first (first part > 12)
     or year-first (4-digit first part). Two-digit years mean 20YY. Also reads
     "Oct 12, 2026".
   - Amounts accept `-$18.62`, `1,234.56`, `+5`, `(18.62)` (negative), `−`.
   - "Spending is shown as positive: flip signs" for card exports; a hint shows
     when 70%+ of amounts (3 or more) are positive.
4. **Preview:** "N new transactions from DATE to DATE: $X in, $Y out." plus
   duplicates skipped, rows before the opening date skipped, invalid rows (by
   line, with the reason), how many inflows income rules will mark, and how
   many rows will be matched to transactions you entered. Description over
   200 characters is kept whole in the memo. The button says what it does:
   "Import N transactions", "Match N transactions" or "Import N and match M".
5. **Duplicates:** key `id:⟨bank ID⟩`, or without one
   `fp:⟨date⟩|⟨cents⟩|⟨description lowercased⟩|⟨n⟩` (n counts identical rows in
   the file). Keys already in the account, or repeated bank IDs, are skipped.
6. **Matching typed transactions** (`findImportMatches`): a new row matches a
   transaction typed into the same account (no import key, not voided; transfer
   sides and splits too) with the same amount, dated within
   `IMPORT_MATCH_DAYS` (10). Each side matches once; the closest dates pair
   first, then file order. Matches are listed in the preview ("Matched to
   transactions you entered": your payee and amount, "You entered DATE · bank:
   DATE, DESCRIPTION", a Match checkbox, ticked). A matched row adds nothing:
   the typed transaction takes its import key (so the
   row is a duplicate next time) and keeps everything entered (date, payee,
   memo, envelopes, Income, transfer). Unticked, the row is imported as new.
   If a typed transaction changed before saving, the import fails with "A
   transaction to match has changed since the preview. Choose the file again."
7. Import adds everything else as Uncategorized (to review) except card
   credits; income-rule matches arrive as Income.

## 7. Envelope plan CSV

Columns `category, group, planned amount` (header optional; with a header the
columns may be in any order: `category|envelope`, `group|categorygroup|
envelopegroup`, `plannedamount|planned|plan|amount`). A first row whose third
cell is an amount is data. ≤ 500 rows; names ≤ 100 characters; planned ≥ 0.
Envelopes not in the file are left alone.

## 8. Look and feel

- Font: Inter, falling back to the system UI font.
- Colours (`:root` in `styles.css`): page `#ece7f2`, app background `#faf8fc`,
  surface `#ffffff`, muted surface `#f2ecf7`, border `#e3dbe9`, text `#281a35`,
  muted text `#74677e`, brand `#4b2a68`, light brand `#eee5f7`, accent `#8051a2`,
  focus `#d29a3b`; negative money and errors red `#b3261e`; Uncategorized label
  `#ffe2a8` on `#6b4500`.
- Cards: white, 1px border, rounded (1–1.35rem), soft purple shadow; page side
  padding 0.5rem on a phone.
- Money shows as `$1,234.56` / `-$12.50`; negative amounts in red.
  Transaction lists on Accounts use their own signs instead: "+$X" (green), "−$X" (a true minus sign, ink),
  transfers too (`formatSignedCents`); the Budget page's Spent cells show
  "−$X" in their own colour.
- Saved above $0.00: larger, purple, shimmering gradient text with a twinkling
  ✨; no animation with "reduce motion".
- Modal dialogs: centred sheet up to 28rem wide with a dimmed backdrop.

## 9. Not built yet

Decided or wanted, but not in the app:

- Desktop: keyboard shortcuts; a group's envelopes beside the group list in
  Settings instead of a sheet; the accounts list kept as a left column
  while an account is open.

- Import and matching: matching a transaction typed after its bank row was
  imported (import already matches typed transactions to new rows, and
  transfers link to bank rows); undoing a match; skipping one row in the
  import preview.
- Deleting an imported transaction removes its import key, so the next CSV
  that covers its date adds it again (a card payment comes back as a card
  credit). Options: void instead of delete (`transactions.voided` exists but
  nothing sets it), or a per-row skip in the preview
  (`docs/proposals/bulk-actions.md`, problem 1).
- Bulk actions on ticked rows on Accounts beyond Mark reconciled: Delete, Mark
  as Income, Assign to an envelope, Move to account, and ticking rows in To
  review. Open decisions are in `docs/proposals/bulk-actions.md`.
- Reconciliation beyond the mark: entering a statement balance and
  finishing only when the ticked rows match it, locking reconciled rows,
  a separate cleared status, "Select all" for a day or month.
- Tithing/fast-offering rules.
- Inviting a second household member.
- Editing an income rule (delete and re-add instead).
- Budget page: an icon chosen per envelope (every row shows the same
  envelope icon, `EnvelopeIcon`; Settings shows none); "Collapse all" /
  "Expand all" for groups.
- Accounts lists: search and filters by envelope or status, a "Needs
  review" queue for transfer matches, running balances on each row, swipe
  actions (such as marking cleared), a memo per split part, and charts on the
  info pane. A "Reconcile" button with a statement difference (see
  reconciliation above).
