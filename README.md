# Enough Money

Enough Money (called Budget Buddy until v0.37.0) is a mobile-first, installable envelope-budgeting web app for a small household, at
<https://enoughmoney.app>.

The full description of how it works is in [`docs/SPEC.md`](docs/SPEC.md); the decided
budgeting rules are in [`CLAUDE.md`](CLAUDE.md).

## Version

The current application version is **0.37.0** (kept in `package.json`; the app shows it in
the header, and `docs/SPEC.md` describes that version).

Versions follow:

- **x**: production-ready changes
- **y**: feature additions
- **z**: incremental changes to a feature

## Stack

- [Vite](https://vite.dev) dev server and bundler, with `vite-plugin-pwa` for the service worker and manifest
- [React](https://react.dev) + TypeScript
- [Vitest](https://vitest.dev) unit tests and [Playwright](https://playwright.dev) UI tests
- Hash routing (`#budget`, `#accounts`, …), so a static host serves every page from one file
- Supabase: email sign-in, Postgres with Row Level Security (`supabase/migrations/`)

## Folder structure (MVC)

```text
src/models/        Types, pure functions (budgetMath.ts holds all budget math) and data stores; no React
src/controllers/   React hooks that load data and handle user actions
src/views/         React components; display only
public/icons/      App icons
e2e/               Playwright UI tests (run against the in-memory store)
integration/       Tests of the Supabase store and its security rules against the test project
supabase/          Database migrations
```

## Commands

```bash
npm install          # once, after cloning
npm run dev          # start the dev server with instant reload
npm run build        # type-check and build to dist/
npm run preview      # serve the built app locally
npm run format       # format with Prettier
npm run lint         # check with ESLint
npm test             # unit tests (Vitest)
npm run test:ui      # UI tests (Playwright; first run `npx playwright install chromium`)
npm run test:integration  # Supabase store vs. the test project (needs .env.test, below)
npm run test:ui:db   # UI tests against the test project
npm run db:seed:test # recreate the test users and their households
```

## Local setup

1. Copy `.env.example` to `.env.local` and fill in the publishable key
   (Supabase dashboard → Project Settings → API Keys).
2. In Supabase → Authentication → URL Configuration, add
   `http://localhost:5173/` as a redirect URL (and as the Site URL
   while developing) so email confirmation links come back to the app.
3. `npm run dev`, open <http://localhost:5173/>, create an account,
   confirm the email, sign in and name your household.

### Data stores

Controllers talk to a `DataStore` interface (`src/models/dataStore.ts`).
`supabaseStore.ts` is the real one. `memoryStore.ts` keeps data in memory and
is used only by the Playwright build (`VITE_DATA_STORE=memory`), so UI tests
never touch real data. A normal build does not include it.

### Integration tests

Tests never touch production. `npm run test:integration` reseeds a separate
Supabase test project and exercises every Supabase call and the security rules.
It is skipped until `.env.test` is filled in (copy `.env.test.example`). See
[`docs/testing.md`](docs/testing.md) for the two projects and every command.

## Deployment

The app is hosted on Cloudflare at <https://enoughmoney.app> (domain, DNS and hosting
all in Cloudflare). `.github/workflows/deploy.yml` checks, tests and builds every pull
request, and on each push to `main` runs `wrangler deploy`, which uploads `dist/` as a
Worker that only serves files (`wrangler.jsonc`). The build writes `dist/_headers`, which
Cloudflare sends as security headers.

One-time setup:

- **Cloudflare → Manage account → Account API tokens → Create token:** the "Edit
  Cloudflare Workers" template, limited to your account and the `enoughmoney.app` zone.
- **GitHub → Settings → Secrets and variables → Actions:** the secret
  `CLOUDFLARE_API_TOKEN` (that token), and the variables `CLOUDFLARE_ACCOUNT_ID` (on the
  Cloudflare dashboard's account home), `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
  (public values). For local development copy `.env.example` to `.env.local`.
- **Cloudflare DNS:** no record for the bare `enoughmoney.app` (the first deploy adds it
  as the Worker's custom domain). Optionally a Redirect Rule from `www.enoughmoney.app`.
- **Cloudflare → enoughmoney.app:** leave off anything that injects scripts into pages
  (Web Analytics auto-inject, Rocket Loader, Email Address Obfuscation); the Content
  Security Policy would block it.
- **Supabase → Authentication → URL Configuration:** `https://enoughmoney.app` as the
  Site URL and as a redirect URL.

## The Budget page

The Budget page is built to show as many envelopes as possible. **Available to Assign**
stays fixed at the top while the envelopes scroll under it; tap it to assign some to an
envelope. It disappears when there is nothing left to assign ($0.00) and turns red as
**Over Assigned** when you have assigned more than you have. The month picker sits
just above it. Each group has a **+** button to add an envelope; groups are added,
renamed, reordered and deleted in **Settings → Envelope groups**. Tap an envelope's
name to open it (release from Saved, rename, move, delete), tap Planned or Assigned to
change them (on a phone Assigned opens a number pad that also takes "+50"), and tap
what is left to move money to another envelope.

Each envelope shows what is left and, in this order, **Saved**, **Planned**,
**Assigned**, **Refunded** (when there is one) and **Spent**, with the amounts in bold;
tap it to assign, release or plan. Refunds first cancel out the
month's spending (so Spent is never negative); a refund larger than that shows as
**Refunded**. Assigned + Released + Refunded − Spent = what is left. Once there is
money in Saved it turns larger, purple and sparkly, to encourage leaving money unspent.
A credit card's payment envelope shows only **Available to pay** and the **Remaining debt**
after that.

## Income and Available to Assign

Mark paychecks and other income as **Income (to Available to Assign)** in the Envelope
choice. Only income marked this way goes into Available to Assign; you then assign it
to envelopes.

A transaction left **Uncategorized** (an imported purchase, deposit or refund) is
**to review**: it counts toward nothing until you decide what it is. Giving it an
envelope takes the money from (or, for a refund, adds it to) that envelope and never
changes Available to Assign. If the envelope is short, the cover prompt can take the
rest from Available to Assign, which then goes down by exactly that much. The Budget
page shows how many transactions wait, and Accounts lists them under **To review**
(All accounts, or each account for its own) with **Mark as Income** for inflows.

```
Available to Assign = opening balances + income − assigned
```

**Income rules** (Settings) mark paychecks for you: a deposit whose description contains
a rule's text (ignoring case), optionally only in one account, is marked Income when you
import it. The import preview says how many rows a rule marked. A new rule can also mark
the inflows already waiting for review, and To review has **Apply income rules**. Rules
never touch outflows, transfers or transactions already in an envelope.

## Adding and editing transactions

The round **+** button in the bottom-right corner of Budget and Accounts opens the
transaction form in a dialog, so you can record spending without leaving the page
(on a desktop, an open account adds through a new row at the top of its list).
Envelopes are chosen by typing part of the name. On Accounts, transactions are grouped
under date headings, Uncategorized ones carry an amber label, and tapping a payee opens
the transaction in the same dialog to edit or delete it. Tick rows to see their total
and mark them reconciled with the bank.

## Finding transactions

Open an account on Accounts and use the search box above its transactions:

- **Type** a payee, a word from the memo, or an amount (`45` finds $45.00–$45.99,
  `45.2` finds $45.20–$45.29, `$45.20` finds exactly that).
- **Pick from the drop-down** to keep only some transactions: an envelope, or
  Uncategorized, Income, Transfer, Card credit or **Not reconciled**. Each choice
  becomes a chip; one envelope (or kind) and Not reconciled can be used together, so
  "Uncategorized + Not reconciled" is a clean-up list. Picking an envelope counts only
  its part of a split.
- **Sort** by date (newest or oldest), amount, payee or envelope.

The matches and their total show under the box. Search starts over when you open
another account.

## Credit cards

Accounts → **Add an account** → **Credit card**, then enter the amount owed on the
opening date (as a positive number). The card's balance is negative while money is
owed.

Each card gets a **payment envelope** ("Visa payment", in the **Credit card payments**
group) that holds the cash set aside to pay it:

- A card purchase in an envelope moves that money into the payment envelope; one left
  Uncategorized waits for review and only adds to what is owed.
- A card payment is a **Transfer** from checking to the card (see Transfers below). It
  takes money out of the payment envelope; if the envelope holds too little, the cover
  prompt asks where the rest comes from (assign more first to pay extra toward the debt).
- What the card owed when you added it does **not** lower Available to Assign. It shows
  on the payment envelope as **Uncovered**; assign money there to pay it down.
- Money coming into a card that is not a payment (a refund, cashback, a statement
  credit) is a **card credit**: it just lowers what you owe. It is never in an
  envelope, never Income and never waits for review.

Transactions cannot be categorized to a payment envelope, and it cannot be deleted
while the card is open.

## Transfers

Choose **Transfer** as the envelope, then the account the money goes **to** (outflow) or
comes **from** (inflow). One entry saves both sides, linked: editing one updates the
other, and deleting one deletes the other. Neither side is spending or income.

If the other account already has the matching bank row (imported, Uncategorized, the
opposite amount, within 7 days), the transfer links to it instead of adding a copy;
the form says which row it will use. When there is more than one candidate, **Other
side** lets you pick a different bank row (up to 31 days away, closest first) or add a
new transaction instead. Editing a transfer can also swap a side you typed in for the
bank's row once it is imported. Deleting a transfer keeps an imported side as an
Uncategorized bank row.

## Transaction import

Settings → **Import transactions** (or **Import CSV** on an open account): choose an
account and a CSV downloaded from the bank or card website. Banks format these differently, so the app:

1. **Detects** the columns from the header names (Date / Posted Date, Description / Payee,
   Amount or separate Debit and Credit columns, Transaction ID) and the date style
   (month-first, day-first, year-first). Lines above the header and files without a
   header are handled.
2. **Lets you correct** any column, the date style, or flip signs for cards that list
   purchases as positive (a hint appears when most amounts are positive).
3. **Remembers** the columns per account, so the next file from that bank needs no setup.

The preview lists invalid rows by line, rows dated before the account's opening date
(already part of its opening balance) and duplicates. Duplicates are recognised by the
bank's transaction ID, or by date + amount + description when the file has none.
Imported transactions arrive Uncategorized.

## Envelope plan import

Settings → **Import envelope plan** takes a CSV for one month with the columns
`category, group, planned amount` (header optional; with a header, columns may be in
any order). It previews the rows, lists invalid ones with their line numbers, then in
one step creates missing groups and envelopes (names match ignoring case) and sets
Planned for that month. Envelopes not in the file are left alone.

```csv
category,group,planned amount
Rent,Bills,1200.00
Groceries,Everyday,450
```

## Envelopes per month

Each month's Budget page shows only the envelopes that month uses: ones with a plan,
assignment or imported row for the month, spending that month, or money still in them
(Saved or Remaining). Brand-new envelopes show until first used. The rest are behind
"Show N envelopes not used this month", where they can still be assigned to.

## Planned next steps

Everything decided but not built yet is listed in [`docs/SPEC.md`](docs/SPEC.md) §9.
The main ones:

1. Bulk actions on ticked transactions (delete, mark as Income, assign an envelope);
   see [`docs/proposals/bulk-actions.md`](docs/proposals/bulk-actions.md).
2. Statement reconciliation (a statement balance to match), beyond the reconciled mark.
3. Search and sort on All accounts.
4. Tithing/fast-offering rules.
5. Inviting a second household member.
