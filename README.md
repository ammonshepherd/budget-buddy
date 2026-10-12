# Budget Buddy

Budget Buddy is a mobile-first, installable envelope-budgeting web app for a small household.

## Version

The current application version is **0.1.0** (kept in `package.json`).

Versions follow:

- **x**: production-ready changes
- **y**: feature additions
- **z**: incremental changes to a feature

## Stack

- [Vite](https://vite.dev) dev server and bundler, with `vite-plugin-pwa` for the service worker and manifest
- [React](https://react.dev) + TypeScript
- [Vitest](https://vitest.dev) unit tests and [Playwright](https://playwright.dev) UI tests
- Hash routing (`#budget`, `#accounts`, …) so the app works on GitHub Pages
- Supabase (not connected yet)

## Folder structure (MVC)

```text
src/models/        Types and pure functions (budgetMath.ts holds all budget math); no React
src/controllers/   React hooks that load data and handle user actions
src/views/         React components; display only
public/icons/      App icons
e2e/               Playwright UI tests
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
```

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

1. Supabase schema migrations, auth and Row Level Security.
2. Accounts, transactions and CSV import.
3. Envelope groups and envelopes on the Budget page, with a month picker in the URL.
