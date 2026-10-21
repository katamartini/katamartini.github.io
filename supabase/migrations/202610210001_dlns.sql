begin;

create table public.dlns_heroes (
  name text primary key,
  first_available integer not null
);

insert into public.dlns_heroes (name, first_available) values
  ('Abrams',100001),('Apollo',2600001),('Bebop',100001),('Billy',202001),
  ('Calico',100001),('Celeste',2500001),('Doorman',300001),('Drifter',302001),
  ('Dynamo',100001),('Graves',2400001),('Grey Talon',100001),('Haze',100001),
  ('Holliday',100001),('Infernus',100001),('Ivy',100001),('Kelvin',100001),
  ('Lady Geist',100001),('Lash',100001),('McGinnis',100001),('Mina',200001),
  ('Mirage',100001),('Mo and Krill',100001),('Paige',300001),('Paradox',100001),
  ('Pocket',100001),('Rem',2300001),('Seven',100001),('Shiv',100001),
  ('Silver',2400001),('Sinclair',100001),('Venator',2500001),('Victor',400001),
  ('Vindicta',100001),('Viscous',100001),('Vyper',100001),('Warden',100001),
  ('Wraith',100001),('Yamato',100001);

create table public.dlns_matches (
  match_id text primary key,
  week integer not null check (week between 1 and 9999),
  region text not null check (region in ('EU','NA')),
  round text not null check (round in ('Challenger','Finals')),
  game integer not null check (game between 1 and 99),
  left_team text not null check (length(left_team) between 1 and 100),
  right_team text not null check (length(right_team) between 1 and 100),
  first_pick text not null check (first_pick in ('left','right')),
  winner text check (winner in ('left','right')),
  actions jsonb not null check (jsonb_typeof(actions) = 'array'),
  revision integer not null default 1 check (revision > 0),
  source text not null default 'website',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (lower(left_team) <> lower(right_team)),
  check (match_id = week::text || '-' || region || '-' || left(round,1) || '-' || game::text)
);

create index dlns_matches_chronology on public.dlns_matches (week,region,round,game);

create table public.dlns_match_revisions (
  match_id text not null references public.dlns_matches(match_id) on update cascade,
  revision integer not null,
  snapshot jsonb not null,
  actor uuid,
  saved_at timestamptz not null default now(),
  primary key (match_id,revision)
);

-- Use the provider-owned identity, never editable user metadata, for the allowlist.
create function public.dlns_is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.identities
    where user_id = (select auth.uid())
      and provider = 'github' and provider_id = '66887569'
  );
$$;

create function public.dlns_validate_match() returns trigger
language plpgsql set search_path = ''
as $$
declare
  a jsonb;
  i integer;
  expected_type text;
  expected_side text;
  expected_orders integer[] := array[1,2,1,2,3,4,5,6,3,4,7,8,9,10,11,12];
  first_team_actions boolean[] := array[true,false,true,false,false,true,true,false,false,true,false,true,true,false,false,true];
  seen_heroes text[] := array[]::text[];
  seen_players text[] := array[]::text[];
  match_order integer;
  available_from integer;
  player_name text;
begin
  new.left_team := trim(new.left_team);
  new.right_team := trim(new.right_team);
  if lower(new.left_team) in ('team 1','team 2') or lower(new.right_team) in ('team 1','team 2') then
    raise exception 'Enter the actual team names.' using errcode = '22023';
  end if;
  if jsonb_array_length(new.actions) <> 16 then
    raise exception 'A match needs all 12 picks and 4 bans.' using errcode = '22023';
  end if;
  match_order := new.week * 100000 + case when new.region = 'NA' then 2000 else 0 end
    + case when new.round = 'Finals' then 1000 else 0 end + new.game;
  for i in 0..15 loop
    a := new.actions->i;
    expected_type := case when i in (0,1,8,9) then 'ban' else 'pick' end;
    expected_side := case when first_team_actions[i+1] then new.first_pick
      when new.first_pick = 'left' then 'right' else 'left' end;
    if jsonb_typeof(a) is distinct from 'object'
       or a->>'type' is distinct from expected_type
       or a->>'order' is distinct from expected_orders[i+1]::text
       or a->>'side' is distinct from expected_side then
      raise exception 'Invalid action at draft slot %.', i+1 using errcode = '22023';
    end if;
    select first_available into available_from from public.dlns_heroes where name = a->>'hero';
    if available_from is null then
      raise exception 'Unknown hero at draft slot %.', i+1 using errcode = '22023';
    end if;
    if match_order < available_from then
      raise exception '% was not available for this match.', a->>'hero' using errcode = '22023';
    end if;
    if a->>'hero' = any(seen_heroes) then
      raise exception 'A hero cannot appear twice in one draft.' using errcode = '22023';
    end if;
    seen_heroes := array_append(seen_heroes,a->>'hero');
    if a ? 'player' and jsonb_typeof(a->'player') is distinct from 'string' then
      raise exception 'Player names must be text.' using errcode = '22023';
    end if;
    player_name := trim(coalesce(a->>'player',''));
    if length(player_name) > 100 then
      raise exception 'Player names must be 100 characters or fewer.' using errcode = '22023';
    end if;
    if expected_type = 'ban' and player_name <> '' then
      raise exception 'Bans cannot have player assignments.' using errcode = '22023';
    end if;
    if player_name <> '' then
      if lower(player_name) = any(seen_players)
         and not (tg_op = 'INSERT' and new.source = 'google-sheet') then
        raise exception 'A player cannot be assigned to two heroes.' using errcode = '22023';
      end if;
      seen_players := array_append(seen_players,lower(player_name));
    end if;
  end loop;
  if tg_op = 'UPDATE' and new.revision <> old.revision + 1 then
    raise exception 'The match revision must advance by one.' using errcode = '40001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger dlns_validate_match before insert or update on public.dlns_matches
for each row execute function public.dlns_validate_match();

create function public.dlns_audit_match() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.dlns_match_revisions (match_id,revision,snapshot,actor)
  values (new.match_id,new.revision,to_jsonb(new),auth.uid());
  return new;
end;
$$;

create trigger dlns_audit_match after insert or update on public.dlns_matches
for each row execute function public.dlns_audit_match();

alter table public.dlns_matches enable row level security;
alter table public.dlns_heroes enable row level security;
alter table public.dlns_match_revisions enable row level security;

revoke all on public.dlns_matches,public.dlns_heroes,public.dlns_match_revisions from public,anon,authenticated;
grant select on public.dlns_matches,public.dlns_heroes to anon,authenticated;
grant select on public.dlns_match_revisions to authenticated;

create policy dlns_public_matches on public.dlns_matches for select to anon,authenticated using (true);
create policy dlns_public_heroes on public.dlns_heroes for select to anon,authenticated using (true);
create policy dlns_admin_revisions on public.dlns_match_revisions for select to authenticated
using ((select public.dlns_is_admin()));

-- All application writes go through this atomic, owner-checked function.
create function public.dlns_save_match(p_match jsonb,p_expected_revision integer default null,p_original_match_id text default null)
returns public.dlns_matches
language plpgsql security definer set search_path = ''
as $$
declare
  saved public.dlns_matches;
  original public.dlns_matches;
  target_id text;
  original_id text;
begin
  if not public.dlns_is_admin() then
    raise exception 'Only the DLNS owner can submit or edit matches.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_match) is distinct from 'object' then
    raise exception 'A match object is required.' using errcode = '22023';
  end if;
  target_id := (p_match->>'week')::integer::text || '-' || (p_match->>'region')
    || '-' || left(p_match->>'round',1) || '-' || (p_match->>'game')::integer::text;
  if p_match->>'match_id' is distinct from target_id then
    raise exception 'The match ID does not match the week, region, round and game.' using errcode = '22023';
  end if;
  if p_expected_revision is null then
    insert into public.dlns_matches (match_id,week,region,round,game,left_team,right_team,first_pick,winner,actions)
    values (target_id,(p_match->>'week')::integer,p_match->>'region',p_match->>'round',
      (p_match->>'game')::integer,trim(p_match->>'left_team'),trim(p_match->>'right_team'),
      p_match->>'first_pick',nullif(p_match->>'winner',''),p_match->'actions') returning * into saved;
  else
    original_id := coalesce(p_original_match_id,target_id);
    select * into original from public.dlns_matches where match_id = original_id for update;
    if not found then
      raise exception 'This match no longer exists. Reload the match list.' using errcode = 'P0002';
    end if;
    if original.revision <> p_expected_revision then
      raise exception 'This match changed in another tab. Reload it before saving.' using errcode = '40001';
    end if;
    update public.dlns_matches set match_id = target_id,week = (p_match->>'week')::integer,
      region = p_match->>'region',round = p_match->>'round',game = (p_match->>'game')::integer,
      left_team = trim(p_match->>'left_team'),right_team = trim(p_match->>'right_team'),
      first_pick = p_match->>'first_pick',winner = nullif(p_match->>'winner',''),
      actions = p_match->'actions',revision = original.revision+1
      where match_id = original_id returning * into saved;
  end if;
  return saved;
exception when unique_violation then
  raise exception 'That match ID already exists. Load the existing match to edit it.' using errcode = '23505';
end;
$$;

revoke all on function public.dlns_is_admin() from public;
revoke all on function public.dlns_validate_match() from public;
revoke all on function public.dlns_audit_match() from public;
revoke all on function public.dlns_save_match(jsonb,integer,text) from public;
grant execute on function public.dlns_is_admin() to anon,authenticated;
grant execute on function public.dlns_save_match(jsonb,integer,text) to authenticated;

notify pgrst,'reload schema';
commit;
