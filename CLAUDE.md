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

Available to Assign (equivalent to budget account balances − all envelope money,
but valid for any month):

```
Available to Assign(M) = opening balances of budget accounts
                       + income through end of M
                       − all Assigned through M
                       − uncategorized outflows through M
Over Assigned = max(0, −Available to Assign)
```

Releasing Saved does not change Available to Assign (money stays in the envelope).

## Rules

- No envelope may go negative. When categorizing a transaction would push
  Remaining below 0, prompt to cover the shortfall, in this order:
  1. release from this envelope's Saved,
  2. move from another envelope,
  3. assign more from Available to Assign.
- Assigning is blocked when Available to Assign is insufficient.
- Imported transactions arrive Uncategorized.
- Categories are applied through `transaction_allocations` (one row for a normal
  transaction, several for a split). Allocations must sum to the transaction amount.
- Accounts are closed (soft delete), never deleted with their transactions.

## v1 scope

Checking accounts; CSV import with preview, invalid-row report and duplicate
prevention (bank ID, else date+amount+description fingerprint); transaction
add/edit/delete; envelope groups and envelopes add/edit/delete/reorder;
assign transactions to envelopes; Budget page as the main screen showing
Plan / Assign / Spent / Remaining / Saved per envelope; month picker kept in the URL;
a "Transfer" marking so transfers are not spending.

Later: credit cards (with a card-payment envelope per card), split UI,
manual/imported matching, reconciliation, tithing/fast-offering rules.

## Supabase state

The dev project already has these empty tables (from the reverted PR #4):
households, household_members, accounts, category_groups, categories,
category_months, transactions, transaction_allocations. Inspect them before
writing migrations; adapt or replace them to match this file. Keep all schema
changes as files in `supabase/migrations/`.

Never commit or ask for the service_role key or database password. The app
uses only the project URL and publishable/anon key, in `.env.local`.

## Development process

Before changing code: pull latest, check the version, check open PRs and ask
before modifying code if an unrelated PR is open. Make focused changes on a
branch, bump the version (x = production-ready, y = feature, z = incremental),
run format, lint, unit and UI tests, and open a PR. In the final message report
the version, changed files, tests run, remaining limitations, and the PR link.
