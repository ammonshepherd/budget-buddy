-- v0.15.1: save_transaction takes envelopes only as lines (p_allocations).
-- The single-envelope p_category_id kept by v0.15.0 for the app deployed
-- before it is no longer used, so it is dropped. One envelope is a one-line
-- split; no lines is Uncategorized.

drop function public.save_transaction(uuid, uuid, date, bigint, text, text, boolean, uuid, boolean, jsonb);

create function public.save_transaction(
  p_id uuid,
  p_account_id uuid,
  p_date date,
  p_amount bigint,
  p_payee text,
  p_memo text,
  p_is_transfer boolean,
  p_is_income boolean default false,
  p_allocations jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_household uuid;
  v_id uuid := p_id;
  v_lines jsonb := coalesce(p_allocations, '[]'::jsonb);
begin
  if p_is_transfer then
    raise exception 'Transfers are saved with both sides at once (save_transfer)'
      using errcode = '22023';
  end if;
  if jsonb_typeof(v_lines) <> 'array' then
    raise exception 'Split lines must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(v_lines) > 50 then
    raise exception 'Split into at most 50 envelopes' using errcode = '22023';
  end if;
  if (select count(distinct x.category_id) <> count(*)
      from jsonb_to_recordset(v_lines) as x(category_id uuid)) then
    raise exception 'Each envelope can appear only once in a split' using errcode = '22023';
  end if;
  if p_is_income and (p_amount <= 0 or jsonb_array_length(v_lines) > 0) then
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

  insert into public.transaction_allocations (household_id, transaction_id, category_id, amount)
  select v_household, v_id, x.category_id, x.amount
  from jsonb_to_recordset(v_lines) as x(category_id uuid, amount bigint);
  return v_id;
end;
$$;

revoke all on function public.save_transaction(uuid, uuid, date, bigint, text, text, boolean, boolean, jsonb)
  from public, anon;
grant execute on function public.save_transaction(uuid, uuid, date, bigint, text, text, boolean, boolean, jsonb)
  to authenticated;
