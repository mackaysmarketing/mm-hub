-- =============================================================================
-- MM-Hub Migration 00006 — RCTI Documents (on-demand PDF access)
-- =============================================================================
-- Interim approach: PDFs are uploaded by hub admins and attached to an RCTI
-- recipient (the financial axis from 00005). Growers see the RCTIs for their
-- group's recipient(s) on /remittances and download via short-lived signed URLs.
--
-- Replaces the planned parse/consolidate/import pipeline (rcti_imports), which
-- is deferred until the NetSuite raw-data export is available — the sample CSV
-- was empty, so we ship document access now and add reconciliation later
-- without changing the grower-facing surface.
--
-- Storage: PDFs live in the existing 'documents' Supabase Storage bucket under
-- the prefix rcti/<recipient_id>/<id>.pdf (so a single bucket policy covers
-- both general documents and RCTIs).
-- =============================================================================

begin;

create table if not exists public.rcti_documents (
  id uuid primary key default gen_random_uuid(),

  -- linkage (FINANCIAL axis — RCTIs hang off recipients, not farms)
  recipient_id uuid not null references public.rcti_recipients(id) on delete cascade,
  grower_group_id uuid not null references public.grower_groups(id), -- denormalized for RLS

  -- file
  filename text not null,
  storage_path text not null,                 -- e.g. rcti/<recipient_id>/<id>.pdf
  file_size integer,
  mime_type text default 'application/pdf',

  -- metadata (entered or extracted at upload — keep all optional for now)
  rcti_ref text,                              -- e.g. "2620-LMBCO"
  payment_date date,
  total_invoiced numeric(12,2),               -- summary amount, optional
  notes text,

  uploaded_by uuid references public.hub_users(id),
  uploaded_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_rcti_documents_recipient on public.rcti_documents(recipient_id);
create index if not exists idx_rcti_documents_group on public.rcti_documents(grower_group_id);
create index if not exists idx_rcti_documents_payment_date on public.rcti_documents(payment_date desc);

alter table public.rcti_documents enable row level security;
grant select on public.rcti_documents to authenticated;
grant all on public.rcti_documents to service_role;

-- SELECT: internal sees all; grower-side scopes by recipient axis (same boundary
-- as the remittances RLS in 00005).
drop policy if exists "portal read rcti_documents" on public.rcti_documents;
create policy "portal read rcti_documents" on public.rcti_documents
  for select to authenticated
  using (public.portal_is_internal() or public.portal_can_see_recipient(recipient_id));

commit;
