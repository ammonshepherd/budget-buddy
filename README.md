# Budget Buddy

Budget Buddy is a mobile-first, installable envelope-budgeting web app for a small household.

## Version

The current application version is **0.2.0** (kept in `package.json`).

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

## Planned next steps

1. CSV import with preview, invalid-row report and duplicate prevention.
2. Rename and reorder envelopes and groups; "copy last month's spending into Planned".
3. Inviting a second household member.
