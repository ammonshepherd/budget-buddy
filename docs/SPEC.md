# Budget Buddy — specification

What the app does and how it is built, in enough detail to rebuild it. Three
sources together are the full picture; when they disagree, fix the docs:

| Source                      | Authoritative for                                  |
| --------------------------- | -------------------------------------------------- |
| `CLAUDE.md`                 | Decided envelope math, budgeting rules, process    |
| `supabase/migrations/*.sql` | The exact database: columns, constraints, SQL, RLS |
| This file                   | Everything else: structure, screens, import, look  |

Version described: 0.17.1.

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
`accounts.ts` (card opening balance sign), `activity.ts` (the Activity page's
month: rows by day, totals, day nets), `transfers.ts` (linked transfers and
matching), `transactionImport.ts` + `csv.ts` (bank CSV), `envelopePlan.ts` (plan
CSV), `incomeRules.ts`, `dataStore.ts` (the store interface), `supabaseStore.ts`,
`memoryStore.ts`, `store.ts` (picks one).

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
`vite preview` on port 4173 (Pixel 7 viewport); `test:ui:db` builds with
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
| `transactions`            | account, date, amount (≠ 0), payee (≤ 200), memo (≤ 500), `is_transfer`, `transfer_id`, `is_income`, `voided`, `source` (`manual`/`csv`), `import_key` (unique per account).                                                                                            |
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

| Function                                                         | Does                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_household(name)`                                         | Creates a household and makes the caller its owner (refuses a second one).                                                                                                                                     |
| `adjust_category_month(envelope, month, Δassigned, Δreleased)`   | Adds to (never overwrites) a month's Assigned/Released, creating the row.                                                                                                                                      |
| `move_between_envelopes(from, to, month, amount)`                | Moves Assigned between envelopes in one step.                                                                                                                                                                  |
| `save_transaction(…, is_transfer=false, is_income, allocations)` | Creates/updates one non-transfer transaction and its allocations (≤ 50 lines of `{category_id, amount}`; empty = Uncategorized); turning a transfer side into an ordinary transaction releases the other side. |
| `save_transfer(transfer_id, legs)`                               | Saves both sides of a transfer (new rows or existing ones, e.g. an imported row being linked); sides the transfer no longer has are released.                                                                  |
| `import_transactions(account, format, rows)`                     | Inserts imported rows (≤ 2000) as `source='csv'`, skipping existing `import_key`s, applies `is_income` (never on cards), saves the account's `import_format`, returns how many were added.                     |
| `import_envelope_plan(household, month, rows)`                   | Creates missing groups/envelopes (names match ignoring case) and sets Planned for the month (≤ 500 rows).                                                                                                      |
| `mark_income(ids)`                                               | Marks plain Uncategorized inflows (not on cards) as Income; returns the count.                                                                                                                                 |
| `reorder_category_groups(household, ids)`                        | Saves the order of the household's groups; the list must name every group once.                                                                                                                                |
| `reorder_categories(group, ids)`                                 | Saves the order of a group's envelopes; the list must name every envelope of the group once.                                                                                                                   |

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
  rest, a "Cover $X from" dropdown offers other envelopes with enough Remaining
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
- Header: icon + "Budget Buddy" (links to `#budget`), the version "v0.17.1", and
  an Install button when the browser offers installing.
- Bottom navigation (fixed): Budget, Accounts, Activity, Settings, with icons;
  the current page is highlighted. Page title is "⟨Page⟩ | Budget Buddy".
- Hash routes: `#budget`, `#budget/YYYY-MM`, `#accounts`, `#activity`,
  `#activity/YYYY-MM`, `#settings`; anything else shows Budget. Without a month,
  Budget and Activity show the month last shown on either (else the current
  month), and their nav links carry it (`routeHref`).
- Floating round + button (bottom right, above the nav) on Budget, Accounts and
  Activity opens the transaction dialog.
- States: "Loading Budget Buddy…", sign-in, create household, or the app.

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

- No page title or totals (the `h1` exists for screen readers only).
- Month picker (‹ OCTOBER 2026 ›, 44px buttons) in a purple band; changes
  `#budget/YYYY-MM` and scrolls away.
- Sticky "Available to Assign" card pinned to the top on the purple band
  (hidden at exactly $0.00): 6px green border, light green background, amount on the
  right, "Income this month $X" under the label. Over assigned: red, labelled
  "Over Assigned" with the amount over.
- Notices: "N transactions to review ($X in, $Y out) are not in Available to
  Assign yet. Review them on Activity."; no accounts → link to Accounts; no
  groups → link to Settings.
- "No plan for ⟨month⟩ yet" (a dashed purple card under the notices), when the
  month opens with every Planned at $0.00: "Copy ⟨last month⟩’s Planned" and
  "Copy ⟨last month⟩’s Spent" (each only when last month has some; they fill
  Planned only where it is still $0.00, card payment envelopes left out) and
  "Upload a plan CSV" (a bottom sheet with the plan import for this month, no
  month field; it closes after importing). The card goes after a copy or an
  upload, and otherwise stays until the month is opened again.
- Each group: a full-width tinted bar with the uppercase name and a + that
  opens "New envelope" (+ becomes ×); no totals.
- Envelope rows as in CLAUDE.md. Planned and Assigned cells are buttons ("Edit
  planned amount for Groceries, currently $300.00") that turn into a text field
  in place; errors show under the row ("Only $X available to assign.", "Some is
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
    without closing; same checks as the cells) and Spent;
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

### Accounts

- Open accounts: name, balance (red when negative), "Checking · opened DATE with
  $X" or "Credit card · opened DATE owing $X". Rows have no Edit/Close links:
  tapping a row opens "Edit ⟨name⟩" in a modal sheet (Save changes, Cancel,
  and Close account at the bottom: confirm; only at $0.00).
- "Add an account": Checking / Credit card choice, Account name, "Opening
  balance" (checking) or "Amount owed on the opening date" (card), Opening date
  (default today). A card shows a short explanation of its payment envelope.
- Edit keeps the type; the opening date cannot move past the first transaction.
- Closed accounts listed separately with their balance.

### Activity

Mockup: `docs/mockups/activity-screen.html`. Rows run edge to edge.

- Visually hidden "Activity" heading; the month band as on Budget ("OCTOBER
  2026", ‹ › links to `#activity/YYYY-MM`). No search yet.
- Totals strip (purple tint, three columns): IN (green, "+$X": non-transfer
  inflows, i.e. income, refunds, card credits), OUT ("−$X": non-transfer
  outflows, card purchases included), TRANSFERS (grey, each transfer once).
  Dated in the month, budget accounts only, voided left out, a split once.
  Display figures from `activityMonth`, not Available to Assign or balances.
- "No accounts" notice, then the "To review" card when anything waits (from
  any month): totals in and out, rows (tap to edit), "Mark as Income" on
  non-card inflows, "Apply income rules (N matches)", "Mark all N inflows as
  Income" (confirm), link to Settings income rules.
- Days with transactions, newest first: a tinted heading ("THU OCT 15", an
  `<h2>`) with the day's net on the right (signed, transfers left out; $0.00
  for a day of only transfers). Within a day, newest first.
- Row (grid 14px | payee | envelope | 84px): a status mark (hollow circle
  Uncleared = typed, filled circle Cleared = imported, filled square
  Reconciled, not used until reconciliation; `role="img"` with the name);
  payee over account (a button, "Edit ⟨payee⟩, ⟨amount⟩, ⟨account⟩", that
  opens the edit dialog); the envelope, Income, Transfer, Card credit, or
  Uncategorized (amber label); the amount ("−$X" ink, "+$X" green, a
  transfer unsigned grey). Closed accounts keep their name.
- A transfer is one row: its money-out side's date and payee, "From → To".
- A split shows a "Split (N)" pill (`aria-expanded`, "Close/Open split for
  ⟨payee⟩", chevron) instead of an envelope, and its parts underneath (dashed
  top border, "↳ ⟨envelope⟩", envelope, signed amount). Every split starts
  open; closing is kept only until the month changes.
- Empty month: "No transactions in ⟨Month YYYY⟩." with $0.00 totals.

### Transaction dialog (add and edit)

Fields: Outflow/Inflow, Amount (> 0), Payee, Envelope, Account, Date (default
today), Memo; then Add transaction / Save changes, Cancel, and (editing)
Delete transaction / Delete transfer.

Envelope choices: Uncategorized; Income (to Available to Assign) — disabled for
outflows; each group's envelopes (payment envelopes excluded); Split across
envelopes; Transfer — needs two open accounts. On a credit card with Inflow,
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
Envelope groups; Import transactions; Income rules; Import envelope plan.

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
   line, with the reason), and how many inflows income rules will mark.
   Description over 200 characters is kept whole in the memo.
5. **Duplicates:** key `id:⟨bank ID⟩`, or without one
   `fp:⟨date⟩|⟨cents⟩|⟨description lowercased⟩|⟨n⟩` (n counts identical rows in
   the file). Keys already in the account, or repeated bank IDs, are skipped.
6. Import adds everything as Uncategorized (to review) except card credits;
   income-rule matches arrive as Income.

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
- Money shows as `$1,234.56` / `-$12.50`; negative amounts in red. Activity
  uses its own signs instead: "+$X" (green), "−$X" (a true minus sign, ink),
  transfers unsigned (`formatSignedCents`).
- Saved above $0.00: larger, purple, shimmering gradient text with a twinkling
  ✨; no animation with "reduce motion".
- Modal dialogs: centred sheet up to 28rem wide with a dimmed backdrop.

## 9. Not built yet

Decided or wanted, but not in the app: matching
typed transactions to imported ones (other than transfers); reconciliation;
tithing/fast-offering rules; inviting a second household member; editing an
income rule (delete and re-add instead); an envelope icon next to each envelope
name on the Budget page and in Settings; on Activity: search and filters (account, envelope,
status), a "Needs review" queue for transfer matches, running balances, swipe
actions (such as marking cleared), a stored cleared/reconciled status, and a
memo per split part.
