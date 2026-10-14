# Budget Buddy — guide for Claude

Envelope-budgeting Progressive Web App for a small household. The owner is
learning Vite, React and TypeScript: explain new concepts briefly in PR
descriptions and when asked, without being condescending.

## Stack (decided)

- Vite + React + TypeScript, `vite-plugin-pwa` for installability.
- Supabase (Postgres + email auth + Row Level Security). Dev project ref:
  `lkaurrcarzzkbqdwqfge` ("budget-buddy").
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
- "Copy last month's spending into Planned" is supported.

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
  an open card's P always shows on the Budget page. Card purchases filling P do not
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
- The Budget page is for envelopes: no page title or summary totals; Available
  to Assign is a sticky bar at the top, hidden when it is exactly $0.00 (shown
  when positive or over assigned); the month picker sits above it; envelopes
  are added with each group's + button; groups are added/deleted in Settings.
- Envelope rows show name, what is left, then in this order: Saved (large,
  purple, sparkling once above $0.00), Planned, Assigned, Refunded (only when
  above $0.00), Spent, and Short if overspent; amounts are bold. Released from
  Saved shows only when the row is opened (and used). Spent shown = max(0, net spent);
  Refunded = refunds beyond the month's spending (`outflow` / `refunded` in
  `EnvelopeMonth`; math unchanged). A card's payment envelope shows only
  Available to pay (Saved + Remaining) and Remaining debt (Uncovered).
- Transactions are added with the floating round + button (bottom right of
  Budget, Accounts and Activity; not Settings), which opens the transaction form
  in a modal `<dialog>` (`TransactionDialog`). On Activity, transactions sit under
  collapsible date headings (newest first); tapping a row opens the same dialog
  to edit, with Delete (Delete transfer for a transfer) at the bottom. Rows have
  no Edit/Delete links. Transactions to review show "Uncategorized" on an amber
  label; Activity's "To review" list sits above the transactions.
- Categories are applied through `transaction_allocations` (one row for a normal
  transaction, several for a split). Allocations must sum to the transaction amount.
- Accounts are closed (soft delete), never deleted with their transactions.
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
- A card payment the cover prompt cannot cover is never suggested as Uncategorized
  (that would hide the cash it spent): assign or add income first.

## v1 scope

Checking and credit card accounts; CSV import with preview, invalid-row report and duplicate
prevention (bank ID, else date+amount+description fingerprint); transaction
add/edit/delete; envelope groups and envelopes add/edit/delete/reorder;
assign transactions to envelopes; Budget page as the main screen showing what is
left plus Saved / Planned / Assigned / Refunded / Spent per envelope; month picker
kept in the URL; linked transfers (both sides in one entry) so transfers are not
spending.

Later: split UI,
manual/imported matching, reconciliation, tithing/fast-offering rules.

## Supabase state

The PR #4 prototype was replaced in v0.2.0 by the migrations in
`supabase/migrations/` (applied to the dev project; file names match the
project's migration history). Tables: households, household_members, accounts,
category_groups, categories (= envelopes), category_months, transactions,
transaction_allocations, income_rules. Every table has household-scoped RLS; multi-row
writes go through SQL functions (`create_household`, `save_transaction`,
`adjust_category_month`, `move_between_envelopes`,
`import_envelope_plan`, `import_transactions`, `save_transfer`, `mark_income`). Triggers create, rename and protect
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
uses only the project URL and publishable/anon key, in `.env.local`. Do not
create test users by writing to `auth.users`/`auth.identities` with SQL; the
integration tests (`integration/`) stay opt-in through `SUPABASE_TEST_EMAIL` and
`SUPABASE_TEST_PASSWORD`. When querying the owner's real data to answer a
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
run format, lint, unit and UI tests, and open a PR. In the final message report
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
