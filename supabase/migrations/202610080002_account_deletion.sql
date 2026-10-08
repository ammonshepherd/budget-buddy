begin;
create function public.prepare_user_deletion(p_user uuid) returns void language plpgsql security definer set search_path='' as $$
declare h uuid; member_role text;
begin
  select household_id,role into h,member_role from public.household_members where user_id=p_user;
  if h is null then return; end if;
  perform 1 from public.households where id=h for update;
  if member_role='owner' and exists(select 1 from public.household_members where household_id=h and user_id<>p_user) then raise exception 'Transfer household ownership before deleting the owner account.'; end if;
end; $$;
-- Runs inside Auth's delete transaction, so an Auth failure cannot leave a
-- signed-in user whose household data has already been removed.
create function public.cleanup_deleted_budget_user() returns trigger language plpgsql security definer set search_path='' as $$
declare h uuid; member_role text;
begin
  perform public.prepare_user_deletion(old.id);
  select household_id,role into h,member_role from public.household_members where user_id=old.id;
  if h is null then return old; end if;
  if member_role='owner' then
    -- All FKs cascade within this sole-owner household; retained shared data is
    -- never deleted when a regular member removes their login.
    delete from public.transaction_allocations where household_id=h;
    delete from public.transactions where household_id=h;
    delete from public.category_months where household_id=h;
    delete from public.categories where household_id=h;
    delete from public.category_groups where household_id=h;
    delete from public.accounts where household_id=h;
    delete from public.households where id=h;
  else delete from public.household_members where household_id=h and user_id=old.id; end if;
  return old;
end; $$;
create trigger budget_user_cleanup before delete on auth.users for each row execute function public.cleanup_deleted_budget_user();
create function public.transfer_household_ownership(p_email text) returns void language plpgsql security definer set search_path='' as $$
declare h uuid; u uuid;
begin
  select household_id into h from public.household_members where user_id=auth.uid() and role='owner';
  if h is null then raise exception 'Only the owner can transfer ownership.'; end if;
  perform 1 from public.households where id=h for update;
  select m.user_id into u from public.household_members m join auth.users a on a.id=m.user_id where m.household_id=h and lower(a.email)=lower(trim(p_email)) and m.user_id<>auth.uid();
  if u is null then raise exception 'Choose another existing household member.'; end if;
  update public.household_members set role=case when user_id=u then 'owner' else 'member' end where household_id=h;
end; $$;
revoke all on function public.prepare_user_deletion(uuid),public.cleanup_deleted_budget_user(),public.transfer_household_ownership(text) from public,anon,authenticated;
grant execute on function public.prepare_user_deletion(uuid) to service_role;
grant execute on function public.transfer_household_ownership(text) to authenticated;
commit;
