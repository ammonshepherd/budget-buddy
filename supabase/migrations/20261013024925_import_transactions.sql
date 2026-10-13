-- Transaction CSV import.
--
-- import_key identifies an imported row so the same bank row is never
-- imported twice into an account: "id:<bank transaction id>" when the file
-- has one, else "fp:<date>|<cents>|<description>|<n>" (n counts identical
-- rows in the file). Manual transactions have none.
alter table public.transactions
  add column import_key text check (length(import_key) between 1 and 300);

create unique index transactions_account_import_key_idx
  on public.transactions (account_id, import_key)
  where import_key is not null;

-- The column mapping last used to import a CSV into this account, so the
-- next file from the same bank needs no setup. Shape is owned by the app.
alter table public.accounts
  add column import_format jsonb
    check (import_format is null or (jsonb_typeof(import_format) = 'object'
           and pg_column_size(import_format) <= 8192));

-- Imports rows into one open account in a single transaction and remembers
-- the column mapping. Rows arrive Uncategorized. Rows whose import_key is
-- already in the account are skipped. Returns how many rows were added.
-- p_rows: [{"date": "YYYY-MM-DD", "amount": cents, "payee": text,
--           "memo": text, "import_key": text}, ...]
create function public.import_transactions(
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
  ) then
    raise exception 'Each row needs a date, an amount and an import key' using errcode = '22023';
  end if;

  insert into public.transactions
    (household_id, account_id, date, amount, payee, memo, source, import_key)
  select v_household, p_account_id, r.date, r.amount,
         coalesce(r.payee, ''), coalesce(r.memo, ''), 'csv', r.import_key
  from jsonb_to_recordset(p_rows)
    as r(date date, amount bigint, payee text, memo text, import_key text)
  on conflict (account_id, import_key) where import_key is not null do nothing;
  get diagnostics v_count = row_count;

  update public.accounts set import_format = p_format where id = p_account_id;
  return v_count;
end;
$$;

revoke all on function public.import_transactions(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.import_transactions(uuid, jsonb, jsonb) to authenticated;
