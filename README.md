# Budget Buddy

Budget Buddy is a framework-free, mobile-first progressive web app foundation for an envelope-style budgeting application.

## Version

The current application version is **0.0.1**.

Versions follow:

- **x**: production-ready changes
- **y**: feature additions
- **z**: incremental changes to a feature

## Current foundation

- Installable web app manifest
- Service worker with an application-shell cache
- Mobile-first phone-app layout
- Bottom navigation for Budget, Accounts, Activity, and Settings
- Hash-based SPA navigation compatible with GitHub Pages
- HTML views separated from controller JavaScript
- No backend credentials or database connections committed

## Folder structure

```text
views/          HTML page fragments
controllers/    Routing and page behavior
models/         Reserved for Supabase and data-access code
```

## Run locally

Because service workers require a secure context, use a local web server instead of opening `index.html` directly:

```bash
npx serve .
```

Then open the local URL shown by the command.

## Planned next steps

1. Add Supabase project configuration using environment-specific build settings.
2. Add authentication and Row Level Security policies.
3. Add budget, category, account, and transaction data models.
4. Expand offline behavior only after defining a safe synchronization strategy.
