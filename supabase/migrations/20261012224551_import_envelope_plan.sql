-- Imports one month's envelope plan (from a CSV) in a single transaction:
-- creates the groups and envelopes it names that do not exist yet, matching
-- names ignoring case and surrounding spaces, and sets each one's Planned for
-- the month. Envelopes not in the plan are left unchanged. The app checks
-- every row first; these checks only guard against bad direct API calls.
-- p_rows: [{"group": text, "envelope": text, "planned": cents}, ...]
create function public.import_envelope_plan(
  p_household_id uuid,
  p_month text,
  p_rows jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row jsonb;
  v_group_name text;
  v_envelope_name text;
  v_planned bigint;
  v_group uuid;
  v_envelope uuid;
begin
  if not private.is_household_member(p_household_id) then
    raise exception 'You are not a member of this household' using errcode = '42501';
  end if;
  if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Month must look like 2026-10' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'A plan must be a list of at most 500 rows' using errcode = '22023';
  end if;

  -- Two imports at once could both create the same new group; take turns.
  perform pg_advisory_xact_lock(hashtextextended(p_household_id::text, 0));

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_group_name := trim(v_row ->> 'group');
    v_envelope_name := trim(v_row ->> 'envelope');
    if v_group_name is null or v_group_name = ''
       or v_envelope_name is null or v_envelope_name = ''
       or jsonb_typeof(v_row -> 'planned') is distinct from 'number' then
      raise exception 'Each row needs a group, a category and a planned amount'
        using errcode = '22023';
    end if;
    v_planned := (v_row ->> 'planned')::bigint;

    select id into v_group
    from public.category_groups
    where household_id = p_household_id and lower(trim(name)) = lower(v_group_name)
    order by position, created_at
    limit 1;
    if not found then
      insert into public.category_groups (household_id, name, position)
      select p_household_id, v_group_name, coalesce(max(position) + 1, 0)
      from public.category_groups
      where household_id = p_household_id
      returning id into v_group;
    end if;

    select id into v_envelope
    from public.categories
    where group_id = v_group and lower(trim(name)) = lower(v_envelope_name)
    order by position, created_at
    limit 1;
    if not found then
      insert into public.categories (household_id, group_id, name, position)
      select p_household_id, v_group, v_envelope_name, coalesce(max(position) + 1, 0)
      from public.categories
      where group_id = v_group
      returning id into v_envelope;
    end if;

    insert into public.category_months (household_id, category_id, month, planned)
    values (p_household_id, v_envelope, p_month, v_planned)
    on conflict (category_id, month) do update set planned = excluded.planned;
  end loop;
end;
$$;

revoke all on function public.import_envelope_plan(uuid, text, jsonb) from public, anon;
grant execute on function public.import_envelope_plan(uuid, text, jsonb) to authenticated;
