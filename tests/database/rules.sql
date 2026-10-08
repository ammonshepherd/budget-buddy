\set ON_ERROR_STOP on
insert into auth.users values('00000000-0000-4000-8000-000000000001','owner@example.test'),('00000000-0000-4000-8000-000000000002','other@example.test'),('00000000-0000-4000-8000-000000000003','partner@example.test');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
select public.create_household('Test household',to_char(current_date,'YYYY-MM'),'USD');
do $$declare s jsonb; h uuid; a uuid:=gen_random_uuid(); g uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); r jsonb; failed boolean;
begin
  s:=public.get_budget_state(); h:=(s->'household'->>'id')::uuid;
  s:=s||jsonb_build_object('accounts',jsonb_build_array(jsonb_build_object('id',a,'name','Checking','type','cash','on_budget',true,'opening_balance',100000,'opening_date',date_trunc('month',current_date)::date,'archived',false)),
    'groups',jsonb_build_array(jsonb_build_object('id',g,'name','Everyday','position',0,'archived',false)),
    'categories',jsonb_build_array(jsonb_build_object('id',c,'group_id',g,'name','Food','kind','spending','card_account_id',null,'position',0,'archived',false)),
    'months',jsonb_build_array(jsonb_build_object('category_id',c,'month',to_char(current_date,'YYYY-MM'),'assigned',10000,'planned',12000,'saved_used',0)));
  s:=public.save_budget_state(0,s);
  r:=jsonb_build_object('id',t,'account_id',a,'date',current_date,'posted_date',null,'amount',-12000,'payee','Over budget','note','','tags','[]'::jsonb,'kind','expense','funding','funded','status','active','transfer_id',null,'merged_into_id',null,'source','manual','external_id',null,'original_description','','import_data','{}'::jsonb,'allocations',jsonb_build_array(jsonb_build_object('category_id',c,'amount',-12000)));
  failed:=false;
  begin perform public.save_budget_state(1,jsonb_set(s,'{transactions}',jsonb_build_array(r))); exception when others then
    if sqlerrm not like '%Insufficient Available%' then raise; end if; failed:=true;
  end;
  if not failed then raise exception 'Overspending was accepted'; end if;
  -- A real bank charge stays in the ledger pending resolution.
  r:=r||jsonb_build_object('source','csv','funding','needs_funding','allocations','[]'::jsonb);
  s:=public.save_budget_state(1,jsonb_set(s,'{transactions}',jsonb_build_array(r)));
  if (s->'household'->>'revision')::integer<>2 then raise exception 'Revision did not increment'; end if;
  failed:=false; begin perform public.save_budget_state(1,s); exception when others then
    if sqlerrm not like '%changed in another%' then raise; end if; failed:=true;
  end;
  if not failed then raise exception 'Stale revision accepted'; end if;
  -- Increase assignment, then resolve the imported charge atomically.
  s:=jsonb_set(s,'{months,0,assigned}','12000'::jsonb);
  s:=jsonb_set(s,'{transactions,0,funding}','"funded"'::jsonb);
  s:=jsonb_set(s,'{transactions,0,allocations}',jsonb_build_array(jsonb_build_object('category_id',c,'amount',-12000)));
  s:=public.save_budget_state(2,s);
  failed:=false; begin perform public.save_budget_state(3,jsonb_set(s,'{transactions,0,allocations,0,amount}','-11000'::jsonb)); exception when others then
    if sqlerrm not like '%Split amounts%' then raise; end if; failed:=true;
  end;
  if not failed then raise exception 'Unbalanced split accepted'; end if;
  failed:=false; begin update public.accounts set opening_balance=999999 where id=a; exception when insufficient_privilege then failed:=true; end;
  if not failed then raise exception 'Direct financial DML accepted'; end if;
  failed:=false; begin perform public.save_budget_state(3,jsonb_set(s,'{accounts}','[]'::jsonb)); exception when others then
    if sqlerrm not like '%Archive or void%' then raise; end if; failed:=true;
  end;
  if not failed then raise exception 'History deletion accepted'; end if;
end; $$;
select public.add_household_member('partner@example.test');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
do $$begin if public.get_budget_state() is null then raise exception 'Partner cannot read household'; end if; end;$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
do $$begin if exists(select 1 from public.accounts) or public.get_budget_state() is not null then raise exception 'RLS leaked another household'; end if; end;$$;
select public.create_household('Other budget',to_char(current_date,'YYYY-MM'),'USD');
reset role;
do $$declare h uuid; other uuid; s jsonb; bad uuid;
begin
  select household_id into h from public.household_members where user_id='00000000-0000-4000-8000-000000000001';
  select household_id into other from public.household_members where user_id='00000000-0000-4000-8000-000000000002';
  if public.budget_cash(h)<>88000 or public.budget_reserved(h)<>0 then raise exception 'Canonical cash/reserve calculation failed'; end if;
  if exists(select 1 from public.budget_figures(h) where remaining<>0 or spent<>12000) then raise exception 'Canonical category calculation failed'; end if;
  -- A household lock + expected revision is the concurrency boundary; stale
  -- writers fail before any table mutation (tested above).
  begin perform public.prepare_user_deletion('00000000-0000-4000-8000-000000000001'); raise exception 'Shared owner deletion should fail'; exception when others then
    if sqlerrm not like '%Transfer household ownership%' then raise; end if;
  end;
end; $$;
\echo 'Database rule and RLS checks passed'
