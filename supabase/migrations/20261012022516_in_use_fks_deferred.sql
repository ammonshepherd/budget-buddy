-- NO ACTION alone was not enough: during a household delete, Postgres can
-- check an envelope's references before the cascade has removed that
-- envelope's allocations. Deferring these checks to COMMIT lets the whole
-- cascade finish first. Deleting something still in use is still refused,
-- just at commit time.

alter table public.categories
  alter constraint categories_household_id_group_id_fkey deferrable initially deferred;

alter table public.transactions
  alter constraint transactions_household_id_account_id_fkey deferrable initially deferred;

alter table public.transaction_allocations
  alter constraint transaction_allocations_household_id_category_id_fkey
    deferrable initially deferred;
