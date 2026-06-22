# Team server on Supabase — shared MIP library, ownership, PM monitoring

The blueprint for turning the local editor into a multi-user tool: teammates work
on a client's MIPs from one shared library, each owning their own MIP; project
managers monitor progress and download MIPs themselves; shared templates keep
animation/SFX styling consistent. Model: **shared library + ownership** (no live
co-editing — each MIP is edited by its owner; everyone else has read/browse).

> Status: **IMPLEMENTED** (compiles + builds). The DB migration, auth, and the
> Team panel (publish / browse / monitor / reassign) are in the repo. What's left
> is *operational* and needs you (in Supabase): push the migration, allow the dev
> redirect URL, and promote yourself to admin — see "Operate it" at the bottom.
> The cloud is an **opt-in sync layer** over the local library (the editor still
> works fully offline); it is not a full store replacement. Phase 1 already made
> `client` / `mip` first-class on `ProjectMeta`, which is the data this layer syncs.

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

> §3 above is the abridged schema; the **canonical, runnable migration** is
> [`supabase/migrations/20260622120000_team_server.sql`](../supabase/migrations/20260622120000_team_server.sql)
> (adds profiles, the new-user bootstrap trigger, storage buckets + policies).

## 5. Editor integration (as built)

The cloud is an **opt-in sync layer**, not a store swap — the local library
([`src/projects.ts`](../src/projects.ts)) stays primary so the editor works offline.
Files:

- [`src/cloud/supabase.ts`](../src/cloud/supabase.ts) — client singleton + magic-link
  auth; `isCloudConfigured()` hides the feature when env vars are absent.
- [`src/cloud/teamStore.ts`](../src/cloud/teamStore.ts) — `publish` (upsert row + upload
  `<id>/data.json`, bump `version`), `pull`, `listMips`, `listProfiles`, `myRole`,
  `setStatus`, `reassignOwner`, `deleteMip`. **The cloud project id IS the local library
  id**, so a MIP maps 1:1 with no extra state and re-publishing updates the same row.
- [`src/panels/TeamPanel.tsx`](../src/panels/TeamPanel.tsx) — Topbar **Team** button
  (lazy-loaded so the SDK stays out of the main bundle). Sign in → publish the open MIP →
  browse all team MIPs grouped by client → Open (downloads into the local library via
  `importProjectData`) / download JSON → PM controls.

Env (`.env.local`, git-ignored): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

Still optional/future: uploading `export.html` + `thumb.png` on export (a hook in
[`src/export.ts`](../src/export.ts)); an offline write-queue that re-pushes on reconnect;
a stale-write guard that rejects a publish when the server `version` moved.

## 6. PM monitoring

Built into the Team panel: a PM/admin sees every MIP with owner, status, and version,
can change **status** (draft → in_review → approved → shipped), **reassign owner**, and
**download** any MIP's JSON — no designer hand-off. RLS keeps non-owner designers
read-only. (A standalone web dashboard over the same tables is an easy add later if PMs
want something outside the editor.)

## 7. QA checker, now team-wide (next step)

The Phase 1 engine ([`src/qa/consistency.ts`](../src/qa/consistency.ts) +
`fingerprint.ts`) is pure and store-agnostic — `buildProfiles()` is the only part that
reads the library. A small follow-up adds a `buildProfilesFromCloud()` that lists MIPs
via `teamStore.listMips()` + `pull()` and feeds the same rules, so consistency is checked
across the **whole team's** MIPs, not just this machine. No rule changes.

## Operate it (what you do in Supabase)

1. **Apply the migration.** Commit/push this repo — the GitHub integration runs
   `supabase/migrations/*.sql` against the linked project. (Or run it by hand in the SQL
   editor.) Verify the `org`, `project`, `client`, `member`, `profiles` tables exist.
2. **Allow the dev redirect URL.** Auth → URL Configuration → add `http://localhost:5173`
   (and your production editor URL) to **Redirect URLs**, or the magic link won't return.
3. **Sign in once**, then **promote yourself to admin** so you can test PM controls:
   ```sql
   update public.member set role = 'admin'
   where user_id = (select id from auth.users where email = 'you@example.com');
   ```
4. **Use it:** set Client + MIP on a project (Inspector → Project) → Topbar **Team** →
   *Publish current MIP*. Sign in as a teammate to confirm they see it and can open it but
   not overwrite it. As admin, change status / reassign owner / download.

> Note: new emails auto-join as `designer`. For a closed team, restrict sign-ups in
> Supabase Auth (disable open signup / add an allowlist) once everyone's in.
