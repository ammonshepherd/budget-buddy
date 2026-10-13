-- v0.14.0: card credits. On a credit card, an inflow that is not a payment
-- (a refund, cashback, a statement credit) only lowers what is owed: it is
-- never in an envelope and never Income. (Uncategorized outflows waiting for
-- review are an app-side rule in budgetMath.ts; nothing to store.)

-- Existing card inflows lose their envelope or Income mark.
delete from public.transaction_allocations x
  using public.transactions t, public.accounts a
  where x.transaction_id = t.id and a.id = t.account_id
    and a.type = 'credit_card' and t.amount > 0;
update public.transactions t
  set is_income = false
  from public.accounts a
  where a.id = t.account_id and a.type = 'credit_card' and t.is_income;

-- Allocations must sum to the amount; transfers, income and card credits have none.
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
  v_count integer;
  v_sum bigint;
begin
  select t.amount, t.is_transfer, t.is_income, a.type = 'credit_card'
    into v_amount, v_is_transfer, v_is_income, v_is_card
  from public.transactions t join public.accounts a on a.id = t.account_id
  where t.id = p_transaction_id;
  if not found then
    return; -- the transaction was deleted
  end if;

  if v_is_card and v_is_income then
    raise exception 'A card credit lowers what you owe; it cannot be Income'
      using errcode = '23514';
  end if;

  select count(*), coalesce(sum(amount), 0) into v_count, v_sum
  from public.transaction_allocations where transaction_id = p_transaction_id;

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
  if v_count > 0 and v_sum <> v_amount then
    raise exception 'Allocations (%) must sum to the transaction amount (%)', v_sum, v_amount
      using errcode = '23514';
  end if;
end;
$$;

-- The balance check also runs when a transaction moves to another account.
drop trigger transaction_allocations_balance on public.transactions;
create constraint trigger transaction_allocations_balance
  after update of amount, is_transfer, is_income, account_id on public.transactions
  deferrable initially deferred
  for each row execute function private.on_transaction_change();

-- Income can be marked on new rows too (no allocation trigger fires for them).
create function private.on_transaction_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.assert_allocations_balance(new.id);
  return null;
end;
$$;

create constraint trigger transaction_insert_balance
  after insert on public.transactions
  deferrable initially deferred
  for each row execute function private.on_transaction_insert();

-- mark_income leaves card credits alone.
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
    where a.id = t.account_id and a.type <> 'credit_card'
      and t.id = any (p_ids)
      and t.amount > 0 and not t.is_transfer and not t.is_income and not t.voided
      and not exists (select 1 from public.transaction_allocations x where x.transaction_id = t.id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Imports: an income rule's mark applies only outside credit cards.
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
  v_count integer;
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
  ) then
    raise exception 'Each row needs a date, an amount and an import key' using errcode = '22023';
  end if;

  insert into public.transactions
    (household_id, account_id, date, amount, payee, memo, source, import_key, is_income)
  select v_household, p_account_id, r.date, r.amount,
         coalesce(r.payee, ''), coalesce(r.memo, ''), 'csv', r.import_key,
         coalesce(r.is_income, false) and r.amount > 0 and not v_is_card
  from jsonb_to_recordset(p_rows)
    as r(date date, amount bigint, payee text, memo text, import_key text, is_income boolean)
  on conflict (account_id, import_key) where import_key is not null do nothing;
  get diagnostics v_count = row_count;

  update public.accounts set import_format = p_format where id = p_account_id;
  return v_count;
end;
$$;
