# Budget Buddy

Budget Buddy is a mobile-first, installable envelope-budgeting web app for a small household.

## Version

The current application version is **0.14.1** (kept in `package.json`).

Versions follow:

- **x**: production-ready changes
- **y**: feature additions
- **z**: incremental changes to a feature

## Stack

- [Vite](https://vite.dev) dev server and bundler, with `vite-plugin-pwa` for the service worker and manifest
- [React](https://react.dev) + TypeScript
- [Vitest](https://vitest.dev) unit tests and [Playwright](https://playwright.dev) UI tests
- Hash routing (`#budget`, `#accounts`, …) so the app works on GitHub Pages
- Supabase: email sign-in, Postgres with Row Level Security (`supabase/migrations/`)

## Folder structure (MVC)

```text
src/models/        Types, pure functions (budgetMath.ts holds all budget math) and data stores; no React
src/controllers/   React hooks that load data and handle user actions
src/views/         React components; display only
public/icons/      App icons
e2e/               Playwright UI tests (run against the in-memory store)
integration/       Opt-in tests of the Supabase store against the dev project
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
npm run test:integration  # Supabase store vs. the dev project (needs a test account, below)
```

## Local setup

1. Copy `.env.example` to `.env.local` and fill in the publishable key
   (Supabase dashboard → Project Settings → API Keys).
2. In Supabase → Authentication → URL Configuration, add
   `http://localhost:5173/budget-buddy/` as a redirect URL (and as the Site URL
   while developing) so email confirmation links come back to the app.
3. `npm run dev`, open <http://localhost:5173/budget-buddy/>, create an account,
   confirm the email, sign in and name your household.

### Data stores

Controllers talk to a `DataStore` interface (`src/models/dataStore.ts`).
`supabaseStore.ts` is the real one. `memoryStore.ts` keeps data in memory and
is used only by the Playwright build (`VITE_DATA_STORE=memory`), so UI tests
never touch real data. A normal build does not include it.

### Integration test

`npm run test:integration` signs in as a dedicated test account and exercises
every Supabase call. It is skipped unless you set `SUPABASE_TEST_EMAIL` and
`SUPABASE_TEST_PASSWORD`. Use a separate account: each run leaves one closed
account in that household, because accounts are never deleted.

## Deployment

The app is hosted on GitHub Pages at <https://ammonshepherd.github.io/budget-buddy/>.
`.github/workflows/deploy.yml` checks, tests and builds every pull request, and deploys
to Pages on each push to `main`. Vite `base` and the PWA manifest use `/budget-buddy/`,
so the dev server runs at <http://localhost:5173/budget-buddy/>.

One-time setup:

- **Settings → Pages → Source:** GitHub Actions.
- **Settings → Secrets and variables → Actions → Variables:** `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` (public values). For local development copy `.env.example` to
  `.env.local`.
- **Supabase → Authentication → URL Configuration:** add the Pages URL as the Site URL
  and as a redirect URL.

## The Budget page

The Budget page is built to show as many envelopes as possible. **Available to Assign**
(with this month's income) stays fixed at the top while the envelopes scroll under it.
It disappears when there is nothing left to assign ($0.00) and comes back as a warning
when you are over assigned. The month picker sits just above it. Each group has a **+** button to add an
envelope; groups themselves are added and deleted (when empty) in **Settings →
Envelope groups**. Tap an envelope to assign, release from Saved or set its plan.

Each envelope shows Plan, Assigned, Spent and **Saved**. Spent is only money that went
out: a refund into the envelope just raises what is left. Once there is money in
Saved it turns larger, purple and sparkly, to encourage leaving money unspent. A credit
card's payment envelope shows only **Available to pay** and the **Remaining debt**
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
page shows how many transactions wait, and Activity lists them under **To review**
with **Mark as Income** for inflows.

```
Available to Assign = opening balances + income − assigned
```

**Income rules** (Settings) mark paychecks for you: a deposit whose description contains
a rule's text (ignoring case), optionally only in one account, is marked Income when you
import it. The import preview says how many rows a rule marked. A new rule can also mark
the inflows already waiting for review, and Activity has **Apply income rules**. Rules
never touch outflows, transfers or transactions already in an envelope.

## Adding and editing transactions

The round **+** button in the bottom-right corner of Budget, Accounts and Activity opens
the transaction form in a dialog, so you can record spending without leaving the page.
On Activity, transactions are grouped under date headings (tap a date to fold it away),
Uncategorized ones are highlighted, and tapping a transaction opens it in the same
dialog to edit or delete it.

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

Settings → **Import transactions**: choose an account and a CSV downloaded from the bank
or card website. Banks format these differently, so the app:

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

1. Rename and reorder envelopes and groups; "copy last month's spending into Planned".
2. Inviting a second household member.
