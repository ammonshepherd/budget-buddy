-- v0.27.0: a stored reconciled mark per transaction. Ticking transactions off
-- against the bank sets it; it is only a mark (no statement balance, no lock
-- on edits) and changes no budget math. Every existing row starts unreconciled.
alter table public.transactions
  add column reconciled boolean not null default false;

-- Marks (or unmarks) several transactions in one step. Row Level Security
-- limits it to the caller's household; rows already in that state are left
-- alone. Resolves to how many changed.
create function public.set_reconciled(p_ids uuid[], p_reconciled boolean)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if coalesce(array_length(p_ids, 1), 0) > 2000 then
    raise exception 'Reconcile at most 2000 transactions at once' using errcode = '22023';
  end if;
  update public.transactions
    set reconciled = p_reconciled
    where id = any (p_ids) and reconciled <> p_reconciled;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.set_reconciled(uuid[], boolean) from public, anon;
grant execute on function public.set_reconciled(uuid[], boolean) to authenticated;
