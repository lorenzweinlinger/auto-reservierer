-- Auto-Reservierer: database setup for Supabase.
-- Paste this whole file into Supabase → SQL Editor → New query, then press "Run".
-- Running it again is safe; it keeps existing reservations.
--
-- IMPORTANT: change the family code below before running (line with 'HIER-CODE-EINTRAGEN').
-- Pick something that is not easy to guess, e.g. "sonnenblume-42-garage".

create extension if not exists btree_gist with schema extensions;

-- Settings that only the database functions can read.
create table if not exists public.app_config (
  key   text primary key,
  value text not null
);
alter table public.app_config enable row level security;

insert into public.app_config (key, value)
values ('family_code', 'HIER-CODE-EINTRAGEN')
on conflict (key) do update set value = excluded.value;

create table if not exists public.reservations (
  id         uuid primary key default gen_random_uuid(),
  car        text not null check (char_length(car) between 1 and 40),
  person     text not null check (char_length(person) between 1 and 40),
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  note       text not null default '' check (char_length(note) <= 120),
  created_at timestamptz not null default now(),
  constraint valid_range check (ends_at > starts_at and ends_at - starts_at <= interval '31 days'),
  -- A car can never be reserved twice at the same time, even if two people tap at once.
  constraint no_overlap exclude using gist (car with =, tstzrange(starts_at, ends_at) with &&)
);
alter table public.reservations enable row level security;

-- No direct table access from the website: everything goes through the functions below,
-- which check the family code first.
revoke all on public.reservations, public.app_config from anon, authenticated;

create or replace function public._require_code(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_code is null or not exists (
    select 1 from public.app_config where key = 'family_code' and value = p_code
  ) then
    perform pg_sleep(1); -- slows down guessing
    raise exception 'wrong_code' using errcode = '28000';
  end if;
end;
$$;

create or replace function public.check_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_code(p_code);
  return true;
exception when sqlstate '28000' then
  return false;
end;
$$;

create or replace function public.list_reservations(p_code text, p_from timestamptz, p_to timestamptz)
returns setof public.reservations
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_code(p_code);
  return query
    select * from public.reservations r
    where r.ends_at > p_from and r.starts_at < p_to
    order by r.starts_at;
end;
$$;

create or replace function public.create_reservation(
  p_code text, p_car text, p_person text, p_starts timestamptz, p_ends timestamptz, p_note text
)
returns public.reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.reservations;
begin
  perform public._require_code(p_code);
  insert into public.reservations (car, person, starts_at, ends_at, note)
  values (p_car, p_person, p_starts, p_ends, coalesce(p_note, ''))
  returning * into result;
  return result;
exception when exclusion_violation then
  raise exception 'overlap';
end;
$$;

create or replace function public.update_reservation(
  p_code text, p_id uuid, p_car text, p_starts timestamptz, p_ends timestamptz, p_note text
)
returns public.reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.reservations;
begin
  perform public._require_code(p_code);
  update public.reservations
  set car = p_car, starts_at = p_starts, ends_at = p_ends, note = coalesce(p_note, '')
  where id = p_id
  returning * into result;
  if result.id is null then
    raise exception 'not_found';
  end if;
  return result;
exception when exclusion_violation then
  raise exception 'overlap';
end;
$$;

create or replace function public.delete_reservation(p_code text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_code(p_code);
  delete from public.reservations where id = p_id;
end;
$$;

revoke execute on function public._require_code(text) from public, anon, authenticated;
revoke execute on function
  public.check_code(text),
  public.list_reservations(text, timestamptz, timestamptz),
  public.create_reservation(text, text, text, timestamptz, timestamptz, text),
  public.update_reservation(text, uuid, text, timestamptz, timestamptz, text),
  public.delete_reservation(text, uuid)
from public;
grant execute on function
  public.check_code(text),
  public.list_reservations(text, timestamptz, timestamptz),
  public.create_reservation(text, text, text, timestamptz, timestamptz, text),
  public.update_reservation(text, uuid, text, timestamptz, timestamptz, text),
  public.delete_reservation(text, uuid)
to anon, authenticated;
