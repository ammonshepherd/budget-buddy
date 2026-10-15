-- v0.19.0: an envelope can move to another group (a plain update of group_id
-- and position; Row Level Security and the household-scoped foreign key keep it
-- in the household). A card's payment envelope stays with the other cards'
-- payment envelopes, and keeps its card's name.
create or replace function private.protect_card_payment_envelope_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.card_account_id is not null and pg_trigger_depth() = 1 then
    if new.name is distinct from old.name then
      raise exception 'A card''s payment envelope is named after its card; rename the card instead'
        using errcode = '22023';
    end if;
    if new.group_id is distinct from old.group_id then
      raise exception 'A card''s payment envelope stays in its group'
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger categories_card_payment_group
  before update of group_id on public.categories
  for each row execute function private.protect_card_payment_envelope_name();
