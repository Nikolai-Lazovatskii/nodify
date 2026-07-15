-- Nodify self-hosted Supabase schema.
-- Apply this migration after the Supabase stack is initialized.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mind_maps (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  title text not null default 'Untitled',
  schema_version integer not null default 2,
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create index if not exists mind_maps_user_updated_at_idx
  on public.mind_maps (user_id, updated_at desc)
  where deleted_at is null;

create index if not exists mind_maps_user_deleted_at_idx
  on public.mind_maps (user_id, deleted_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.mind_maps enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_delete_own
on public.profiles
for delete
to authenticated
using ((select auth.uid()) = id);

drop policy if exists mind_maps_select_own on public.mind_maps;
create policy mind_maps_select_own
on public.mind_maps
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists mind_maps_insert_own on public.mind_maps;
create policy mind_maps_insert_own
on public.mind_maps
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists mind_maps_update_own on public.mind_maps;
create policy mind_maps_update_own
on public.mind_maps
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists mind_maps_delete_own on public.mind_maps;
create policy mind_maps_delete_own
on public.mind_maps
for delete
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_user_profile();
