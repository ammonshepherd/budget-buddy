begin;

create table public.households (
  id uuid primary key default gen_random_uuid(), name text not null check (length(trim(name)) between 1 and 100),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  start_month text not null check (start_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  revision integer not null default 0, created_at timestamptz not null default now()
);
create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','member')),
  primary key (household_id,user_id), unique(user_id)
);
create table public.accounts (
  id uuid primary key, household_id uuid not null references public.households(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 100),
  type text not null check(type in ('cash','credit','tracking')), on_budget boolean not null default true,
  opening_balance bigint not null check(abs(opening_balance) <= 999999999999), opening_date date not null,
  archived boolean not null default false, unique(household_id,id), check(type <> 'tracking' or not on_budget)
);
create table public.category_groups (
  id uuid primary key, household_id uuid not null references public.households(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 100), position integer not null default 0,
  archived boolean not null default false, unique(household_id,id)
);
create table public.categories (
  id uuid primary key, household_id uuid not null references public.households(id) on delete cascade,
  group_id uuid not null, name text not null check(length(trim(name)) between 1 and 100),
  kind text not null default 'spending' check(kind in ('spending','card_payment')), card_account_id uuid,
  position integer not null default 0, archived boolean not null default false, unique(household_id,id),
  foreign key(household_id,group_id) references public.category_groups(household_id,id),
  foreign key(household_id,card_account_id) references public.accounts(household_id,id),
  check ((kind = 'spending' and card_account_id is null) or (kind = 'card_payment' and card_account_id is not null))
);
create unique index one_payment_category_per_card on public.categories(card_account_id) where card_account_id is not null;
create table public.category_months (
  household_id uuid not null references public.households(id) on delete cascade, category_id uuid not null,
  month text not null check(month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  assigned bigint not null default 0 check(assigned between 0 and 999999999999),
  planned bigint not null default 0 check(planned between 0 and 999999999999),
  saved_used bigint not null default 0 check(saved_used between 0 and 999999999999),
  primary key(category_id,month), foreign key(household_id,category_id) references public.categories(household_id,id)
);
create table public.transactions (
  id uuid primary key, household_id uuid not null references public.households(id) on delete cascade,
  account_id uuid not null, date date not null, posted_date date,
  amount bigint not null check(amount <> 0 and abs(amount) <= 999999999999),
  payee text not null check(length(trim(payee)) between 1 and 500), note text not null default '',
  check_number text not null default '', tags text[] not null default '{}',
  kind text not null check(kind in ('expense','refund','income','transfer','adjustment')),
  funding text not null check(funding in ('funded','needs_funding','not_required')),
  status text not null default 'active' check(status in ('active','voided','merged')),
  transfer_id uuid, merged_into_id uuid, source text not null default 'manual' check(source in ('manual','csv')),
  external_id text, original_description text not null default '', import_data jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(household_id,id), foreign key(household_id,account_id) references public.accounts(household_id,id),
  foreign key(household_id,merged_into_id) references public.transactions(household_id,id) deferrable initially deferred,
  check(status <> 'merged' or (merged_into_id is not null and merged_into_id <> id)),
  check(kind <> 'expense' or amount < 0), check(kind not in ('refund','income') or amount > 0),
  check((kind = 'transfer' and transfer_id is not null) or (kind <> 'transfer' and transfer_id is null))
);
create unique index active_bank_id on public.transactions(account_id,external_id) where external_id is not null and status = 'active';
create table public.transaction_allocations (
  household_id uuid not null references public.households(id) on delete cascade,
  transaction_id uuid not null, position integer not null check(position >= 0), category_id uuid not null,
  amount bigint not null check(amount <> 0 and abs(amount) <= 999999999999),
  primary key(transaction_id,position),
  foreign key(household_id,transaction_id) references public.transactions(household_id,id) on delete cascade,
  foreign key(household_id,category_id) references public.categories(household_id,id)
);
create index members_household on public.household_members(household_id);
create index accounts_household on public.accounts(household_id);
create index groups_household on public.category_groups(household_id);
create index categories_group on public.categories(household_id,group_id);
create index months_household on public.category_months(household_id,month);
create index transactions_account_date on public.transactions(household_id,account_id,date desc) where status='active';
create index transactions_transfer on public.transactions(transfer_id) where transfer_id is not null;
create index allocations_category on public.transaction_allocations(household_id,category_id);

-- Membership is the security boundary. Client DML is denied; only the locked RPC
-- below can change financial rows. SECURITY DEFINER functions use an empty path.
create function public.is_budget_member(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.household_members where household_id=p_id and user_id=(select auth.uid()));
$$;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.accounts enable row level security;
alter table public.category_groups enable row level security;
alter table public.categories enable row level security;
alter table public.category_months enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_allocations enable row level security;
create policy member_read on public.households for select to authenticated using(public.is_budget_member(id));
create policy member_read on public.household_members for select to authenticated using(public.is_budget_member(household_id));
create policy member_read on public.accounts for select to authenticated using(public.is_budget_member(household_id));
create policy member_read on public.category_groups for select to authenticated using(public.is_budget_member(household_id));
create policy member_read on public.categories for select to authenticated using(public.is_budget_member(household_id));
create policy member_read on public.category_months for select to authenticated using(public.is_budget_member(household_id));
create policy member_read on public.transactions for select to authenticated using(public.is_budget_member(household_id));
create policy member_read on public.transaction_allocations for select to authenticated using(public.is_budget_member(household_id));
revoke all on public.households,public.household_members,public.accounts,public.category_groups,public.categories,public.category_months,public.transactions,public.transaction_allocations from anon,authenticated;
grant select on public.households,public.household_members,public.accounts,public.category_groups,public.categories,public.category_months,public.transactions,public.transaction_allocations to authenticated;

create function public.budget_figures(p_id uuid) returns table(category_id uuid,month text,assigned bigint,planned bigint,spent bigint,remaining bigint,saved bigint)
language sql stable set search_path='' as $$
  with periods as (
    select to_char(d,'YYYY-MM') as month from public.households h,
    lateral generate_series((h.start_month||'-01')::date, greatest(date_trunc('month',current_date)::date,
      coalesce((select max((m.month||'-01')::date) from public.category_months m where m.household_id=p_id),current_date),
      coalesce((select max(date_trunc('month',t.date)::date) from public.transactions t where t.household_id=p_id),current_date)),interval '1 month') d
    where h.id=p_id
  ), eligible as (
    select t.*,a.type from public.transactions t join public.accounts a on a.id=t.account_id join public.households h on h.id=t.household_id
    where t.household_id=p_id and t.status='active' and t.funding='funded' and a.on_budget and a.type<>'tracking'
      and coalesce(t.posted_date,t.date) between a.opening_date and current_date and to_char(t.date,'YYYY-MM') >= h.start_month
  ), sums as (
    select c.id as category_id,p.month,
      (coalesce(m.assigned,0)+coalesce((select -sum(x.amount) from eligible t join public.transaction_allocations x on x.transaction_id=t.id
        where c.kind='card_payment' and t.account_id=c.card_account_id and t.kind<>'transfer' and to_char(t.date,'YYYY-MM')=p.month),0))::bigint as assigned,
      coalesce(m.planned,0)::bigint as planned, coalesce(m.saved_used,0)::bigint as saved_used,
      coalesce((select -sum(x.amount) from eligible t join public.transaction_allocations x on x.transaction_id=t.id
        where x.category_id=c.id and to_char(t.date,'YYYY-MM')=p.month),0)::bigint as spent
    from public.categories c cross join periods p left join public.category_months m on m.category_id=c.id and m.month=p.month where c.household_id=p_id
  ) select category_id,month,assigned,planned,spent,(assigned-spent)::bigint,
    (coalesce(sum(assigned-spent-saved_used) over(partition by category_id order by month rows between unbounded preceding and 1 preceding),0)-saved_used)::bigint
    from sums;
$$;
create function public.budget_cash(p_id uuid) returns bigint language sql stable set search_path='' as $$
  select coalesce(sum(a.opening_balance+coalesce((select sum(t.amount) from public.transactions t where t.account_id=a.id and t.status='active'
    and coalesce(t.posted_date,t.date) between a.opening_date and current_date),0)),0)::bigint
  from public.accounts a where a.household_id=p_id and a.type='cash' and a.on_budget;
$$;
create function public.budget_reserved(p_id uuid) returns bigint language sql stable set search_path='' as $$
  select coalesce(sum(f.saved+f.remaining),0)::bigint from public.budget_figures(p_id) f where f.month=(select max(month) from public.budget_figures(p_id));
$$;
create function public.get_budget_state() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare h uuid; result jsonb;
begin
  select household_id into h from public.household_members where user_id=(select auth.uid());
  if h is null then return null; end if;
  select jsonb_build_object('household',to_jsonb(b)-'created_at',
    'accounts',coalesce((select jsonb_agg(to_jsonb(a)-'household_id' order by a.name) from public.accounts a where a.household_id=h),'[]'::jsonb),
    'groups',coalesce((select jsonb_agg(to_jsonb(g)-'household_id' order by g.position,g.name) from public.category_groups g where g.household_id=h),'[]'::jsonb),
    'categories',coalesce((select jsonb_agg(to_jsonb(c)-'household_id' order by c.position,c.name) from public.categories c where c.household_id=h),'[]'::jsonb),
    'months',coalesce((select jsonb_agg(to_jsonb(m)-'household_id') from public.category_months m where m.household_id=h),'[]'::jsonb),
    'transactions',coalesce((select jsonb_agg((to_jsonb(t)-'household_id'-'created_at'-'updated_at')||jsonb_build_object('allocations',coalesce(
      (select jsonb_agg(jsonb_build_object('category_id',x.category_id,'amount',x.amount) order by x.position) from public.transaction_allocations x where x.transaction_id=t.id),'[]'::jsonb)) order by t.date desc,t.created_at desc)
      from public.transactions t where t.household_id=h),'[]'::jsonb)) into result from public.households b where b.id=h;
  return result;
end; $$;
create function public.create_household(p_name text,p_start_month text,p_currency text default 'USD') returns jsonb language plpgsql security definer set search_path='' as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  perform 1 from auth.users where id=auth.uid() for update;
  if exists(select 1 from public.household_members where user_id=auth.uid()) then raise exception 'You already belong to a household.'; end if;
  if (p_start_month||'-01')::date > current_date or (p_start_month||'-01')::date < current_date-interval '100 years' then raise exception 'Choose a starting month within the last 100 years.'; end if;
  insert into public.households(name,start_month,currency) values(p_name,p_start_month,p_currency) returning id into h;
  insert into public.household_members values(h,auth.uid(),'owner');
  return public.get_budget_state();
end; $$;

create function public.save_budget_state(p_expected_revision integer,p_state jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare h uuid; rev integer; r jsonb; x jsonb; n integer; old_reserved bigint; old_cash bigint; current_reserved bigint;
begin
  select household_id into h from public.household_members where user_id=(select auth.uid());
  if h is null or h <> (p_state->'household'->>'id')::uuid then raise exception 'Household access denied.'; end if;
  select revision into rev from public.households where id=h for update;
  if rev <> p_expected_revision then raise exception 'This budget changed in another tab or by another member. Refresh before saving.'; end if;
  if octet_length(p_state::text)>10000000 then raise exception 'Budget request is too large.'; end if;
  if (p_state->'household'->>'start_month')<>(select start_month from public.households where id=h) or
     (p_state->'household'->>'currency')<>(select currency from public.households where id=h) then raise exception 'Starting month and currency cannot be changed after setup.'; end if;
  old_reserved := public.budget_reserved(h); old_cash := public.budget_cash(h);
  -- Omitted IDs cannot silently delete shared history. Archiving/voiding is explicit.
  if exists(select 1 from public.accounts a where a.household_id=h and not exists(select 1 from jsonb_array_elements(p_state->'accounts') v where (v->>'id')::uuid=a.id)) or
     exists(select 1 from public.category_groups a where a.household_id=h and not exists(select 1 from jsonb_array_elements(p_state->'groups') v where (v->>'id')::uuid=a.id)) or
     exists(select 1 from public.categories a where a.household_id=h and not exists(select 1 from jsonb_array_elements(p_state->'categories') v where (v->>'id')::uuid=a.id)) or
     exists(select 1 from public.transactions a where a.household_id=h and not exists(select 1 from jsonb_array_elements(p_state->'transactions') v where (v->>'id')::uuid=a.id)) then raise exception 'Archive or void records instead of deleting history.'; end if;
  if exists(select 1 from public.category_months a where a.household_id=h and not exists(select 1 from jsonb_array_elements(p_state->'months') v where (v->>'category_id')::uuid=a.category_id and v->>'month'=a.month)) then raise exception 'Monthly budget history cannot be omitted.'; end if;
  for r in select * from jsonb_array_elements(p_state->'accounts') loop
    if exists(select 1 from public.accounts a where a.id=(r->>'id')::uuid and a.household_id<>h) then raise exception 'Account access denied.'; end if;
    if exists(select 1 from public.accounts a where a.id=(r->>'id')::uuid and exists(select 1 from public.transactions t where t.account_id=a.id) and
      (a.type<>r->>'type' or a.on_budget<>(r->>'on_budget')::boolean or a.opening_balance<>(r->>'opening_balance')::bigint or a.opening_date<>(r->>'opening_date')::date)) then raise exception 'Account baseline is locked after transactions exist. Use a balance adjustment.'; end if;
    insert into public.accounts(id,household_id,name,type,on_budget,opening_balance,opening_date,archived)
    values((r->>'id')::uuid,h,r->>'name',r->>'type',(r->>'on_budget')::boolean,(r->>'opening_balance')::bigint,(r->>'opening_date')::date,(r->>'archived')::boolean)
    on conflict(id) do update set name=excluded.name,type=excluded.type,on_budget=excluded.on_budget,opening_balance=excluded.opening_balance,opening_date=excluded.opening_date,archived=excluded.archived;
  end loop;
  for r in select * from jsonb_array_elements(p_state->'groups') loop
    if exists(select 1 from public.category_groups where id=(r->>'id')::uuid and household_id<>h) then raise exception 'Group access denied.'; end if;
    insert into public.category_groups values((r->>'id')::uuid,h,r->>'name',(r->>'position')::integer,(r->>'archived')::boolean)
    on conflict(id) do update set name=excluded.name,position=excluded.position,archived=excluded.archived;
  end loop;
  for r in select * from jsonb_array_elements(p_state->'categories') loop
    if exists(select 1 from public.categories where id=(r->>'id')::uuid and household_id<>h) then raise exception 'Category access denied.'; end if;
    if exists(select 1 from public.categories where id=(r->>'id')::uuid and (kind<>r->>'kind' or card_account_id is distinct from nullif(r->>'card_account_id','')::uuid)) then raise exception 'Category type and card relationship cannot be changed.'; end if;
    insert into public.categories values((r->>'id')::uuid,h,(r->>'group_id')::uuid,r->>'name',r->>'kind',nullif(r->>'card_account_id','')::uuid,(r->>'position')::integer,(r->>'archived')::boolean)
    on conflict(id) do update set group_id=excluded.group_id,name=excluded.name,kind=excluded.kind,card_account_id=excluded.card_account_id,position=excluded.position,archived=excluded.archived;
  end loop;
  for r in select * from jsonb_array_elements(p_state->'months') loop
    if r->>'month'<(select start_month from public.households where id=h) or (r->>'month'||'-01')::date>current_date+interval '10 years' then raise exception 'Month is outside the supported budget range.'; end if;
    insert into public.category_months values(h,(r->>'category_id')::uuid,r->>'month',(r->>'assigned')::bigint,(r->>'planned')::bigint,(r->>'saved_used')::bigint)
    on conflict(category_id,month) do update set assigned=excluded.assigned,planned=excluded.planned,saved_used=excluded.saved_used;
  end loop;
  for r in select * from jsonb_array_elements(p_state->'transactions') loop
    if exists(select 1 from public.transactions where id=(r->>'id')::uuid and household_id<>h) then raise exception 'Transaction access denied.'; end if;
    if (r->>'date')::date>current_date or (r->>'posted_date')::date>current_date then raise exception 'Future transactions are not supported.'; end if;
    if r->>'funding'='needs_funding' and r->>'source'<>'csv' and not exists(select 1 from public.transactions where id=(r->>'id')::uuid and funding='needs_funding') then raise exception 'New manual purchases must be funded.'; end if;
    insert into public.transactions(id,household_id,account_id,date,posted_date,amount,payee,note,check_number,tags,kind,funding,status,transfer_id,merged_into_id,source,external_id,original_description,import_data)
    values((r->>'id')::uuid,h,(r->>'account_id')::uuid,(r->>'date')::date,(r->>'posted_date')::date,(r->>'amount')::bigint,r->>'payee',coalesce(r->>'note',''),coalesce(r->>'check_number',''),
      array(select jsonb_array_elements_text(r->'tags')),r->>'kind',r->>'funding',r->>'status',nullif(r->>'transfer_id','')::uuid,nullif(r->>'merged_into_id','')::uuid,r->>'source',r->>'external_id',coalesce(r->>'original_description',''),coalesce(r->'import_data','{}'))
    on conflict(id) do update set account_id=excluded.account_id,date=excluded.date,posted_date=excluded.posted_date,amount=excluded.amount,payee=excluded.payee,note=excluded.note,check_number=excluded.check_number,tags=excluded.tags,kind=excluded.kind,funding=excluded.funding,status=excluded.status,transfer_id=excluded.transfer_id,merged_into_id=excluded.merged_into_id,external_id=excluded.external_id,original_description=excluded.original_description,import_data=excluded.import_data,updated_at=now();
    delete from public.transaction_allocations where transaction_id=(r->>'id')::uuid;
    n:=0;
    for x in select * from jsonb_array_elements(r->'allocations') loop
      insert into public.transaction_allocations values(h,(r->>'id')::uuid,n,(x->>'category_id')::uuid,(x->>'amount')::bigint); n:=n+1;
    end loop;
  end loop;
  if exists(select 1 from public.categories c left join public.accounts a on a.id=c.card_account_id where c.household_id=h and c.kind='card_payment' and (a.type<>'credit' or not a.on_budget)) or
    exists(select 1 from public.accounts a where a.household_id=h and a.type='credit' and a.on_budget and not exists(select 1 from public.categories c where c.card_account_id=a.id)) then raise exception 'Every budget credit card needs its own payment category.'; end if;
  if exists(select 1 from public.categories c join public.category_groups g on g.id=c.group_id where c.household_id=h and not c.archived and g.archived) then raise exception 'Move or archive categories before archiving their group.'; end if;
  if exists(select 1 from public.transactions t join public.transaction_allocations x on x.transaction_id=t.id where t.household_id=h and sign(t.amount)<>sign(x.amount)) then raise exception 'Splits must have the same sign as the transaction.'; end if;
  if exists(select 1 from public.transactions t where t.household_id=h and t.kind in ('expense','refund') and
    exists(select 1 from public.transaction_allocations x where x.transaction_id=t.id) and t.amount<>(select sum(x.amount) from public.transaction_allocations x where x.transaction_id=t.id)) then raise exception 'Split amounts must equal the transaction total.'; end if;
  if exists(select 1 from public.transactions t join public.accounts a on a.id=t.account_id join public.households b on b.id=t.household_id where t.household_id=h and t.status='active' and t.kind in ('expense','refund') and a.on_budget and a.type<>'tracking' and coalesce(t.posted_date,t.date)>=a.opening_date and to_char(t.date,'YYYY-MM')>=b.start_month and
    (t.funding='not_required' or (t.funding='funded' and not exists(select 1 from public.transaction_allocations x where x.transaction_id=t.id)))) then raise exception 'Budget purchases must be funded or flagged Needs funding.'; end if;
  if exists(select 1 from public.transactions t join public.transaction_allocations x on x.transaction_id=t.id join public.categories c on c.id=x.category_id where t.household_id=h and t.kind in ('expense','refund') and c.kind<>'spending') then raise exception 'Purchases require spending categories.'; end if;
  if exists(select 1 from public.transactions t where t.household_id=h and t.kind in ('income','adjustment') and (t.funding<>'not_required' or exists(select 1 from public.transaction_allocations x where x.transaction_id=t.id))) then raise exception 'Income and adjustments do not use categories.'; end if;
  if exists(select 1 from public.transactions t where t.household_id=h and t.status='active' and t.kind='transfer' and
    (2<>(select count(*) from public.transactions p where p.household_id=h and p.status='active' and p.transfer_id=t.transfer_id and p.kind='transfer') or
     0<>(select sum(p.amount) from public.transactions p where p.household_id=h and p.status='active' and p.transfer_id=t.transfer_id) or
     2<>(select count(distinct p.account_id) from public.transactions p where p.household_id=h and p.status='active' and p.transfer_id=t.transfer_id) or
     1<>(select count(distinct p.date) from public.transactions p where p.household_id=h and p.status='active' and p.transfer_id=t.transfer_id))) then raise exception 'Transfers require two equal opposite entries on the same date.'; end if;
  -- The outgoing side of a cash-to-card transfer spends the card payment reserve.
  if exists(select 1 from public.transactions t join public.accounts a on a.id=t.account_id join public.transactions p on p.transfer_id=t.transfer_id and p.amount>0 and p.status='active' join public.accounts card on card.id=p.account_id
    where t.household_id=h and t.status='active' and t.kind='transfer' and t.amount<0 and a.on_budget and card.on_budget and card.type='credit' and
    coalesce(t.posted_date,t.date)>=a.opening_date and to_char(t.date,'YYYY-MM')>=(select start_month from public.households where id=h) and
    (t.funding<>'funded' or t.amount<>coalesce((select sum(x.amount) from public.transaction_allocations x join public.categories c on c.id=x.category_id where x.transaction_id=t.id and c.card_account_id=card.id),0))) then raise exception 'Fund the matching card payment category before making a payment.'; end if;
  if exists(select 1 from public.transactions t join public.transaction_allocations x on x.transaction_id=t.id where t.household_id=h and t.status='active' and t.kind='transfer' and
    not (t.amount<0 and exists(select 1 from public.transactions p join public.accounts card on card.id=p.account_id join public.categories c on c.card_account_id=card.id
      where p.transfer_id=t.transfer_id and p.amount>0 and p.status='active' and card.type='credit' and card.on_budget and c.id=x.category_id))) then raise exception 'Ordinary transfers do not spend categories.'; end if;
  if exists(select 1 from public.budget_figures(h) where assigned<0 or remaining<0 or saved<0) then raise exception 'Insufficient Available. Reallocate funds before completing this change.'; end if;
  current_reserved:=public.budget_reserved(h);
  if public.budget_cash(h)-current_reserved<0 and current_reserved>old_reserved then raise exception 'Not enough Assignable money. Resolve unfunded charges or release assignments.'; end if;
  update public.households set name=p_state->'household'->>'name',revision=revision+1 where id=h;
  return public.get_budget_state();
end; $$;

create function public.add_household_member(p_email text) returns void language plpgsql security definer set search_path='' as $$
declare h uuid; u uuid;
begin
  select household_id into h from public.household_members where user_id=auth.uid() and role='owner';
  if h is null then raise exception 'Only the household owner can add a member.'; end if;
  perform 1 from public.households where id=h for update;
  select id into u from auth.users where lower(email)=lower(trim(p_email));
  if u is null then raise exception 'Create this user in Supabase Auth first.'; end if;
  insert into public.household_members values(h,u,'member');
end; $$;

revoke all on function public.is_budget_member(uuid),public.budget_figures(uuid),public.budget_cash(uuid),public.budget_reserved(uuid),public.get_budget_state(),public.create_household(text,text,text),public.save_budget_state(integer,jsonb),public.add_household_member(text) from public,anon,authenticated;
grant execute on function public.is_budget_member(uuid),public.get_budget_state(),public.create_household(text,text,text),public.save_budget_state(integer,jsonb),public.add_household_member(text) to authenticated;
commit;
