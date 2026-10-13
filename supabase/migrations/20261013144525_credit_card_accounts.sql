-- v0.7.0: credit card accounts. A card is a budget account whose balance is
-- normally negative (money owed); no other schema change is needed.
alter table public.accounts
  drop constraint accounts_type_check,
  add constraint accounts_type_check check (type in ('checking', 'credit_card'));
