-- Loginless share links. The share-by-code flow no longer requires sign-in, so the
-- `shares` Storage bucket must accept the anonymous role (the public anon key) for
-- read + create. A share code is an unguessable random string, so reads stay
-- private-by-obscurity. Applied automatically by the Supabase GitHub integration.
--
-- SECURITY TRADEOFF: allowing `anon` INSERT means anyone holding the public anon key
-- can upload to this bucket. That is the cost of frictionless, accountless sharing.
-- If abuse appears, revisit with: per-object size limits, an Edge Function that
-- gates/rate-limits creation, and/or a TTL cleanup job that expires old shares.

drop policy if exists shares_read on storage.objects;
create policy shares_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'shares');

drop policy if exists shares_insert on storage.objects;
create policy shares_insert on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'shares');

drop policy if exists shares_update on storage.objects;
create policy shares_update on storage.objects for update to anon, authenticated
  using (bucket_id = 'shares');
