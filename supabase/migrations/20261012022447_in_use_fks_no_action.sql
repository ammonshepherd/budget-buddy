-- "In use" foreign keys: RESTRICT is checked immediately, which also blocked
-- deleting a whole household (its cascades remove the referencing rows a
-- moment later). NO ACTION is checked at the end of the statement: deleting
-- an envelope, group or account that is in use still fails, but a household
-- delete cascades cleanly.

alter table public.categories
  drop constraint categories_household_id_group_id_fkey,
  add constraint categories_household_id_group_id_fkey
    foreign key (household_id, group_id)
    references public.category_groups (household_id, id) on delete no action;

alter table public.transactions
  drop constraint transactions_household_id_account_id_fkey,
  add constraint transactions_household_id_account_id_fkey
    foreign key (household_id, account_id)
    references public.accounts (household_id, id) on delete no action;

alter table public.transaction_allocations
  drop constraint transaction_allocations_household_id_category_id_fkey,
  add constraint transaction_allocations_household_id_category_id_fkey
    foreign key (household_id, category_id)
    references public.categories (household_id, id) on delete no action;
