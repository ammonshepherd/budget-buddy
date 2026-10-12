-- save_transaction: delete old allocations before changing the amount, so the
-- allocation balance check passes even when constraints are checked immediately.

-- Creates (p_id null) or updates a transaction and its single envelope
-- allocation in one step. p_category_id null = Uncategorized.
create or replace function public.save_transaction(
  p_id uuid,
  p_account_id uuid,
  p_date date,
  p_amount bigint,
  p_payee text,
  p_memo text,
  p_is_transfer boolean,
  p_category_id uuid
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
  select household_id into v_household from public.accounts where id = p_account_id;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;

  if v_id is null then
    insert into public.transactions
      (household_id, account_id, date, amount, payee, memo, is_transfer)
    values (v_household, p_account_id, p_date, p_amount, p_payee, p_memo, p_is_transfer)
    returning id into v_id;
  else
    -- Remove the old allocations first so the balance check never sees the
    -- new amount next to the old split.
    delete from public.transaction_allocations where transaction_id = v_id;
    update public.transactions
      set account_id = p_account_id, date = p_date, amount = p_amount,
          payee = p_payee, memo = p_memo, is_transfer = p_is_transfer
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
