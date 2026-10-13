-- v0.12.0: income rules. A rule marks matching inflows as Income: an inflow
-- whose description contains the rule's text (ignoring case), optionally only
-- in one account. The app applies rules when importing and on request to
-- inflows waiting for review; matching lives in src/models/incomeRules.ts.

create table public.income_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  pattern text not null check (length(trim(pattern)) between 2 and 100),
  -- null = any account
  account_id uuid,
  created_at timestamptz not null default now(),
  foreign key (household_id, account_id)
    references public.accounts (household_id, id) on delete restrict
);

create index income_rules_account_idx on public.income_rules (household_id, account_id);

alter table public.income_rules enable row level security;

create policy member_all on public.income_rules
  for all to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));

revoke all on public.income_rules from anon, authenticated;
grant select, insert, delete on public.income_rules to authenticated;

-- import_transactions: a row may carry is_income (set by a matching rule).
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
  v_count integer;
begin
  -- Row Level Security limits this to the caller's own accounts.
  select household_id, closed_at into v_household, v_closed
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
         coalesce(r.is_income, false) and r.amount > 0
  from jsonb_to_recordset(p_rows)
    as r(date date, amount bigint, payee text, memo text, import_key text, is_income boolean)
  on conflict (account_id, import_key) where import_key is not null do nothing;
  get diagnostics v_count = row_count;

  update public.accounts set import_format = p_format where id = p_account_id;
  return v_count;
end;
$$;
