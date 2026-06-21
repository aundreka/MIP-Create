# Team server on Supabase — shared MIP library, ownership, PM monitoring

The blueprint for turning the local editor into a multi-user tool: teammates work
on a client's MIPs from one shared library, each owning their own MIP; project
managers monitor progress and download MIPs themselves; shared templates keep
animation/SFX styling consistent. Model: **shared library + ownership** (no live
co-editing — each MIP is edited by its owner; everyone else has read/browse).

> Status: this is the design + schema + setup. The editor code that talks to
> Supabase (the `SupabaseProjectStore` and auth UI) is implemented **after** you
> create the Supabase project and provide its URL + anon key, because it can't be
> built or tested without them. Phase 1 (the QA checker) already made `client` /
> `mip` first-class on `ProjectMeta`, which is the data this layer syncs.

## Why Supabase fits

It gives, managed, the four things this needs: **Postgres** (the MIP index + roles),
**Auth** (accounts/login), **Storage** (the large base64 `ProjectData` blobs +
exported HTML/thumbnails), and **Row-Level Security** (who can read/write which MIP).
No server to run.

## 1. Setup (one-time, ~15 min)

1. Create a project at supabase.com → copy the **Project URL** and **anon public key**.
2. Auth → enable **Email** (magic link is simplest for a small team).
3. SQL editor → run the migration in §3.
4. Storage → create buckets `projects` (private) and `templates` (private).
5. Add the keys to the editor env (see §5).

## 2. Data model

```
org (your company)
 └─ member (user + role: designer | dev | pm | admin)
 └─ client (e.g. "Bioma")
      └─ project  == one MIP   (owner, status, version, pointer to blob in Storage)
```

- A **project row is one MIP** — it mirrors the local library record plus
  `client`, `mip`, `owner_id`, `status`, `version`. The heavy `ProjectData` JSON
  (scenes + base64 assets) lives in **Storage** at `projects/<id>/data.json`, not in
  a DB column — keeps rows small and downloads trivial.
- `status ∈ draft | in_review | approved | shipped` powers the PM dashboard.
- `version` is a monotonic integer for an optimistic-concurrency guard (since there's
  no live co-editing, last-write-wins per MIP with a stale-write warning is enough).

## 3. Schema + RLS (run in Supabase SQL editor)

```sql
create table org (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table member (
  org_id  uuid references org(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role    text not null check (role in ('designer','dev','pm','admin')),
  primary key (org_id, user_id)
);

create table client (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references org(id) on delete cascade,
  name text not null,
  unique (org_id, name)
);

create table project (              -- one row == one MIP
  id uuid primary key default gen_random_uuid(),
  org_id uuid references org(id) on delete cascade,
  client_id uuid references client(id) on delete set null,
  name text not null,
  mip text,
  mip_version text,
  owner_id uuid references auth.users(id),
  status text not null default 'draft' check (status in ('draft','in_review','approved','shipped')),
  version int not null default 1,     -- bump on each save; reject stale writes
  data_path text,                     -- 'projects/<id>/data.json' in Storage
  export_path text,                   -- 'projects/<id>/export.html' (latest build)
  thumb_path text,                    -- 'projects/<id>/thumb.png'
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

-- helper: is the current user a member of this org?
create or replace function is_member(o uuid) returns boolean language sql security definer as $$
  select exists (select 1 from member m where m.org_id = o and m.user_id = auth.uid());
$$;
create or replace function my_role(o uuid) returns text language sql security definer as $$
  select role from member m where m.org_id = o and m.user_id = auth.uid();
$$;

alter table project enable row level security;
alter table client  enable row level security;
alter table member  enable row level security;

-- everyone in the org can READ all of its clients + MIPs (the "shared library")
create policy read_projects on project for select using (is_member(org_id));
create policy read_clients  on client  for select using (is_member(org_id));
create policy read_members  on member  for select using (is_member(org_id));

-- designers/devs create MIPs they own; PMs cannot author
create policy insert_projects on project for insert
  with check (is_member(org_id) and owner_id = auth.uid() and my_role(org_id) in ('designer','dev','admin'));

-- owners edit their own MIP; PMs/admins may only move status (enforce columns in the app)
create policy update_own on project for update
  using (owner_id = auth.uid() or my_role(org_id) in ('pm','admin'))
  with check (is_member(org_id));

create policy delete_own on project for delete
  using (owner_id = auth.uid() or my_role(org_id) = 'admin');
```

Storage RLS (buckets `projects`, `templates`): allow `select` to any org member and
`insert/update` to the MIP's owner. Supabase Storage policies key off the object path;
gate on a `projects/<project_id>/...` prefix joined back to `project.owner_id`.

## 4. Shared templates (the consistency lever)

Put the existing `.playable-template.zip` files (already produced by
`src/templates.ts`) in the `templates` bucket, scoped per org/client. Everyone starts
a new MIP from the same locked chrome / CTA pulse / SFX / transitions — this is the
structural way "consistent animation styling and SFX" is enforced, complementing the
QA checker that *detects* drift after the fact.

## 5. Editor integration (the code that follows)

Introduce a `ProjectStore` seam behind the current local library. Today
[`src/projects.ts`](../src/projects.ts) IS the store (localStorage). Refactor its
public surface (`listProjects`, `loadProjectData`, `saveCurrent`, `createProject`,
`patchProjectMeta`, …) into an interface with two implementations:

- `LocalProjectStore` — today's localStorage code, unchanged. Default + offline cache.
- `SupabaseProjectStore` — same methods over Postgres + Storage. On `save`: upload
  `data.json`, bump `version` (reject if the server version moved → "a newer version
  exists, reload"), upsert the row. On `open`: download the blob. Keep a localStorage
  mirror so the editor works offline and pushes on reconnect.

Env (Vite reads `VITE_`-prefixed vars from `.env.local`, already git-ignored by Vite
convention):
```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
```
New files: `src/cloud/supabase.ts` (client + auth), `src/cloud/SupabaseProjectStore.ts`.
`HomeScreen.tsx` gains a "Team" tab listing client → MIPs with owner + status badges;
a small sign-in modal uses Supabase magic-link.

On export, have [`src/export.ts`](../src/export.ts) also upload the built `export.html`
+ a `thumb.png` to Storage so PMs always have the latest shippable build to download.

## 6. PM monitoring

A read-only dashboard over the `project` rows — either a panel in the editor (gated to
`role = pm`) or a tiny standalone web page hosted on Suphase/Vercel using the same
tables. Per client it lists each MIP with owner, status, `updated_at`, thumbnail, and
**Download** (the stored `export.html` or the project JSON). PMs self-serve downloads
and flip `status` — no designer hand-off. RLS already makes PM access read-only except
status.

## 7. QA checker, now team-wide

The Phase 1 engine ([`src/qa/consistency.ts`](../src/qa/consistency.ts) +
`fingerprint.ts`) is pure and store-agnostic — `buildProfiles()` is the only part that
reads the library. Point it at `SupabaseProjectStore` instead of localStorage and the
exact same consistency rules run across the **whole team's** MIPs for a client, not just
one machine. No rule changes; just a different data source.

## What I need from you to build §5–§6

1. A Supabase project URL + anon key (after running §1–§3).
2. Confirmation of the role names (designer / dev / pm / admin) and whether PMs should
   also be able to reassign a MIP's owner.

With those, the `SupabaseProjectStore`, auth UI, export-upload hook, and PM dashboard
are a focused, testable next step.
