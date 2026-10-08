# Models

`budget.js` contains exact-cent inputs and the envelope/account calculations. `actions.js` contains state changes for funding, purchases and transfers. `csv.js` parses and maps imports while preserving the source data. `auth.js` talks to Supabase Auth and its REST RPC endpoints; `store.js` manages the verified household snapshot or the explicitly selected demo.

The browser previews changes before sending them. PostgreSQL independently validates the normalized financial rows under a household lock. Client users have read-only table access through RLS; financial writes must go through `save_budget_state` with the expected revision.
