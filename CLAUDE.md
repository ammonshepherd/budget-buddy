# Budget Buddy — guide for Claude

Envelope-budgeting Progressive Web App for a small household. The owner is
learning Vite, React and TypeScript: explain new concepts briefly in PR
descriptions and when asked, without being condescending.

This file holds the decided math, rules and process. `docs/SPEC.md` describes
everything else (structure, data model summary, screens, CSV import, look and
feel, what is not built yet), and `supabase/migrations/` is the exact database.
Keep all three in step when behaviour changes. Every version bump also
updates SPEC.md's "Version described" line to the new version, so the file
always describes the app as of that version (including §9, not built yet).

## Stack (decided)

- Vite + React + TypeScript, `vite-plugin-pwa` for installability.
- Supabase (Postgres + email auth + Row Level Security). Production project
  ref: `lkaurrcarzzkbqdwqfge` ("budget-buddy"). Test project ref:
  `kiqbgjgvptgknmboazaq` ("budget-buddy-test"), used only by tests; see
  `docs/testing.md`.
- Vitest (unit/integration) and Playwright (UI).
- Hash routing so the app still works on GitHub Pages.
- Hosting: GitHub Pages at `https://ammonshepherd.github.io/budget-buddy/`,
  deployed by a GitHub Actions workflow that runs `npm run build` on pushes to
  `main` (Pages source = GitHub Actions). Vite `base` is `/budget-buddy/`; the PWA
  manifest scope/start_url must match. Supabase URL and anon key are injected at
  build time from repository Actions variables. Supabase Auth Site URL and
  redirect URL must include the Pages URL.

## Architecture: keep MVC

- `src/models/` — types, pure calculation functions, Supabase data access.
  No React here. All budget math lives in ONE module (`src/models/budgetMath.ts`)
  and is unit-tested; pages never recompute it.
- `src/controllers/` — React hooks that load data, handle user actions, call models.
- `src/views/` — React components. Display only; no money math.

Reuse the existing `styles.css`, icons, manifest and page names
(Budget, Accounts, Activity, Settings) from v0.0.1 where they still fit.

## Money

- Store money as integer cents (`bigint` in Postgres, `number` of cents in TS).
- Signed amounts: inflow positive, outflow negative.
- Account balance = opening balance + sum of non-voided transaction amounts.
  Never store a current balance.

## Envelope math (decided — do not change without asking)

Per envelope, per month M:

```
Remaining(M) = Assigned(M) + Released from Saved(M) − Spent(M)   (never < 0)
Saved(M+1)   = Saved(M) − Released(M) + Remaining(M)              (accumulates every month)
Envelope money = Saved + Remaining
```

- Saved is a reserve. It is only spendable after the user releases it into
  Remaining through a prompt.
- Planned is user input only; it affects no other number.
- A month whose Budget page opens with every Planned at $0.00 (Planned is stored
  per envelope and month; there is no separate plan record) offers to start the
  plan: copy last month's Planned or Spent (as shown), or upload a plan CSV for
  that month. Copying fills only envelopes still at $0.00 and skips card payment
  envelopes (`planToCopy` in `src/models/envelopePlan.ts`). The offer is decided
  when the month opens, so typing a Planned does not make the page jump.

Available to Assign (equivalent to non-card budget balances − all envelope money
− inflows to review + outflows to review, but valid for any month):

```
Available to Assign(M) = opening balances of budget accounts (cards excluded)
                       + income through end of M      (inflows marked Income only)
                       − all Assigned through M
Over Assigned = max(0, −Available to Assign)
```

Transactions to review (decided in v0.11.0 for inflows, v0.14.0 for outflows):
an Uncategorized transaction counts toward nothing until it is decided. An
inflow counts only once it is marked Income (`transactions.is_income`; never in
an envelope, never a transfer, always positive) or given an envelope (a refund,
which only adds to that envelope). An outflow counts only once it is given an
envelope (the envelope pays; Available to Assign does not change) or made a
transfer. So giving a transaction an envelope never moves Available to Assign;
only income, assigning, and covering a shortfall from Available to Assign do.
The Budget page shows this month's income and how many transactions wait for
review (money in and out); Activity lists them ("To review", "Mark as Income").
Income rules (`income_rules`, `src/models/incomeRules.ts`) mark inflows whose
description contains a rule's text (case- and space-insensitive; optionally one
account) as Income: at import (the preview sets `isIncome` per row) and, on
request, over inflows to review. They never change anything else.

Releasing Saved does not change Available to Assign (money stays in the envelope).

### Credit cards (decided in v0.8.0, card credits in v0.14.0)

Each credit card account C has one payment envelope P (`categories.card_account_id`,
created by a database trigger in the "Credit card payments" group). P follows the
envelope formulas above, with the card's settled activity as its Spent:

```
Spent_P(M)   = Σ amounts in M of card purchases in an envelope and card transfers
Owed         = −card balance
Uncovered    = max(0, Owed − (Saved_P + Remaining_P))   (display only, like Planned)
```

- Card purchase in an envelope: money moves from that envelope into P. Transfer out
  of the card (cash advance): into P. A card purchase still to review touches
  neither P nor Available to Assign (it only raises Owed).
- Card inflow marked Transfer (a payment): out of P. If P would go negative, the
  cover prompt runs (release P's Saved, move, assign).
- Any other card inflow is a **card credit** (refund, cashback, statement credit):
  it only lowers Owed. Never in an envelope, never Income, never to review, never
  prompts, and it leaves P alone (money P holds for a refunded purchase then
  covers the rest of the debt). Enforced by the allocation trigger and the stores.
- Available to Assign leaves out card opening balances. Identity:
  `Available to Assign + non-card inflows to review − non-card outflows to review =
non-card budget balances − all envelope money (P included)`.
- Transactions are never categorized to P; P cannot be deleted while its card is open;
  an open card's P always shows on the Budget page; P is named after its card and
  renamed only with it, and stays in its group (database triggers). Card purchases filling P do not
  count in the month's Spent total.
- Only money taken out can need covering: spending in an envelope, or a card
  payment from P. Refunds and card credits never prompt.

## Rules

- No envelope may go negative. When categorizing a transaction would push
  Remaining below 0, prompt to cover the shortfall, in this order:
  1. release from this envelope's Saved,
  2. move from another envelope,
  3. assign more from Available to Assign.
- Assigning is blocked when Available to Assign is insufficient.
- Each month's Budget page shows only envelopes in use that month (a stored
  month record, spending that month, or money in Saved/Remaining; never-used
  envelopes always show). Others sit behind a "show unused" toggle. Money is
  never hidden. Rule lives in `envelopeInUse` in `budgetMath.ts`.
- Imported transactions arrive Uncategorized (to review), except card credits.
- A new bank row matching a transaction typed into the same account (same
  amount, within 10 days, `findImportMatches` in `transactionImport.ts`) is
  matched instead of added: the typed transaction takes the row's import key
  (cleared) and keeps everything entered. The preview lists matches with a
  Match checkbox (unticked = import as new).
- The Budget page is for envelopes (layout decided in v0.16.0, revised in
  v0.24.0, `docs/mockups/budget-screen.html`): no page title or summary
  totals; the month picker sits in a purple band that scrolls away;
  Available to Assign is a sticky card pinned to the top, hidden when it is
  exactly $0.00 (mockups show it only to show its look; green when positive;
  red "Over Assigned" with the positive amount when over);
  groups are full-width bars whose name is a button that collapses the group
  (chevron; open, the bar shows no numbers; collapsed, it shows "N envelopes"
  and the group's total left, `groupLeft` in `budgetMath.ts`) and a + button
  (which also opens a collapsed group). Collapsed groups are remembered per
  device and user in localStorage (`src/models/collapsedGroups.ts`, by group
  id; never in Supabase); envelopes are added
  with each group's + button; groups are added, renamed, reordered and deleted
  in Settings (drag handles; tapping a group opens its sheet, where its
  envelopes are reordered, renamed and moved to another group with "Move
  to…"). Renaming and moving go through `src/controllers/envelopeEdits.ts`.
- Envelope rows run edge to edge. Line 1: the envelope icon (`EnvelopeIcon`,
  decorative), name and a Saved pill ("Saved $X": solid purple with a star,
  six sparkles and a glow once above $0.00, quiet at $0.00), and what is left
  on the right (muted at $0.00; no visible caption, screen readers hear
  "remaining"). Line 2: Planned, Assigned and Spent
  cells (Spent with a minus, "−$45.20"; a "Compact rows" switch under the
  month, phone only, hides line 2 and below, remembered per device and user in
  localStorage, `src/models/layoutPrefs.ts`). Planned and Assigned are edited in place (tap; blur or Enter saves,
  Escape cancels; amounts rounded to the cent by `roundMoney`; never
  negative). Raising Assigned is blocked beyond Available to Assign, and
  lowering it below what is spent is blocked. Spent turns orange (no extra
  word, only "Spent"; screen readers hear "over Planned") when above Planned (`overPlan`, a
  hint only: not overspending).
  Refunded (only when above $0.00) and Short (if overspent) sit on a line
  below. Tapping line 1 opens the envelope sheet (`EnvelopeSheet`, a bottom
  sheet): group (a picker that moves the envelope to another group) and
  name (renamed with its pencil button), Remaining this month with how it adds up, the plan
  line (under/on/over Planned), Planned and Assigned fields (same rules as the
  cells), Spent, the purple Saved panel with "Move some into Remaining…"
  (Release from Saved), this month's transactions in the envelope (tapping
  one opens the transaction edit dialog over the sheet), and Delete
  envelope. Spent shown = max(0, net spent); Refunded =
  refunds beyond the month's spending (`outflow` / `refunded` in
  `EnvelopeMonth`; math unchanged). A card's payment envelope shows Available
  to pay (Saved + Remaining) and Remaining debt (Uncovered), no Saved pill;
  its sheet shows Available to pay, what is owed, an Assign form (negative to
  take back) and the Saved panel, and no Delete.
- Desktop layout (decided in v0.26.0, `docs/proposals/desktop-layout.md`):
  from 1000px wide, signed in, a collapsible left sidebar replaces the header
  and bottom bar, content is capped at 1600px, and lists get a collapsible
  right panel instead of sheets (sidebars remembered per device and user in
  localStorage, `src/models/layoutPrefs.ts`). Budget: one-line envelope rows
  under a band with the month and Available to Assign; the panel shows the
  month summary, the chosen envelope, or a transaction being edited.
  Activity edits in the panel too (the account picker and totals sit at
  the top of its panel, not in the band) and adds through a new row at the
  top of its list; Budget and Accounts add through the dialog. Accounts adds and
  edits accounts in the panel; Settings shows its sections in two columns.
  Below 1000px nothing changes.
- Credit card debt (what the cards owe today, `cardDebt` in
  `src/models/accounts.ts`, display only) shows on every page while above
  $0.00: under the month band on Budget and Activity, at the top of
  Accounts and Settings. Its background is one of 30 reds picked once per
  page load (`src/models/cardDebtShades.ts`), with readable text on each.
- Transactions are added with the floating round + button (bottom right of
  Budget, Accounts and Activity; not Settings), which opens the transaction form
  in a modal `<dialog>` (`TransactionDialog`). Activity (layout decided in
  v0.21.0, `docs/mockups/activity-screen.html`) shows one month, the same month
  as Budget (`#activity/YYYY-MM`; the nav keeps it between the two): a purple
  month band, an Account picker ("All accounts" or one budget account,
  closed ones last; kept between months and pages until reload; it narrows
  the rows, totals and To review list, and a transfer shows when either side
  is in the account), an In / Out / Balance today strip (display only, from
  `src/models/activity.ts`; transfers count in In and Out only when one
  account is chosen; the balance is as of today, whatever the month, with
  the reconciled balance under it, or cash and card debt on All accounts
  with a card), then day headings (newest first, with the day's net; not
  collapsible). Each row: a checkbox, a bank icon (grey = not reconciled,
  green = reconciled), payee over account, envelope, signed amount (outflows
  red, inflows green, always bold; the payee is bold only while to review). Ticked rows are highlighted; a pinned bar shows their
  count and total with Mark reconciled / Mark unreconciled (decided in
  v0.27.0: `transactions.reconciled` is only a mark: no statement balance,
  no lock on edits, no budget math). A transfer shows once, from its money-out side ("From → To",
  signed and coloured by its side in the account picked, or on All accounts
  by the side shown). A split shows a "Split (N)" pill and its parts, open until closed
  (not remembered). Tapping the payee opens the same dialog to edit, with
  Delete (Delete transfer for a transfer) at the bottom. Rows have no
  Edit/Delete links. Transactions to review show "Uncategorized" on an amber
  label; Activity's "To review" list (every month) sits above the transactions.
- Categories are applied through `transaction_allocations` (one row for a normal
  transaction, several for a split). Allocations must sum to the transaction amount,
  each has the transaction's sign (no mixed refund lines) and an envelope appears
  once. Any outflow (card purchases too) or non-card inflow can be split; a split
  that overdraws several envelopes prompts to cover them one at a time, saving
  only after the last.
- Accounts are closed (soft delete), never deleted with their transactions. On
  Accounts, tapping an open account's row opens its edit form in a modal sheet
  with Close account at the bottom; rows have no Edit/Close links.
- An account's opening balance is its balance on the opening date, before any
  of its transactions, so the opening date can be edited only up to the date
  of its first transaction.
- Only open accounts can be edited (closing requires a $0.00 balance).
- Account type (`checking` or `credit_card`) is chosen when adding and cannot
  change. A credit card is a budget account with a normally negative balance
  (owed); the form takes the amount owed as positive and stores it negated
  (`src/models/accounts.ts`). Its payment envelope is described under
  "Credit cards" above; a card payment is a transfer from the paying account.
- Transfers are linked pairs: two transactions sharing `transfer_id`, in different
  accounts, cancelling out (checked at commit). Both are `is_transfer`; there are
  no one-sided transfers. One entry saves both (`save_transfer`), linking the other
  account's matching bank row when there is one (`findTransferMatch` in
  `src/models/transfers.ts`: unlinked, uncategorized, opposite amount, within 7
  days). The form's "Other side" can pick another candidate (within 31 days) or a
  new transaction (`OtherSideChoice`); a stale choice falls back to automatic.
  Deleting or un-transferring one side deletes a typed-in other side and
  keeps an imported one as an Uncategorized row.
- Backup (decided in v0.28.0, `src/models/backup.ts`): Settings exports the
  whole household to one JSON file (every column that matters, including
  reconciled, voided, import keys, source, transfer links, closed accounts,
  CSV mappings and income rules) and restores such a file only into an empty
  household, all or nothing, with fresh ids. When a column or table is added,
  add it to `export_backup`, `restore_backup`, the `Backup` types and
  `validateBackup` (bump the format version if old files need converting).
- A card payment the cover prompt cannot cover is never suggested as Uncategorized
  (that would hide the cash it spent): assign or add income first.

## v1 scope

Checking and credit card accounts; CSV import with preview, invalid-row report and duplicate
prevention (bank ID, else date+amount+description fingerprint); transaction
add/edit/delete; envelope groups and envelopes add/rename/reorder/move/delete;
assign transactions to envelopes, including splits; Budget page as the main screen showing what is
left plus Saved / Planned / Assigned / Refunded / Spent per envelope; month picker
kept in the URL; linked transfers (both sides in one entry) so transfers are not
spending.

Later: matching a transaction typed after its bank row was imported (import
already matches typed transactions, and transfers link to bank rows),
statement reconciliation (v0.27.0 added only the reconciled mark),
tithing/fast-offering rules. See
`docs/SPEC.md` §9 for everything not built yet.

## Supabase state

The PR #4 prototype was replaced in v0.2.0 by the migrations in
`supabase/migrations/` (applied to the dev project; file names match the
project's migration history). Tables: households, household_members, accounts,
category_groups, categories (= envelopes), category_months, transactions,
transaction_allocations, income_rules. Every table has household-scoped RLS; multi-row
writes go through SQL functions (`create_household`, `save_transaction`,
`adjust_category_month`, `move_between_envelopes`,
`import_envelope_plan`, `import_transactions`, `save_transfer`, `mark_income`,
`set_reconciled`, `reorder_category_groups`, `reorder_categories`,
`export_backup`, `restore_backup`). Triggers create, rename and protect
each credit card's payment envelope and reject allocations to it. Imported transactions carry an
`import_key` (unique per account) for duplicate prevention; each account keeps
its CSV column mapping in `import_format`. Budget math stays in
`budgetMath.ts`, not SQL. Inspect the live schema before writing a migration,
keep every schema change as a file in `supabase/migrations/`, and regenerate
`src/models/database.types.ts` afterwards.

Migrations are applied to dev with the Supabase MCP tool; the file is then
named after the version the project assigns (`list_migrations`). Test new SQL
on dev inside a `do $$ … $$` block that ends with `raise exception` so it rolls
back (use `set constraints all immediate` to fire deferred checks), and run the
security and performance advisors after every schema change. Report data
changes a migration makes to existing rows (as counts) in the PR.

Never commit or ask for the service_role key or database password. The app
uses only the project URL and publishable/anon key: `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`, in `.env.local` and as repository Actions variables.
UI tests build with `VITE_DATA_STORE=memory`, an in-memory store
(`src/models/memoryStore.ts`) that must enforce the same rules as the database. Do not
create test users by writing to `auth.users`/`auth.identities` with SQL.

Tests never touch production. The test project's settings live in `.env.test`
(gitignored; `.env.test.example` is committed) and in repository secrets; its
service-role key is used only by `scripts/seed-test-db.ts` and never gets a
`VITE_` prefix. Anything that writes test data calls `assertTestTarget`
(`scripts/testTarget.ts`: test project or local Supabase only). The seed script
(`npm run db:seed:test`) recreates two test users and their households through
the app's tables and SQL functions; the integration tests reseed first and skip
when `.env.test` is incomplete. Apply each new migration to the test project
too, with the same version and name as production (the CLI is linked to test). When querying the owner's real data to answer a
question, read only what the question needs (prefer totals and counts).

## Private data

`private/` (gitignored) holds the owner's real bank exports and other private
files. Never commit its contents or copy them into tests, fixtures, docs or PR
text; tests use made-up rows in the same layout. Files from it that the owner
asks to use (e.g. the icon zip) are inspected first, then copied into place.

## App icons

`public/icons/`: `favicon.svg` (+ `favicon-32.png`, `favicon.ico`) for the tab,
`apple-touch-icon.png` for iOS, `icon-192.png`/`icon-512.png`/`icon.svg`
(purpose "any") and a separate `icon-maskable-512.png` (purpose "maskable") in
the manifest (`vite.config.ts`), and `icon.svg` as the header logo (transparent,
so no frame or shadow). `e2e/navigation.spec.ts` checks every icon loads under
the base path.

## Development process

Before changing code: pull latest, check the version, check open PRs and ask
before modifying code if an unrelated PR is open. Make focused changes on a
branch, bump the version (x = production-ready, y = feature, z = incremental),
run format, lint, unit, UI and (when `.env.test` is set up) integration tests,
and open a PR. In the final message report
the version, changed files, tests run, remaining limitations, and the PR link.

- Display-only or cosmetic changes are a patch version (z); anything that changes
  the decided math needs the owner's approval first and is a feature version (y).
- Check visible UI changes with a Playwright screenshot (a throwaway spec,
  deleted afterwards) at phone width before opening the PR.
- Merge only when asked: wait for the PR's checks, merge with `--delete-branch`,
  pull `main`, then confirm the Pages deploy succeeded and the live bundle shows
  the new version.
- Stacked PRs: before merging the lower PR, keep its branch, retarget the upper
  PR to `main`, and only then delete the lower branch (deleting it first closes
  the upper PR).
