-- v0.9.0: linked transfers. Both sides of a transfer share a transfer_id, so
-- one entry records money leaving one account and arriving in another, and
-- the two sides can never disagree (one marked Transfer, the other not).
-- No transfers existed before this migration, so every transfer is a pair.

alter table public.transactions add column transfer_id uuid;

alter table public.transactions
  add constraint transactions_transfer_linked check (is_transfer = (transfer_id is not null));

create unique index transactions_transfer_account_idx
  on public.transactions (transfer_id, account_id) where transfer_id is not null;

-- A transfer is exactly two rows, in different accounts, that cancel out.
-- Checked at COMMIT so save_transfer can change both rows in any order.
create function private.assert_transfer_pair(p_transfer_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
  v_accounts integer;
  v_sum bigint;
begin
  if p_transfer_id is null then
    return;
  end if;
  select count(*), count(distinct account_id), coalesce(sum(amount), 0)
    into v_count, v_accounts, v_sum
    from public.transactions where transfer_id = p_transfer_id;
  if v_count = 0 then
    return; -- the whole transfer was deleted
  end if;
  if v_count <> 2 or v_accounts <> 2 or v_sum <> 0 then
    raise exception 'A transfer needs two sides in different accounts that cancel out'
      using errcode = '23514';
  end if;
end;
$$;

create function private.on_transfer_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.assert_transfer_pair(old.transfer_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform private.assert_transfer_pair(new.transfer_id);
  end if;
  return null;
end;
$$;

create constraint trigger transactions_transfer_pair
  after insert or update or delete on public.transactions
  deferrable initially deferred
  for each row execute function private.on_transfer_change();

-- Unlinks a transaction from its transfer. The other side goes too if it was
-- typed in (manual); an imported other side stays, as an Uncategorized bank row.
create function private.release_transfer(p_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_transfer uuid;
  v_others uuid[];
begin
  select transfer_id into v_transfer from public.transactions where id = p_id;
  if v_transfer is null then
    return;
  end if;
  v_others := array(
    select id from public.transactions where transfer_id = v_transfer and id <> p_id
  );
  update public.transactions set transfer_id = null, is_transfer = false
    where transfer_id = v_transfer;
  delete from public.transactions where id = any (v_others) and source = 'manual';
end;
$$;

-- Deleting one side of a transfer releases the other side (see above).
create function private.on_transfer_side_deleted()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_others uuid[];
begin
  if old.transfer_id is null then
    return old;
  end if;
  v_others := array(
    select id from public.transactions where transfer_id = old.transfer_id and id <> old.id
  );
  update public.transactions set transfer_id = null, is_transfer = false
    where id = any (v_others);
  delete from public.transactions where id = any (v_others) and source = 'manual';
  return old;
end;
$$;

create trigger transactions_release_transfer
  after delete on public.transactions
  for each row execute function private.on_transfer_side_deleted();

-- Saves both sides of a transfer at once. p_legs is a list of exactly two
-- {id?, account_id, date, amount, payee, memo}: an id updates that row (an
-- existing transaction, e.g. an imported bank row being linked), no id adds a
-- new one. p_transfer_id is set when editing an existing transfer; sides it
-- had that are not in p_legs are released.
create function public.save_transfer(p_transfer_id uuid, p_legs jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_transfer uuid := coalesce(p_transfer_id, gen_random_uuid());
  v_household uuid;
  v_leg_household uuid;
  v_leg jsonb;
  v_id uuid;
  v_ids uuid[];
  v_old uuid;
begin
  if jsonb_typeof(p_legs) is distinct from 'array' or jsonb_array_length(p_legs) <> 2 then
    raise exception 'A transfer has exactly two sides' using errcode = '22023';
  end if;

  for v_leg in select value from jsonb_array_elements(p_legs) loop
    if jsonb_typeof(v_leg) is distinct from 'object'
       or v_leg->>'account_id' is null or v_leg->>'date' is null or v_leg->>'amount' is null then
      raise exception 'Each side needs an account, a date and an amount' using errcode = '22023';
    end if;
    select household_id into v_leg_household
      from public.accounts
      where id = (v_leg->>'account_id')::uuid and closed_at is null;
    if not found then
      raise exception 'Account not found or closed' using errcode = 'P0002';
    end if;
    if v_household is null then
      v_household := v_leg_household;
    elsif v_household <> v_leg_household then
      raise exception 'Both accounts must be in the same household' using errcode = '22023';
    end if;
  end loop;

  if p_transfer_id is not null and exists (
    select 1 from public.transactions
    where transfer_id = p_transfer_id and household_id <> v_household
  ) then
    raise exception 'Transfer not found' using errcode = 'P0002';
  end if;

  v_ids := array(
    select (value->>'id')::uuid from jsonb_array_elements(p_legs) where value->>'id' is not null
  );
  if exists (
    select 1 from public.transactions
    where id = any (v_ids) and transfer_id is not null and transfer_id <> v_transfer
  ) then
    raise exception 'That transaction is already part of another transfer'
      using errcode = '22023';
  end if;

  -- Sides this transfer had that it no longer has.
  for v_old in
    select id from public.transactions
    where transfer_id = v_transfer and not (id = any (v_ids))
  loop
    update public.transactions set transfer_id = null, is_transfer = false where id = v_old;
    delete from public.transactions where id = v_old and source = 'manual';
  end loop;

  for v_leg in select value from jsonb_array_elements(p_legs) loop
    v_id := (v_leg->>'id')::uuid;
    if v_id is null then
      insert into public.transactions
        (household_id, account_id, date, amount, payee, memo, is_transfer, transfer_id)
      values (
        v_household, (v_leg->>'account_id')::uuid, (v_leg->>'date')::date,
        (v_leg->>'amount')::bigint, coalesce(v_leg->>'payee', ''),
        coalesce(v_leg->>'memo', ''), true, v_transfer
      );
    else
      delete from public.transaction_allocations where transaction_id = v_id;
      update public.transactions
        set account_id = (v_leg->>'account_id')::uuid,
            date = (v_leg->>'date')::date,
            amount = (v_leg->>'amount')::bigint,
            payee = coalesce(v_leg->>'payee', ''),
            memo = coalesce(v_leg->>'memo', ''),
            is_transfer = true,
            transfer_id = v_transfer
        where id = v_id and household_id = v_household;
      if not found then
        raise exception 'Transaction not found' using errcode = 'P0002';
      end if;
    end if;
  end loop;
  return v_transfer;
end;
$$;

revoke all on function public.save_transfer(uuid, jsonb) from public, anon;
grant execute on function public.save_transfer(uuid, jsonb) to authenticated;

-- save_transaction now saves only non-transfers; changing a transfer side
-- into an ordinary transaction releases its other side first.
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
  if p_is_transfer then
    raise exception 'Transfers are saved with both sides at once (save_transfer)'
      using errcode = '22023';
  end if;
  select household_id into v_household from public.accounts where id = p_account_id;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;

  if v_id is null then
    insert into public.transactions
      (household_id, account_id, date, amount, payee, memo, is_transfer)
    values (v_household, p_account_id, p_date, p_amount, p_payee, p_memo, false)
    returning id into v_id;
  else
    perform private.release_transfer(v_id);
    -- Remove the old allocations first so the balance check never sees the
    -- new amount next to the old split.
    delete from public.transaction_allocations where transaction_id = v_id;
    update public.transactions
      set account_id = p_account_id, date = p_date, amount = p_amount,
          payee = p_payee, memo = p_memo, is_transfer = false
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
