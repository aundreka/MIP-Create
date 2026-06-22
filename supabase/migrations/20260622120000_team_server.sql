-- Team server — shared MIP library + ownership + PM monitoring.
-- Model: shared library + ownership (no live co-editing). Everyone in the org
-- reads all MIPs; you write your own; PMs/admins read all, move status, and
-- reassign owners. One `project` row == one MIP; the heavy ProjectData JSON lives
-- in Storage. Applied automatically by the Supabase GitHub integration.

create extension if not exists pgcrypto;

-- ---------------- tables ----------------
create table if not exists public.org (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz default now()
);

create table if not exists public.member (
  org_id  uuid references public.org(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role    text not null default 'designer' check (role in ('designer','dev','pm','admin')),
  primary key (org_id, user_id)
);

create table if not exists public.client (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.org(id) on delete cascade,
  name text not null,
  unique (org_id, name)
);

create table if not exists public.project (   -- one row == one MIP
  id text primary key,                          -- matches the editor's local library id
  org_id uuid not null references public.org(id) on delete cascade,
  client_id uuid references public.client(id) on delete set null,
  client_name text,                             -- denormalized for grouping/listing
  name text not null,
  mip text,
  mip_version text,
  owner_id uuid references auth.users(id),
  status text not null default 'draft' check (status in ('draft','in_review','approved','shipped')),
  version int not null default 1,
  data_path text,                               -- '<id>/data.json' in the projects bucket
  export_path text,
  thumb_path text,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

-- ---------------- helpers (security definer → no RLS recursion) ----------------
create or replace function public.is_member(o uuid) returns boolean
  language sql security definer set search_path = public as $$
  select exists (select 1 from public.member m where m.org_id = o and m.user_id = auth.uid());
$$;

create or replace function public.my_role(o uuid) returns text
  language sql security definer set search_path = public as $$
  select role from public.member m where m.org_id = o and m.user_id = auth.uid();
$$;

-- ---------------- default org + new-user bootstrap ----------------
insert into public.org (id, name)
  values ('00000000-0000-0000-0000-000000000001', 'HPL')
  on conflict (id) do nothing;

-- Every new authenticated user gets a profile and joins the default org as a
-- 'designer'. Promote the first/admin user manually after they sign in:
--   update public.member set role = 'admin' where user_id = (select id from auth.users where email = 'you@example.com');
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
    on conflict (id) do update set email = excluded.email;
  insert into public.member (org_id, user_id, role)
    values ('00000000-0000-0000-0000-000000000001', new.id, 'designer')
    on conflict do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at() returns trigger
  language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists project_touch on public.project;
create trigger project_touch before update on public.project
  for each row execute function public.touch_updated_at();

-- ---------------- RLS ----------------
alter table public.org      enable row level security;
alter table public.profiles enable row level security;
alter table public.member   enable row level security;
alter table public.client   enable row level security;
alter table public.project  enable row level security;

drop policy if exists org_read on public.org;
create policy org_read on public.org for select using (public.is_member(id));

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select
  using (exists (select 1 from public.member m where m.user_id = auth.uid()));
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for update using (id = auth.uid());

drop policy if exists member_read on public.member;
create policy member_read on public.member for select using (public.is_member(org_id));

drop policy if exists client_read on public.client;
create policy client_read on public.client for select using (public.is_member(org_id));
drop policy if exists client_write on public.client;
create policy client_write on public.client for insert with check (public.is_member(org_id));

drop policy if exists project_read on public.project;
create policy project_read on public.project for select using (public.is_member(org_id));

drop policy if exists project_insert on public.project;
create policy project_insert on public.project for insert
  with check (public.is_member(org_id) and owner_id = auth.uid() and public.my_role(org_id) in ('designer','dev','admin'));

-- owners edit their own MIP; PMs/admins may update any (status + owner reassignment)
drop policy if exists project_update on public.project;
create policy project_update on public.project for update
  using (owner_id = auth.uid() or public.my_role(org_id) in ('pm','admin'))
  with check (public.is_member(org_id));

drop policy if exists project_delete on public.project;
create policy project_delete on public.project for delete
  using (owner_id = auth.uid() or public.my_role(org_id) = 'admin');

-- ---------------- storage ----------------
insert into storage.buckets (id, name, public)
  values ('projects','projects', false), ('templates','templates', false)
  on conflict (id) do nothing;

-- read: any authenticated org member; write: the MIP's owner or a pm/admin.
-- The first path segment of an object name is the project id (e.g. '<id>/data.json').
drop policy if exists projects_read on storage.objects;
create policy projects_read on storage.objects for select to authenticated
  using (bucket_id = 'projects');

drop policy if exists projects_insert on storage.objects;
create policy projects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'projects' and exists (
    select 1 from public.project p
    where p.id = (storage.foldername(name))[1]
      and (p.owner_id = auth.uid() or public.my_role(p.org_id) in ('pm','admin'))
  ));

drop policy if exists projects_update on storage.objects;
create policy projects_update on storage.objects for update to authenticated
  using (bucket_id = 'projects' and exists (
    select 1 from public.project p
    where p.id = (storage.foldername(name))[1]
      and (p.owner_id = auth.uid() or public.my_role(p.org_id) in ('pm','admin'))
  ));

drop policy if exists templates_read on storage.objects;
create policy templates_read on storage.objects for select to authenticated using (bucket_id = 'templates');
drop policy if exists templates_write on storage.objects;
create policy templates_write on storage.objects for insert to authenticated with check (bucket_id = 'templates');
