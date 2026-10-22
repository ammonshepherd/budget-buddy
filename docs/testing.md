# Testing and the test database

Budget Buddy has two Supabase projects. Automated tests only ever touch the
test project. Every script that writes test data checks its target first
(`scripts/testTarget.ts`) and refuses anything but the test project or a
local Supabase.

|               | Production                             | Test                                     |
| ------------- | -------------------------------------- | ---------------------------------------- |
| Name          | `budget-buddy`                         | `budget-buddy-test`                      |
| Project ref   | `lkaurrcarzzkbqdwqfge`                 | `kiqbgjgvptgknmboazaq`                   |
| Used by       | the app on GitHub Pages, `npm run dev` | integration tests, `test:ui:db`, seeding |
| Settings file | `.env.local` / Actions **variables**   | `.env.test` / Actions **secrets**        |
| Supabase CLI  | never linked                           | linked (`supabase/.temp`, not committed) |

## Which command uses what

| Command                    | Data                         | Needs                                 |
| -------------------------- | ---------------------------- | ------------------------------------- |
| `npm run dev`, `build`     | production (`.env.local`)    |                                       |
| `npm test` / `test:unit`   | none (pure functions)        | nothing                               |
| `npm run test:ui`          | in-memory store              | nothing                               |
| `npm run db:seed:test`     | test project (writes)        | `.env.test` with the service-role key |
| `npm run test:integration` | test project (reseeds first) | `.env.test`                           |
| `npm run test:ui:db`       | test project, as user A      | `.env.test`, seeded data              |

If `.env.test` is missing or incomplete, the integration and `test:ui:db`
tests are skipped with a message saying what is missing. Unit tests never
need a database.

## Setting up `.env.test`

1. `cp .env.test.example .env.test` (it is gitignored).
2. Paste the test project's **secret / service-role key** into
   `SUPABASE_SERVICE_ROLE_KEY` (Supabase dashboard → `budget-buddy-test` →
   Project Settings → API Keys).
3. Run `npm run db:seed:test`. The first run generates strong passwords for
   the two test users and writes them into `.env.test`.

`.env.test` is read by the scripts and tests (`scripts/testEnv.ts`) and by
Vite in `test` mode (`vite --mode test`, `vite build --mode test`). Only
variables starting with `VITE_` ever reach the browser, so the service-role
key must **never** get a `VITE_` prefix: it bypasses Row Level Security.
`vite.config.ts` refuses to build if a `VITE_` variable looks like a secret,
or if a production build points at the test project.

## Seeding and resetting

`npm run db:seed:test` (`scripts/seed-test-db.ts`) resets the test database:

- deletes the households of the two test users (everything in them goes too)
  and any leftover household with the same name;
- creates or updates the users with `auth.admin.createUser` / `updateUserById`
  and `email_confirm: true` (no confirmation email, so no SMTP);
- signs in as each user with the publishable key and writes the data through
  the same tables and SQL functions the app uses (`create_household`,
  `adjust_category_month`, `save_transaction`, `save_transfer`, …), so the
  same triggers and policies apply.

| User                      | Household        | Data                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test-a@budgetbuddy.test` | Test Household A | Test Checking ($2,500.00 opening) and Test Visa ($300.00 owed); Bills (Rent, Utilities) and Everyday (Groceries, Dining Out, Fun Money) with Planned and Assigned last month and this month; salary income and a "salary" income rule; categorized spending; an Uncategorized charge; a split; a card payment (transfer); a card credit |
| `test-b@budgetbuddy.test` | Test Household B | B Checking, one envelope (B Groceries), income and one expense: used to prove A cannot see or change it                                                                                                                                                                                                                                 |

Run it again any time; the integration tests run it before every run.

## Running the tests

```sh
npm run format:check && npm run lint   # style
npm test                                # unit tests (no database)
npm run test:ui                         # UI tests, in-memory store
npm run test:integration                # reseeds, then integration + RLS tests
npm run test:ui:db                      # UI test signed in as user A
```

- `integration/rls.test.ts` signs in as each user and checks they can read
  their own accounts, transactions and envelopes, get no rows from the other
  household, and cannot add, change or delete its rows.
- `integration/supabaseStore.test.ts` runs the app's real data store as user A.
- `integration/storeRules.test.ts` runs the shared rule tests
  (`src/models/storeRules.shared.ts`) against the database as user A; the
  unit tests run the same ones against the in-memory store, so the two
  stay alike.
- `e2e-db/` holds UI tests against the test database
  (`playwright.db.config.ts`); the everyday UI tests in `e2e/` use the
  in-memory store.

## GitHub Actions

`deploy.yml` (format, lint, unit tests, build; deploys `main` to Pages) uses
the production **variables** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
`tests.yml` runs the UI tests and, on pull requests, the test-database tests
with these repository **secrets** (Settings → Secrets and variables →
Actions → Secrets):

| Secret                           | Value                                      |
| -------------------------------- | ------------------------------------------ |
| `TEST_SUPABASE_URL`              | `https://kiqbgjgvptgknmboazaq.supabase.co` |
| `TEST_SUPABASE_ANON_KEY`         | the test project's publishable key         |
| `TEST_SUPABASE_SERVICE_ROLE_KEY` | the test project's service-role key        |
| `TEST_USER_A_PASSWORD`           | `TEST_USER_A_PASSWORD` from `.env.test`    |
| `TEST_USER_B_PASSWORD`           | `TEST_USER_B_PASSWORD` from `.env.test`    |

Without them the test-database job skips its tests.

## Changing the database: test first, then production

1. Write the migration as a new file in `supabase/migrations/`.
2. Apply it to the **test** project. The CLI is linked to test, so
   `npx supabase db push` goes there (check with
   `npx supabase projects list`: the linked project is marked). Or apply it
   with the Supabase MCP tool using project `kiqbgjgvptgknmboazaq`.
3. Run `npm run test:integration` and `npm run test:ui:db`.
4. Apply the same file to **production** (`lkaurrcarzzkbqdwqfge`) with the
   Supabase MCP tool, as CLAUDE.md describes, and name the file after the
   version production assigns. Keep the test project's history in step
   (same version and name).
5. Regenerate `src/models/database.types.ts`.

Never run `db push`, `db reset` or the seed script against production.

## Optional: a local Supabase (Docker)

The hosted test project is the default; Docker is not required. With Docker
running:

```sh
npx supabase start          # starts Postgres, Auth and the API locally
npx supabase db reset       # applies supabase/migrations/ to the local database
npx supabase status         # shows the local API URL and keys
```

Put the local API URL (`http://127.0.0.1:54321`), the local publishable/anon
key and the local service-role key into `.env.test`, then
`npm run db:seed:test` and the tests run against the local database. The
safety check allows `127.0.0.1` and `localhost`. `npx supabase stop` shuts it
down. `db reset` is only ever for the local database.
