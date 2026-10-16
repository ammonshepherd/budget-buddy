-- Matching typed transactions to imported ones (v0.23.0).
--
-- An import row may carry match_id: a transaction typed into the same
-- account (no import key, not voided) with the same amount. Instead of adding
-- the bank row, that transaction takes its import_key and counts as imported
-- (source 'csv', so a released transfer side is kept, not deleted). It keeps
-- everything the user entered: date, payee, memo, envelopes, Income, transfer.
-- A match that no longer fits fails the whole import.
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
  v_is_card boolean;
  v_added integer;
  v_matched integer;
begin
  -- Row Level Security limits this to the caller's own accounts.
  select household_id, closed_at, type = 'credit_card' into v_household, v_closed, v_is_card
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
         coalesce(r.is_income, false) and r.amount > 0 and not v_is_card
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
