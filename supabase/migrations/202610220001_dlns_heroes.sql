begin;

insert into public.dlns_heroes (name, first_available) values
  ('Rat King',5900001),
  ('Baba',5900001),
  ('Solomon',6000001),
  ('Deadman Danny',6000001),
  ('Violet',6100001),
  ('Nurse Harrow',6100001)
on conflict (name) do update set first_available = excluded.first_available;

commit;
