-- Tracking accounts (v0.34.0).
--
-- A tracking account is an off-budget account (on_budget = false): it keeps
-- its own transactions, balance and reconciled marks, and nothing else. Its
-- transactions never go in an envelope, are never Income and are never
-- transfers, so they cannot touch Available to Assign or any other account.
-- Only checking-type accounts can be off budget (a card needs its payment
-- envelope). Neither the type nor on_budget changes once the account exists.

alter table public.accounts
  add constraint accounts_off_budget_checking check (on_budget or type = 'checking');

create function private.protect_account_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type is distinct from old.type or new.on_budget is distinct from old.on_budget then
    raise exception 'An account''s type cannot change once it is added' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger accounts_protect_kind
  before update of type, on_budget on public.accounts
  for each row execute function private.protect_account_kind();

-- The allocation check (last defined in split_transactions) also rejects
-- envelopes, Income and transfers in a tracking account.
create or replace function private.assert_allocations_balance(p_transaction_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_amount bigint;
  v_is_transfer boolean;
  v_is_income boolean;
  v_is_card boolean;
  v_on_budget boolean;
  v_count integer;
  v_sum bigint;
  v_wrong_sign integer;
begin
  select t.amount, t.is_transfer, t.is_income, a.type = 'credit_card', a.on_budget
    into v_amount, v_is_transfer, v_is_income, v_is_card, v_on_budget
  from public.transactions t join public.accounts a on a.id = t.account_id
  where t.id = p_transaction_id;
  if not found then
    return; -- the transaction was deleted
  end if;

  select count(*), coalesce(sum(amount), 0), count(*) filter (where sign(amount) <> sign(v_amount))
    into v_count, v_sum, v_wrong_sign
  from public.transaction_allocations where transaction_id = p_transaction_id;

  if not v_on_budget and (v_count > 0 or v_is_income or v_is_transfer) then
    raise exception 'A tracking account stands alone: no envelopes, Income or transfers'
      using errcode = '23514';
  end if;
  if v_is_card and v_is_income then
    raise exception 'A card credit lowers what you owe; it cannot be Income'
      using errcode = '23514';
  end if;
  if v_count > 0 and v_is_transfer then
    raise exception 'A transfer cannot be assigned to an envelope' using errcode = '23514';
  end if;
  if v_count > 0 and v_is_income then
    raise exception 'Income goes to Available to Assign, not to an envelope'
      using errcode = '23514';
  end if;
  if v_count > 0 and v_is_card and v_amount > 0 then
    raise exception 'A card credit lowers what you owe; it cannot go in an envelope'
      using errcode = '23514';
  end if;
  if v_wrong_sign > 0 then
    raise exception 'Every line of a split goes the same way as the transaction'
      using errcode = '23514';
  end if;
  if v_count > 0 and v_sum <> v_amount then
    raise exception 'Allocations (%) must sum to the transaction amount (%)', v_sum, v_amount
      using errcode = '23514';
  end if;
end;
$$;

-- mark_income (last defined in card_credits) leaves tracking accounts alone.
create or replace function public.mark_income(p_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if coalesce(array_length(p_ids, 1), 0) > 2000 then
    raise exception 'Mark at most 2000 transactions at once' using errcode = '22023';
  end if;
  update public.transactions t
    set is_income = true
    from public.accounts a
    where a.id = t.account_id and a.type <> 'credit_card' and a.on_budget
      and t.id = any (p_ids)
      and t.amount > 0 and not t.is_transfer and not t.is_income and not t.voided
      and not exists (select 1 from public.transaction_allocations x where x.transaction_id = t.id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- import_transactions (last defined in import_matching): rows imported into
-- a tracking account are never Income, whatever the income rules said.
create or replace function public.import_transactions(
  p_account_id uuid,
  p_format jsonb,
  p_rows jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_household uuid;
  v_closed timestamptz;
  v_can_be_income boolean;
  v_added integer;
  v_matched integer;
begin
  -- Row Level Security limits this to the caller's own accounts.
  select household_id, closed_at, type <> 'credit_card' and on_budget
    into v_household, v_closed, v_can_be_income
  from public.accounts where id = p_account_id;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
  if v_closed is not null then
    raise exception 'That account is closed' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'An import must be a list of at most 2000 rows' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) r
    where jsonb_typeof(r -> 'amount') is distinct from 'number'
       or coalesce(r ->> 'import_key', '') = ''
       or (r ->> 'date') !~ '^\d{4}-\d{2}-\d{2}$'
       or (r ? 'is_income' and jsonb_typeof(r -> 'is_income') <> 'boolean')
       or (r ? 'match_id' and jsonb_typeof(r -> 'match_id') not in ('string', 'null'))
  ) then
    raise exception 'Each row needs a date, an amount and an import key' using errcode = '22023';
  end if;

  -- Every match must still fit: a typed-in, unvoided transaction of this
  -- account with the row's amount, matched once, whose key is not taken.
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as r(match_id uuid, amount bigint, import_key text)
    where r.match_id is not null
      and (
        not exists (
          select 1 from public.transactions t
          where t.id = r.match_id and t.account_id = p_account_id
            and t.import_key is null and not t.voided and t.amount = r.amount
        )
        or exists (
          select 1 from public.transactions t
          where t.account_id = p_account_id and t.import_key = r.import_key
        )
      )
  ) or (
    select count(r.match_id) <> count(distinct r.match_id)
    from jsonb_to_recordset(p_rows) as r(match_id uuid)
  ) then
    raise exception 'A transaction to match has changed since the preview. Choose the file again.'
      using errcode = '22023';
  end if;

  update public.transactions t
    set import_key = r.import_key, source = 'csv'
    from jsonb_to_recordset(p_rows) as r(match_id uuid, import_key text)
    where t.id = r.match_id;
  get diagnostics v_matched = row_count;

  insert into public.transactions
    (household_id, account_id, date, amount, payee, memo, source, import_key, is_income)
  select v_household, p_account_id, r.date, r.amount,
         coalesce(r.payee, ''), coalesce(r.memo, ''), 'csv', r.import_key,
         coalesce(r.is_income, false) and r.amount > 0 and v_can_be_income
  from jsonb_to_recordset(p_rows)
    as r(date date, amount bigint, payee text, memo text, import_key text, is_income boolean,
         match_id uuid)
  where r.match_id is null
  on conflict (account_id, import_key) where import_key is not null do nothing;
  get diagnostics v_added = row_count;

  update public.accounts set import_format = p_format where id = p_account_id;
  return v_added + v_matched;
end;
$$;
