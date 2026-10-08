# Budget Buddy

Version **0.1.0** adds a shared household budget, accounts, transactions and splits, category/group editing, email/password sign-in and CSV imports to the mobile PWA. HTML templates stay in `views/`, DOM behavior in `controllers/`, and calculations/data access in `models/`. There are no production JavaScript dependencies.

Versions use `x.y.z`: production-ready changes, feature additions, and incremental changes respectively. The version is defined in `controllers/appController.js` and shown in every page header.

## Try it locally

Use Node 22 or newer:

```bash
npm run dev
```

Open http://localhost:4173 and choose **Try the demo**. The demo saves sample data on this device and is visibly labeled; it does not connect to a household or create users. Real private financial data is kept in memory only, while the sign-in session persists in local storage. Exit the demo to sign in.

## Connect Supabase

1. Create a Supabase project. Run both files in `supabase/migrations/` in filename order in the SQL editor (or use Supabase CLI migrations). They create eight application tables, RLS policies and validated RPCs. See [the schema and funding rules](docs/data-model.md).
2. In Authentication, enable email/password sign-in, **disable public signup**, and manually create the two users with confirmed email addresses and unique passwords. Set the minimum password length to 12 or more. Configure custom SMTP for password-reset and email-change messages; the default SMTP service only emails project team addresses.
3. In Auth URL Configuration, set Site URL and an allowed Redirect URL to your exact GitHub Pages app URL, for example `https://ammonshepherd.github.io/budget-buddy/`. Add `http://localhost:4173/` for local testing. Keep the default implicit token response for the supplied email-recovery handling. The app removes recovery tokens from the URL immediately and verifies the user with Auth before using them.
4. Set public configuration in `config.js`, or set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` when building. Use a publishable key (`sb_publishable_...`) or the legacy **anon** key. Never use a secret or service-role key in the browser. The build rejects service-role keys.
5. Deploy the optional but necessary-for-deletion Edge Function: `supabase functions deploy delete-account --no-verify-jwt`. The function verifies the JWT itself against Auth. Its server-provided `SUPABASE_SERVICE_ROLE_KEY` is never committed or sent to the browser. The migration’s Auth deletion trigger atomically protects the household and cleans up a sole-owner budget. Transfer ownership in Settings before deleting an owner who has other members.
6. Sign in as the owner, create the household and choose its starting month/currency. Add the partner’s existing Auth email in Settings. The partner signs in and refreshes membership to open the same budget. Do not create two separate households for a shared budget.
7. Add accounts. Enter the balance at the **beginning** of each opening date; card debt is negative. Earlier imported entries remain history and do not get counted again. A transaction’s posted date controls this cutoff when provided; its transaction date controls its budget month. Opening baselines are locked once transactions exist. Later corrections use balance adjustments.

No live database is provisioned by installing this code. Migrations, Auth users, SMTP, public configuration and the Edge Function must be configured in your project.

## Deploy to GitHub Pages

In repository Settings → Pages, choose **GitHub Actions** as the source. In Settings → Secrets and variables → Actions → Variables, add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (both are public configuration, not privileged secrets). The `pages.yml` workflow builds and deploys `dist/` after a merge to `main`. PRs only run checks. No build packages are needed for deployment.

The generated service worker caches an explicit static asset list. Each build hashes every app asset, including logos, to change the cache name; installed apps receive an update notice and can reload after finishing edits. Only Budget Buddy’s own caches are removed. Supabase API/auth responses never enter the app cache. Financial edits require a connection; there is no offline write queue.

## Using the budget

- **Budget:** assign/release money by month, enter Planned amounts, inspect Spent/Remaining/Saved, move Available between categories, explicitly move Saved into Assigned, edit/archive categories and groups. Archived categories remain visible for releasing reservations and restoring them. Reassigning a group retains all amounts/history.
- **Accounts:** create/edit/archive cash, credit and tracking accounts; open the account’s ledger newest first; add/edit/delete transactions and linked transfers. Archived records retain history and can be restored.
- **Activity:** filter by month/account, search category names (including splits), sort, and resolve Needs funding charges. A split purchase has one ledger parent and expandable category details.
- **Settings:** edit your name/email/password, sign out/delete your login, add a household member/transfer ownership, upload a CSV, refresh shared data, and check for an app update.

New purchases are blocked if Available is insufficient. Use **Reallocate funds** in the transaction editor, then save again. Real imported charges remain in the ledger as **Needs funding** and do not spend a category until fully funded. They reduce the actual account balance immediately; if cash can no longer back reservations, Assignable can show a deficit that must be resolved. Categories themselves never go below zero.

CSV imports require an account and explicit column mapping, date format and amount direction. Review invalid rows and potential duplicates, then import. Bank IDs prevent repeated active records. A confirmed match keeps the existing parent, user payee and category splits, adds bank metadata, and retains the imported row as a non-counting merged audit record. CSVs may contain transfers, refunds or card payments: import them as pending ledger entries, then change/refine them as appropriate. To match a bank payment to a transfer, create the transfer first and match the equal account/amount bank row. Matching is never automatic.

## Checks

```bash
npm test
npm run build
# Browser test dependencies only:
npm install --ignore-scripts
npx playwright install chromium
npm run test:e2e
```

`checks.yml` runs unit tests, migration/RLS/funding tests against PostgreSQL 17, SQL-vs-JavaScript calculation comparisons, and mobile/desktop Playwright tests with axe checks for WCAG 2.2 AA rules. Browser reports and screenshots are retained as CI artifacts. Automated accessibility checks do not substitute for physical-device and screen-reader testing.

For database tests locally, use a disposable PostgreSQL database: execute `tests/database/bootstrap.sql`, both migrations, and `tests/database/rules.sql`; generate further checks with `node tests/database/generate.mjs` and run its SQL. The bootstrap emulates Supabase’s Auth schema for tests only; **never run it against your Supabase project**.

This release uses a single small household snapshot with a revision lock and a 10 MB request cap. Refresh before editing after another user has changed the budget; a stale save fails without overwriting their work. Paginated reads and granular write RPCs can replace snapshots if the history grows. Multi-currency, direct bank sync, advanced reconciliation and offline writes are outside this release.
