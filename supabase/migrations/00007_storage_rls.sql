-- =============================================================================
-- MM-Hub Migration 00007 — Storage Object RLS (`documents` bucket)
-- =============================================================================
-- Currently `storage.objects` has NO per-row policies — only the service-role
-- admin client can read/write storage. The signed-URL flow on /api/documents/
-- [id]/download was therefore broken for non-admin users (the user client
-- silently fails to sign), and we were working around it by routing RCTI
-- downloads through the admin client.
--
-- Add policies that scope object access by path prefix matching the table-RLS
-- view of the row that owns it:
--   * rcti/<recipient_id>/...     -> portal_can_see_recipient
--   * <farm_id>/<category>/...    -> portal_can_see_farm   (general documents)
-- service_role keeps full bypass via the existing policy slot.
-- =============================================================================

begin;

-- Allow SELECT on objects in the `documents` bucket only when the path's owning
-- entity (recipient or farm) is visible to the caller's grower-portal scope.
drop policy if exists "documents bucket scoped read" on storage.objects;
create policy "documents bucket scoped read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (
      -- Internal Mackays users see everything in the bucket.
      public.portal_is_internal()
      -- RCTI PDFs: rcti/<recipient_uuid>/<filename>
      or (
        split_part(name, '/', 1) = 'rcti'
        and public.portal_can_see_recipient(
          nullif(split_part(name, '/', 2), '')::uuid
        )
      )
      -- General documents: <farm_uuid>/<category>/<filename>
      or (
        split_part(name, '/', 1) <> 'rcti'
        and public.portal_can_see_farm(
          nullif(split_part(name, '/', 1), '')::uuid
        )
      )
    )
  );

-- Writes still flow only through the service-role admin client — no INSERT/
-- UPDATE/DELETE policies for authenticated. Hub-admin and grower_admin upload
-- endpoints use createAdminClient(), which bypasses RLS.

commit;
