-- Share links — hand an editable copy of a MIP to another user via a short code /
-- link. Decoupled from the team `project` rows: the bundle (ProjectData JSON with
-- asset bytes inline) lives in a private `shares` Storage bucket at '<code>.json',
-- and the code IS the object path. Any signed-in user can create a share and open
-- one by code (no org/ownership gymnastics — sharing is peer-to-peer within the
-- signed-in team). Applied automatically by the Supabase GitHub integration.

insert into storage.buckets (id, name, public)
  values ('shares','shares', false)
  on conflict (id) do nothing;

-- read + write: any authenticated user (the code is the only thing you need to open
-- a share, so keep it to signed-in users; codes are unguessable random strings).
drop policy if exists shares_read on storage.objects;
create policy shares_read on storage.objects for select to authenticated
  using (bucket_id = 'shares');

drop policy if exists shares_insert on storage.objects;
create policy shares_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'shares');

drop policy if exists shares_update on storage.objects;
create policy shares_update on storage.objects for update to authenticated
  using (bucket_id = 'shares');
