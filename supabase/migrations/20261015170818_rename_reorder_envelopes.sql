-- v0.18.0: rename and reorder envelope groups and envelopes.
-- A name is changed with a plain update (Row Level Security keeps it to the
-- household). A new order is saved for a whole list at once: the list must
-- name every group of the household (or every envelope of the group) once,
-- so an out-of-date screen cannot leave two items in the same place.

create function public.reorder_category_groups(p_household_id uuid, p_group_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_total integer;
  v_listed integer;
begin
  select count(*), count(*) filter (where id = any (p_group_ids))
    into v_total, v_listed
    from public.category_groups where household_id = p_household_id;
  if coalesce(cardinality(p_group_ids), 0) <> v_total or v_listed <> v_total then
    raise exception 'The groups have changed; reload and try again' using errcode = '22023';
  end if;
  update public.category_groups g
    set position = x.ord - 1
    from unnest(p_group_ids) with ordinality as x(id, ord)
    where g.id = x.id and g.household_id = p_household_id and g.position <> x.ord - 1;
end;
$$;

create function public.reorder_categories(p_group_id uuid, p_category_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_total integer;
  v_listed integer;
begin
  select count(*), count(*) filter (where id = any (p_category_ids))
    into v_total, v_listed
    from public.categories where group_id = p_group_id;
  if coalesce(cardinality(p_category_ids), 0) <> v_total or v_listed <> v_total then
    raise exception 'The envelopes have changed; reload and try again' using errcode = '22023';
  end if;
  update public.categories c
    set position = x.ord - 1
    from unnest(p_category_ids) with ordinality as x(id, ord)
    where c.id = x.id and c.group_id = p_group_id and c.position <> x.ord - 1;
end;
$$;

revoke all on function public.reorder_category_groups(uuid, uuid[]) from public, anon;
revoke all on function public.reorder_categories(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_category_groups(uuid, uuid[]) to authenticated;
grant execute on function public.reorder_categories(uuid, uuid[]) to authenticated;

-- A card's payment envelope is named after the card: rename the card instead.
-- (The rename that follows a card's new name runs inside a trigger, depth 2.)
create function private.protect_card_payment_envelope_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.card_account_id is not null and new.name is distinct from old.name
     and pg_trigger_depth() = 1 then
    raise exception 'A card''s payment envelope is named after its card; rename the card instead'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger categories_card_payment_name
  before update of name on public.categories
  for each row execute function private.protect_card_payment_envelope_name();

-- A new card's payment envelope joins the group that already holds the other
-- cards' payment envelopes, so renaming "Credit card payments" keeps them together.
create or replace function public.create_card_payment_envelope()
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
  select group_id into v_group_id
    from public.categories
    where household_id = new.household_id and card_account_id is not null
    order by position
    limit 1;
  if v_group_id is null then
    select id into v_group_id
      from public.category_groups
      where household_id = new.household_id and lower(name) = 'credit card payments'
      order by position
      limit 1;
  end if;
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
