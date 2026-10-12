-- Index every household-scoped foreign key (Supabase performance advisor),
-- replacing the single-column indexes from v1_schema.

drop index if exists public.transactions_account_date_idx;
drop index if exists public.transaction_allocations_transaction_idx;
drop index if exists public.transaction_allocations_category_idx;

create index categories_group_idx on public.categories (household_id, group_id);
create index category_months_category_idx on public.category_months (household_id, category_id);
create index transactions_account_date_idx on public.transactions (household_id, account_id, date);
create index transaction_allocations_transaction_idx
  on public.transaction_allocations (household_id, transaction_id);
create index transaction_allocations_category_idx
  on public.transaction_allocations (household_id, category_id);
