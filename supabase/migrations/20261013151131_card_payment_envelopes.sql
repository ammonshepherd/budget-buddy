-- v0.8.0: one card-payment envelope per credit card account.
-- The envelope holds the cash set aside to pay the card. The app's budget math
-- (budgetMath.ts) fills it from card spending and empties it with payments;
-- the database only keeps the link and protects it.

alter table public.categories add column card_account_id uuid;

alter table public.categories
  add constraint categories_card_account_fkey
    foreign key (household_id, card_account_id)
    references public.accounts (household_id, id) on delete restrict;

-- One payment envelope per card (NULLs, i.e. ordinary envelopes, are distinct).
create unique index categories_card_account_idx
  on public.categories (household_id, card_account_id);

-- Creates the card's payment envelope in the "Credit card payments" group.
create function public.create_card_payment_envelope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_group_id uuid;
begin
  if new.type <> 'credit_card' then
    return new;
  end if;
  select id into v_group_id
    from public.category_groups
    where household_id = new.household_id and lower(name) = 'credit card payments'
    order by position
    limit 1;
  if v_group_id is null then
    insert into public.category_groups (household_id, name, position)
      select new.household_id, 'Credit card payments', coalesce(max(position) + 1, 0)
      from public.category_groups where household_id = new.household_id
      returning id into v_group_id;
  end if;
  insert into public.categories (household_id, group_id, name, position, card_account_id)
    select new.household_id, v_group_id, left(new.name || ' payment', 100),
           coalesce(max(position) + 1, 0), new.id
    from public.categories where household_id = new.household_id and group_id = v_group_id;
  return new;
end;
$$;

create trigger accounts_card_payment_envelope
  after insert on public.accounts
  for each row execute function public.create_card_payment_envelope();

-- Renaming a card renames its payment envelope.
create function public.rename_card_payment_envelope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.categories
    set name = left(new.name || ' payment', 100)
    where household_id = new.household_id and card_account_id = new.id;
  return new;
end;
$$;

create trigger accounts_rename_card_payment_envelope
  after update of name on public.accounts
  for each row when (new.type = 'credit_card' and new.name is distinct from old.name)
  execute function public.rename_card_payment_envelope();

-- A payment envelope cannot be deleted while its card is open. (Deletes that
-- cascade from removing a whole household are let through.)
create function public.protect_card_payment_envelope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.card_account_id is not null and pg_trigger_depth() = 1 and exists (
    select 1 from public.accounts where id = old.card_account_id and closed_at is null
  ) then
    raise exception 'A card''s payment envelope cannot be deleted while the card is open'
      using errcode = '22023';
  end if;
  return old;
end;
$$;

create trigger categories_protect_card_payment
  before delete on public.categories
  for each row execute function public.protect_card_payment_envelope();

-- Transactions cannot be categorized to a payment envelope: card activity fills it.
create function public.reject_payment_envelope_allocation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.categories
    where id = new.category_id and card_account_id is not null
  ) then
    raise exception 'A card''s payment envelope fills itself; choose another envelope'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger transaction_allocations_no_payment_envelope
  before insert or update of category_id on public.transaction_allocations
  for each row execute function public.reject_payment_envelope_allocation();

revoke execute on function public.create_card_payment_envelope() from public, anon, authenticated;
revoke execute on function public.rename_card_payment_envelope() from public, anon, authenticated;
revoke execute on function public.protect_card_payment_envelope() from public, anon, authenticated;
revoke execute on function public.reject_payment_envelope_allocation() from public, anon, authenticated;

-- Cards added before this migration get their payment envelope now.
do $$
declare
  v_account public.accounts;
  v_group_id uuid;
begin
  for v_account in
    select a.* from public.accounts a
    where a.type = 'credit_card'
      and not exists (select 1 from public.categories c where c.card_account_id = a.id)
  loop
    select id into v_group_id from public.category_groups
      where household_id = v_account.household_id and lower(name) = 'credit card payments'
      order by position limit 1;
    if v_group_id is null then
      insert into public.category_groups (household_id, name, position)
        select v_account.household_id, 'Credit card payments', coalesce(max(position) + 1, 0)
        from public.category_groups where household_id = v_account.household_id
        returning id into v_group_id;
    end if;
    insert into public.categories (household_id, group_id, name, position, card_account_id)
      select v_account.household_id, v_group_id, left(v_account.name || ' payment', 100),
             coalesce(max(position) + 1, 0), v_account.id
      from public.categories
      where household_id = v_account.household_id and group_id = v_group_id;
  end loop;
end;
$$;
