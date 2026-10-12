-- v1 schema for Budget Buddy (see CLAUDE.md).
--
-- Replaces the prototype tables and functions left by the reverted PR #4.
-- They were empty when this migration was written. Budget math is NOT done
-- here: it lives in src/models/budgetMath.ts. The database only stores facts
-- and enforces rules that must hold no matter which client writes.

-- ---------------------------------------------------------------------------
-- 1. Remove the PR #4 prototype
-- ---------------------------------------------------------------------------

drop trigger if exists budget_user_cleanup on auth.users;

drop function if exists public.add_household_member(text);
drop function if exists public.budget_cash(uuid);
drop function if exists public.budget_figures(uuid);
drop function if exists public.budget_reserved(uuid);
drop function if exists public.cleanup_deleted_budget_user();
drop function if exists public.create_household(text, text, text);
drop function if exists public.get_budget_state();
drop function if exists public.prepare_user_deletion(uuid);
drop function if exists public.save_budget_state(integer, jsonb);
drop function if exists public.transfer_household_ownership(text);

drop table if exists
  public.transaction_allocations,
  public.transactions,
  public.category_months,
  public.categories,
  public.category_groups,
  public.accounts,
  public.household_members,
  public.households
  cascade;

drop function if exists public.is_budget_member(uuid);

-- Helpers that policies and triggers need but the API must not expose.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);

-- One household per user for v1.
create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'member')),
  primary key (household_id, user_id)
);

-- Balances are never stored: balance = opening_balance + non-voided transactions.
-- Accounts are closed (closed_at), never deleted.
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  type text not null default 'checking' check (type in ('checking')),
  on_budget boolean not null default true,
  opening_balance bigint not null default 0 check (abs(opening_balance) <= 999999999999),
  opening_date date not null default current_date,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (household_id, id)
);

create table public.category_groups (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (household_id, id)
);

-- Envelopes. A group with envelopes cannot be deleted (restrict).
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  group_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 100),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (household_id, id),
  foreign key (household_id, group_id)
    references public.category_groups (household_id, id) on delete restrict
);

-- Per envelope, per month: Assigned, Released from Saved, and Planned.
-- Assigned may be negative after money is moved out to another envelope.
create table public.category_months (
  household_id uuid not null,
  category_id uuid not null,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  assigned bigint not null default 0 check (abs(assigned) <= 999999999999),
  released bigint not null default 0 check (released between 0 and 999999999999),
  planned bigint not null default 0 check (planned between 0 and 999999999999),
  primary key (category_id, month),
  foreign key (household_id, category_id)
    references public.categories (household_id, id) on delete cascade
);

-- Signed cents: inflow positive, outflow negative.
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  account_id uuid not null,
  date date not null,
  amount bigint not null check (amount <> 0 and abs(amount) <= 999999999999),
  payee text not null default '' check (length(payee) <= 200),
  memo text not null default '' check (length(memo) <= 500),
  is_transfer boolean not null default false,
  voided boolean not null default false,
  source text not null default 'manual' check (source in ('manual', 'csv')),
  created_at timestamptz not null default now(),
  unique (household_id, id),
  foreign key (household_id, account_id)
    references public.accounts (household_id, id) on delete restrict
);

create index transactions_account_date_idx on public.transactions (account_id, date);

-- How a transaction is split across envelopes. None = Uncategorized.
-- An envelope with transactions cannot be deleted (restrict).
create table public.transaction_allocations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  transaction_id uuid not null,
  category_id uuid not null,
  amount bigint not null check (amount <> 0 and abs(amount) <= 999999999999),
  foreign key (household_id, transaction_id)
    references public.transactions (household_id, id) on delete cascade,
  foreign key (household_id, category_id)
    references public.categories (household_id, id) on delete restrict
);

create index transaction_allocations_transaction_idx
  on public.transaction_allocations (transaction_id);
create index transaction_allocations_category_idx
  on public.transaction_allocations (category_id);

-- ---------------------------------------------------------------------------
-- 3. Allocations must sum to the transaction amount; transfers have none.
--    Checked at COMMIT (deferred) so a save can replace allocations freely.
-- ---------------------------------------------------------------------------

create function private.assert_allocations_balance(p_transaction_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_amount bigint;
  v_is_transfer boolean;
  v_count integer;
  v_sum bigint;
begin
  select amount, is_transfer into v_amount, v_is_transfer
  from public.transactions where id = p_transaction_id;
  if not found then
    return; -- the transaction was deleted
  end if;

  select count(*), coalesce(sum(amount), 0) into v_count, v_sum
  from public.transaction_allocations where transaction_id = p_transaction_id;

  if v_count > 0 and v_is_transfer then
    raise exception 'A transfer cannot be assigned to an envelope' using errcode = '23514';
  end if;
  if v_count > 0 and v_sum <> v_amount then
    raise exception 'Allocations (%) must sum to the transaction amount (%)', v_sum, v_amount
      using errcode = '23514';
  end if;
end;
$$;

create function private.on_allocation_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.assert_allocations_balance(old.transaction_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform private.assert_allocations_balance(new.transaction_id);
  end if;
  return null;
end;
$$;

create function private.on_transaction_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.assert_allocations_balance(new.id);
  return null;
end;
$$;

create constraint trigger allocations_balance
  after insert or update or delete on public.transaction_allocations
  deferrable initially deferred
  for each row execute function private.on_allocation_change();

create constraint trigger transaction_allocations_balance
  after update of amount, is_transfer on public.transactions
  deferrable initially deferred
  for each row execute function private.on_transaction_change();

-- ---------------------------------------------------------------------------
-- 4. Row Level Security: members see and change only their household.
-- ---------------------------------------------------------------------------

-- security definer so it can read household_members without tripping that
-- table's own policy (which would recurse).
create function private.is_household_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_household_member(uuid) from public;
grant execute on function private.is_household_member(uuid) to authenticated;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.accounts enable row level security;
alter table public.category_groups enable row level security;
alter table public.categories enable row level security;
alter table public.category_months enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_allocations enable row level security;

create policy member_select on public.households
  for select to authenticated using (private.is_household_member(id));
create policy member_update on public.households
  for update to authenticated
  using (private.is_household_member(id)) with check (private.is_household_member(id));

create policy member_select on public.household_members
  for select to authenticated using (private.is_household_member(household_id));

create policy member_all on public.accounts
  for all to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy member_all on public.category_groups
  for all to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy member_all on public.categories
  for all to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy member_all on public.category_months
  for all to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy member_all on public.transactions
  for all to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy member_all on public.transaction_allocations
  for all to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));

-- Table privileges: signed-out visitors get nothing; accounts cannot be
-- deleted; households and memberships change only through functions.
revoke all on
  public.households, public.household_members, public.accounts, public.category_groups,
  public.categories, public.category_months, public.transactions,
  public.transaction_allocations
  from anon, authenticated;

grant select on public.household_members to authenticated;
grant select, update (name) on public.households to authenticated;
grant select, insert, update on public.accounts to authenticated;
grant select, insert, update, delete on
  public.category_groups, public.categories, public.category_months,
  public.transactions, public.transaction_allocations
  to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Functions the app calls (Supabase exposes them as /rpc/<name>)
-- ---------------------------------------------------------------------------

-- Creates a household owned by the signed-in user.
create function public.create_household(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_household uuid;
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if exists (select 1 from public.household_members where user_id = v_user) then
    raise exception 'You already belong to a household' using errcode = '23505';
  end if;
  insert into public.households (name) values (p_name) returning id into v_household;
  insert into public.household_members (household_id, user_id, role)
    values (v_household, v_user, 'owner');
  return v_household;
end;
$$;

-- Adds to an envelope's Assigned and/or Released for a month, creating the
-- row if needed. Adding (not overwriting) keeps two people's changes intact.
-- Runs as the caller, so Row Level Security still applies.
create function public.adjust_category_month(
  p_category_id uuid,
  p_month text,
  p_assigned_delta bigint default 0,
  p_released_delta bigint default 0
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_household uuid;
begin
  select household_id into v_household from public.categories where id = p_category_id;
  if not found then
    raise exception 'Envelope not found' using errcode = 'P0002';
  end if;
  insert into public.category_months (household_id, category_id, month, assigned, released)
  values (v_household, p_category_id, p_month, p_assigned_delta, p_released_delta)
  on conflict (category_id, month) do update
    set assigned = public.category_months.assigned + excluded.assigned,
        released = public.category_months.released + excluded.released;
end;
$$;

-- Moves Assigned money from one envelope to another within a month, atomically.
create function public.move_between_envelopes(
  p_from_category_id uuid,
  p_to_category_id uuid,
  p_month text,
  p_amount bigint
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_amount <= 0 then
    raise exception 'Amount must be positive' using errcode = '22023';
  end if;
  perform public.adjust_category_month(p_from_category_id, p_month, -p_amount, 0);
  perform public.adjust_category_month(p_to_category_id, p_month, p_amount, 0);
end;
$$;

-- Creates (p_id null) or updates a transaction and its single envelope
-- allocation in one step. p_category_id null = Uncategorized.
create function public.save_transaction(
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
    update public.transactions
      set account_id = p_account_id, date = p_date, amount = p_amount,
          payee = p_payee, memo = p_memo, is_transfer = p_is_transfer
      where id = v_id and household_id = v_household;
    if not found then
      raise exception 'Transaction not found' using errcode = 'P0002';
    end if;
    delete from public.transaction_allocations where transaction_id = v_id;
  end if;

  if p_category_id is not null then
    insert into public.transaction_allocations
      (household_id, transaction_id, category_id, amount)
    values (v_household, v_id, p_category_id, p_amount);
  end if;
  return v_id;
end;
$$;

revoke all on function public.create_household(text) from public, anon;
revoke all on function public.adjust_category_month(uuid, text, bigint, bigint) from public, anon;
revoke all on function public.move_between_envelopes(uuid, uuid, text, bigint) from public, anon;
revoke all on function public.save_transaction(uuid, uuid, date, bigint, text, text, boolean, uuid)
  from public, anon;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.adjust_category_month(uuid, text, bigint, bigint) to authenticated;
grant execute on function public.move_between_envelopes(uuid, uuid, text, bigint) to authenticated;
grant execute on function public.save_transaction(uuid, uuid, date, bigint, text, text, boolean, uuid)
  to authenticated;
