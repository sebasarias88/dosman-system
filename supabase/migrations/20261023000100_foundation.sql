-- =============================================================================
-- 01 · Foundation: schemas, enums, branches, staff profiles and access helpers
-- =============================================================================
-- Security model (read this first):
--   * The publishable (anon) key is public by design. Row Level Security (RLS)
--     is the real lock on every table.
--   * Staff never write directly to sales, payments, cash or stock tables.
--     Those writes happen only through `security definer` functions (RPCs) that
--     validate the operation and leave an audit trail. Records of money and
--     stock are append-only: nobody can edit or delete them from the app.
--   * Helper functions live in the `private` schema, which is not exposed by
--     the Data API, so they can be used inside policies but not called by URL.
-- =============================================================================

create schema if not exists private;
grant usage on schema private to authenticated;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.app_role as enum ('owner', 'admin', 'cashier', 'waiter', 'kitchen');

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Business settings (single row)
-- -----------------------------------------------------------------------------
create table public.app_settings (
  id boolean primary key default true check (id),
  business_name text not null default 'Dosman · Cholao & Coffee',
  timezone text not null default 'America/Bogota',
  storage_warning_percent smallint not null default 80
    check (storage_warning_percent between 50 and 95),
  updated_at timestamptz not null default now()
);
comment on table public.app_settings is 'Single-row business configuration.';

insert into public.app_settings default values;

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Branches (sedes)
-- -----------------------------------------------------------------------------
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 60),
  is_main boolean not null default false,
  -- Waiters (table service) are only used at the main branch.
  uses_waiters boolean not null default false,
  -- Delivery orders (WhatsApp / phone) are only taken at the main branch.
  takes_delivery boolean not null default false,
  -- Sales after midnight still belong to the previous business day until this hour.
  day_cutoff time not null default '05:00',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.branches is 'Business locations. The main branch supplies the smaller one.';

-- Only one main branch.
create unique index branches_single_main_idx on public.branches (is_main) where is_main;

create trigger branches_set_updated_at
  before update on public.branches
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Staff profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9._-]{3,30}$'),
  full_name text not null check (length(trim(full_name)) between 2 and 80),
  role public.app_role not null,
  -- null = every branch (owners and general admins).
  branch_id uuid references public.branches (id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Active branch staff must belong to a branch. Disabled accounts may not have one yet.
  constraint profiles_branch_required check (
    not is_active or role in ('owner', 'admin') or branch_id is not null
  )
);
comment on table public.profiles is 'Staff accounts. Login is username + PIN (username maps to <username>@dosman.internal).';

create index profiles_branch_idx on public.profiles (branch_id);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- New auth users get a profile automatically.
-- Role and branch come from app_metadata, which only the server (service role)
-- can set, so a user can never promote themselves.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta_role text := new.raw_app_meta_data ->> 'role';
  meta_branch text := new.raw_app_meta_data ->> 'branch_id';
begin
  insert into public.profiles (id, username, full_name, role, branch_id, is_active)
  values (
    new.id,
    lower(split_part(new.email, '@', 1)),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    coalesce(meta_role, 'cashier')::public.app_role,
    nullif(meta_branch, '')::uuid,
    -- Accounts created without an explicit role stay disabled until an owner reviews them.
    meta_role is not null
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- Access helpers used by every policy.
-- `security definer` lets them read profiles without triggering RLS recursion.
-- -----------------------------------------------------------------------------
create or replace function private.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid()) and p.is_active;
$$;

create or replace function private.current_branch_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.branch_id
  from public.profiles p
  where p.id = (select auth.uid()) and p.is_active;
$$;

create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  );
$$;

create or replace function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_app_role() = 'owner', false);
$$;

create or replace function private.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_app_role() in ('owner', 'admin'), false);
$$;

-- True when the signed-in staff member may see data from the given branch.
create or replace function private.can_access_branch(target_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active
      and (p.branch_id is null or p.branch_id = target_branch)
  );
$$;

-- Business date of a branch: 1:30 a.m. still counts as "yesterday" before the cutoff.
create or replace function private.business_date(target_branch uuid, at_time timestamptz default now())
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select ((at_time at time zone s.timezone) - b.day_cutoff::interval)::date
  from public.branches b
  cross join public.app_settings s
  where b.id = target_branch;
$$;

-- Function privileges are set in the security migration (06).
