-- v0.28.0: full backup and restore of a household's budget.
--
-- export_backup reads every table in one statement, so the file is a
-- consistent snapshot even while someone else is editing. restore_backup
-- loads such a file into an EMPTY household in one all-or-nothing step.
-- Both run as the caller, so Row Level Security still applies, and the app
-- gives every row a fresh id before restoring (src/models/backup.ts), so a
-- backup can be restored next to the household it came from.
--
-- What a plain table dump would miss, and how restore handles it:
-- * Adding a card account fires a trigger that creates its payment envelope
--   (one per card, unique). Cards are inserted closed for a moment so those
--   generated envelopes (and any group the trigger made) can be removed and
--   the exported envelopes, with their ids, groups and positions, inserted.
--   Every account gets its exported closed_at back at the end.
-- * import_key (unique per account) and source are kept, so the next bank
--   CSV import still skips rows already imported, and deleting a transfer
--   side still keeps an imported other side.
-- * Transfer pairs, split sums and signs, card credits and Income are
--   checked by the existing deferred triggers; they fire before returning.

create function public.export_backup(p_household_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not private.is_household_member(p_household_id) then
    raise exception 'You are not a member of this household' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'format', 'budget-buddy-backup',
    'version', 1,
    'exported_at', now(),
    'household', (select jsonb_build_object('name', h.name)
                    from public.households h where h.id = p_household_id),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'type', a.type,
        'opening_balance', a.opening_balance, 'opening_date', a.opening_date,
        'on_budget', a.on_budget, 'closed_at', a.closed_at,
        'import_format', a.import_format, 'created_at', a.created_at
      ) order by a.created_at, a.id)
      from public.accounts a where a.household_id = p_household_id), '[]'::jsonb),
    'category_groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'name', g.name, 'position', g.position, 'created_at', g.created_at
      ) order by g.position, g.id)
      from public.category_groups g where g.household_id = p_household_id), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'group_id', c.group_id, 'name', c.name, 'position', c.position,
        'card_account_id', c.card_account_id, 'created_at', c.created_at
      ) order by c.group_id, c.position, c.id)
      from public.categories c where c.household_id = p_household_id), '[]'::jsonb),
    'category_months', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category_id', m.category_id, 'month', m.month, 'assigned', m.assigned,
        'released', m.released, 'planned', m.planned
      ) order by m.month, m.category_id)
      from public.category_months m where m.household_id = p_household_id), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'account_id', t.account_id, 'date', t.date, 'amount', t.amount,
        'payee', t.payee, 'memo', t.memo, 'is_transfer', t.is_transfer,
        'is_income', t.is_income, 'transfer_id', t.transfer_id, 'voided', t.voided,
        'import_key', t.import_key, 'reconciled', t.reconciled, 'source', t.source,
        'created_at', t.created_at
      ) order by t.date, t.created_at, t.id)
      from public.transactions t where t.household_id = p_household_id), '[]'::jsonb),
    'transaction_allocations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'transaction_id', x.transaction_id, 'category_id', x.category_id, 'amount', x.amount
      ) order by x.transaction_id, x.category_id)
      from public.transaction_allocations x where x.household_id = p_household_id),
      '[]'::jsonb),
    'income_rules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'pattern', r.pattern, 'account_id', r.account_id, 'created_at', r.created_at
      ) order by r.created_at, r.id)
      from public.income_rules r where r.household_id = p_household_id), '[]'::jsonb)
  );
end;
$$;

create function public.restore_backup(p_household_id uuid, p_backup jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_key text;
begin
  if not private.is_household_member(p_household_id) then
    raise exception 'You are not a member of this household' using errcode = '42501';
  end if;
  if jsonb_typeof(p_backup) <> 'object'
     or p_backup->>'format' is distinct from 'budget-buddy-backup'
     or p_backup->>'version' is distinct from '1' then
    raise exception 'That is not a Budget Buddy backup this version can read'
      using errcode = '22023';
  end if;
  foreach v_key in array array['accounts', 'category_groups', 'categories', 'category_months',
                               'transactions', 'transaction_allocations', 'income_rules'] loop
    if jsonb_typeof(p_backup->v_key) is distinct from 'array' then
      raise exception 'The backup is missing its % list', v_key using errcode = '22023';
    end if;
  end loop;
  if exists (select 1 from public.accounts where household_id = p_household_id)
     or exists (select 1 from public.category_groups where household_id = p_household_id)
     or exists (select 1 from public.categories where household_id = p_household_id)
     or exists (select 1 from public.category_months where household_id = p_household_id)
     or exists (select 1 from public.transactions where household_id = p_household_id)
     or exists (select 1 from public.income_rules where household_id = p_household_id) then
    raise exception 'A backup can only be restored into an empty household'
      using errcode = '22023';
  end if;

  update public.households
    set name = left(trim(p_backup->'household'->>'name'), 100)
    where id = p_household_id
      and length(trim(coalesce(p_backup->'household'->>'name', ''))) > 0;

  insert into public.category_groups (id, household_id, name, position, created_at)
    select x.id, p_household_id, x.name, x.position, coalesce(x.created_at, now())
    from jsonb_to_recordset(p_backup->'category_groups')
      as x(id uuid, name text, position integer, created_at timestamptz);

  -- Closed for now, so the payment envelopes the trigger adds can be removed.
  insert into public.accounts (id, household_id, name, type, opening_balance, opening_date,
                               on_budget, closed_at, import_format, created_at)
    select x.id, p_household_id, x.name, x.type, x.opening_balance, x.opening_date,
           coalesce(x.on_budget, true), now(), x.import_format, coalesce(x.created_at, now())
    from jsonb_to_recordset(p_backup->'accounts')
      as x(id uuid, name text, type text, opening_balance bigint, opening_date date,
           on_budget boolean, import_format jsonb, created_at timestamptz);

  delete from public.categories
    where household_id = p_household_id and card_account_id is not null;
  delete from public.category_groups g
    where g.household_id = p_household_id
      and g.id not in (select (e->>'id')::uuid
                         from jsonb_array_elements(p_backup->'category_groups') e);

  insert into public.categories (id, household_id, group_id, name, position, card_account_id,
                                 created_at)
    select x.id, p_household_id, x.group_id, x.name, x.position, x.card_account_id,
           coalesce(x.created_at, now())
    from jsonb_to_recordset(p_backup->'categories')
      as x(id uuid, group_id uuid, name text, position integer, card_account_id uuid,
           created_at timestamptz);

  insert into public.category_months (household_id, category_id, month, assigned, released,
                                      planned)
    select p_household_id, x.category_id, x.month, coalesce(x.assigned, 0),
           coalesce(x.released, 0), coalesce(x.planned, 0)
    from jsonb_to_recordset(p_backup->'category_months')
      as x(category_id uuid, month text, assigned bigint, released bigint, planned bigint);

  insert into public.transactions (id, household_id, account_id, date, amount, payee, memo,
                                   is_transfer, is_income, transfer_id, voided, import_key,
                                   reconciled, source, created_at)
    select x.id, p_household_id, x.account_id, x.date, x.amount, coalesce(x.payee, ''),
           coalesce(x.memo, ''), coalesce(x.is_transfer, false), coalesce(x.is_income, false),
           x.transfer_id, coalesce(x.voided, false), x.import_key,
           coalesce(x.reconciled, false), coalesce(x.source, 'manual'),
           coalesce(x.created_at, now())
    from jsonb_to_recordset(p_backup->'transactions')
      as x(id uuid, account_id uuid, date date, amount bigint, payee text, memo text,
           is_transfer boolean, is_income boolean, transfer_id uuid, voided boolean,
           import_key text, reconciled boolean, source text, created_at timestamptz);

  insert into public.transaction_allocations (household_id, transaction_id, category_id, amount)
    select p_household_id, x.transaction_id, x.category_id, x.amount
    from jsonb_to_recordset(p_backup->'transaction_allocations')
      as x(transaction_id uuid, category_id uuid, amount bigint);

  insert into public.income_rules (household_id, pattern, account_id, created_at)
    select p_household_id, x.pattern, x.account_id, coalesce(x.created_at, now())
    from jsonb_to_recordset(p_backup->'income_rules')
      as x(pattern text, account_id uuid, created_at timestamptz);

  update public.accounts a
    set closed_at = x.closed_at
    from jsonb_to_recordset(p_backup->'accounts') as x(id uuid, closed_at timestamptz)
    where a.id = x.id and a.household_id = p_household_id;

  -- Run the deferred checks now (transfer pairs, split sums), so a broken
  -- file fails here with a readable message instead of at commit.
  set constraints all immediate;
end;
$$;

revoke all on function public.export_backup(uuid) from public, anon;
grant execute on function public.export_backup(uuid) to authenticated;
revoke all on function public.restore_backup(uuid, jsonb) from public, anon;
grant execute on function public.restore_backup(uuid, jsonb) to authenticated;
