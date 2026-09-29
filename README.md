# Budget Buddy

Budget Buddy is a progressive web app foundation for an envelope-style budgeting application.

## Current foundation

- Installable web app manifest
- Service worker with a small offline application shell cache
- Responsive starter interface
- No backend credentials committed

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
