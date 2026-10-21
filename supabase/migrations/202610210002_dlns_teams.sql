begin;

create table public.dlns_teams (
  region text not null check (region in ('EU','NA')),
  name text not null check (name = trim(name) and length(name) between 1 and 100
    and lower(name) not in ('team 1','team 2')),
  created_at timestamptz not null default now(),
  primary key (region,name)
);

create unique index dlns_teams_region_name on public.dlns_teams (region,lower(name));
alter table public.dlns_teams enable row level security;
revoke all on public.dlns_teams from public,anon,authenticated;
grant select on public.dlns_teams to anon,authenticated;
create policy dlns_public_teams on public.dlns_teams for select to anon,authenticated using (true);

create function public.dlns_add_team(p_name text,p_region text)
returns public.dlns_teams
language plpgsql security definer set search_path = ''
as $$
declare
  team_name text := trim(p_name);
  existing_name text;
  saved public.dlns_teams;
begin
  if not public.dlns_is_admin() then
    raise exception 'Only the DLNS owner can add teams.' using errcode = '42501';
  end if;
  if p_region is null or p_region not in ('EU','NA') then
    raise exception 'Choose EU or NA.' using errcode = '22023';
  end if;
  if team_name is null or length(team_name) not between 1 and 100
     or lower(team_name) in ('team 1','team 2') then
    raise exception 'Enter the actual team name (100 characters or fewer).' using errcode = '22023';
  end if;
  -- Keep the spelling already used in match history when re-adding a known team.
  select name into existing_name from (
    select left_team as name from public.dlns_matches where region = p_region
    union select right_team from public.dlns_matches where region = p_region
  ) history where lower(name) = lower(team_name) order by name limit 1;
  insert into public.dlns_teams (region,name) values (p_region,coalesce(existing_name,team_name))
  on conflict (region,(lower(name))) do update set name = dlns_teams.name
  returning * into saved;
  return saved;
end;
$$;

revoke all on function public.dlns_add_team(text,text) from public;
grant execute on function public.dlns_add_team(text,text) to authenticated;

notify pgrst,'reload schema';
commit;
