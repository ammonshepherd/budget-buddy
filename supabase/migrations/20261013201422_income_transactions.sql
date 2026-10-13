-- v0.11.0: income is marked explicitly. An inflow counts toward Available to
-- Assign only once it is marked Income; an Uncategorized inflow waits as an
-- "inflow to review". Income is never in an envelope and is never a transfer.

alter table public.transactions add column is_income boolean not null default false;

alter table public.transactions
  add constraint transactions_income_inflow
    check (not is_income or (amount > 0 and not is_transfer));

-- Allocations must sum to the amount; transfers and income have none.
create or replace function private.assert_allocations_balance(p_transaction_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_amount bigint;
  v_is_transfer boolean;
  v_is_income boolean;
  v_count integer;
  v_sum bigint;
begin
  select amount, is_transfer, is_income into v_amount, v_is_transfer, v_is_income
  from public.transactions where id = p_transaction_id;
  if not found then
    return; -- the transaction was deleted
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
  if v_count > 0 and v_sum <> v_amount then
    raise exception 'Allocations (%) must sum to the transaction amount (%)', v_sum, v_amount
      using errcode = '23514';
  end if;
end;
$$;

drop trigger transaction_allocations_balance on public.transactions;
create constraint trigger transaction_allocations_balance
  after update of amount, is_transfer, is_income on public.transactions
  deferrable initially deferred
  for each row execute function private.on_transaction_change();

-- save_transaction gains p_is_income (default false, so older callers still work).
drop function public.save_transaction(uuid, uuid, date, bigint, text, text, boolean, uuid);

create function public.save_transaction(
  p_id uuid,
  p_account_id uuid,
  p_date date,
  p_amount bigint,
  p_payee text,
  p_memo text,
  p_is_transfer boolean,
  p_category_id uuid,
  p_is_income boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_household uuid;
  v_id uuid := p_id;
begin
  if p_is_transfer then
    raise exception 'Transfers are saved with both sides at once (save_transfer)'
      using errcode = '22023';
  end if;
  if p_is_income and (p_amount <= 0 or p_category_id is not null) then
    raise exception 'Income is money coming in, without an envelope' using errcode = '22023';
  end if;
  select household_id into v_household from public.accounts where id = p_account_id;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;

  if v_id is null then
    insert into public.transactions
      (household_id, account_id, date, amount, payee, memo, is_transfer, is_income)
    values (v_household, p_account_id, p_date, p_amount, p_payee, p_memo, false, p_is_income)
    returning id into v_id;
  else
    perform private.release_transfer(v_id);
    -- Remove the old allocations first so the balance check never sees the
    -- new amount next to the old split.
    delete from public.transaction_allocations where transaction_id = v_id;
    update public.transactions
      set account_id = p_account_id, date = p_date, amount = p_amount,
          payee = p_payee, memo = p_memo, is_transfer = false, is_income = p_is_income
      where id = v_id and household_id = v_household;
    if not found then
      raise exception 'Transaction not found' using errcode = 'P0002';
    end if;
  end if;

  if p_category_id is not null then
    insert into public.transaction_allocations
      (household_id, transaction_id, category_id, amount)
    values (v_household, v_id, p_category_id, p_amount);
  end if;
  return v_id;
end;
$$;

revoke all on function public.save_transaction(uuid, uuid, date, bigint, text, text, boolean, uuid, boolean)
  from public, anon;
grant execute on function public.save_transaction(uuid, uuid, date, bigint, text, text, boolean, uuid, boolean)
  to authenticated;

-- Marks several Uncategorized inflows as Income at once (the review list's
-- "Mark as Income"). Rows that are not plain Uncategorized inflows are left
-- alone. Returns how many were marked.
create function public.mark_income(p_ids uuid[])
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
    where t.id = any (p_ids)
      and t.amount > 0 and not t.is_transfer and not t.is_income and not t.voided
      and not exists (select 1 from public.transaction_allocations a where a.transaction_id = t.id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_income(uuid[]) from public, anon;
grant execute on function public.mark_income(uuid[]) to authenticated;
