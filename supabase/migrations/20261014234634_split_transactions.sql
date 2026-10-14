-- v0.15.0: split transactions. save_transaction takes the envelope lines
-- (p_allocations, a list of {category_id, amount}); a split has several.
-- Every line goes the same way as the transaction (all outflow or all
-- inflow) and an envelope appears at most once.
--
-- p_category_id stays for now so the app already deployed keeps saving until
-- this version is live; a later migration can drop it.

-- An envelope appears at most once per transaction.
alter table public.transaction_allocations
  add constraint transaction_allocations_envelope_once unique (transaction_id, category_id);

-- Allocations must sum to the amount, each with its sign; transfers, income
-- and card credits have none.
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
  v_wrong_sign integer;
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

  select count(*), coalesce(sum(amount), 0), count(*) filter (where sign(amount) <> sign(v_amount))
    into v_count, v_sum, v_wrong_sign
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

drop function public.save_transaction(uuid, uuid, date, bigint, text, text, boolean, uuid, boolean);

create function public.save_transaction(
  p_id uuid,
  p_account_id uuid,
  p_date date,
  p_amount bigint,
  p_payee text,
  p_memo text,
  p_is_transfer boolean,
  p_category_id uuid default null,
  p_is_income boolean default false,
  p_allocations jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_household uuid;
  v_id uuid := p_id;
  v_lines jsonb;
begin
  if p_is_transfer then
    raise exception 'Transfers are saved with both sides at once (save_transfer)'
      using errcode = '22023';
  end if;
  if p_category_id is not null and p_allocations is not null then
    raise exception 'Give one envelope or split lines, not both' using errcode = '22023';
  end if;
  -- One envelope is a one-line split; neither is Uncategorized.
  v_lines := coalesce(
    p_allocations,
    case when p_category_id is null then '[]'::jsonb
         else jsonb_build_array(jsonb_build_object('category_id', p_category_id, 'amount', p_amount))
    end);
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

revoke all on function public.save_transaction(uuid, uuid, date, bigint, text, text, boolean, uuid, boolean, jsonb)
  from public, anon;
grant execute on function public.save_transaction(uuid, uuid, date, bigint, text, text, boolean, uuid, boolean, jsonb)
  to authenticated;
