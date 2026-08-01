-- =============================================================================
-- Migration 00019 — Run report process for Auto FT Consignor Update
-- =============================================================================
-- Adds the second row to process_definitions: consignor_auto_assign_report.
-- Reuses the SAME generic process_runs substrate from 00017 — this process
-- just never writes a process_actions row, since it has no per-candidate
-- work, only one outbound email per run (see lib/processes/runReport/index.ts).
-- The email itself covers rule health, orders needing a decision, failed
-- writes, and successful/proposed consignor assignments since the last
-- report — see lib/processes/runReport/emailTemplate.ts.
--
-- SAFE-BY-DEFAULT: seeded DISABLED, same as consignor_auto_assign was in
-- 00017. It also cannot functionally send anything yet regardless of the
-- 'enabled' flag, since RESEND_API_KEY / RESEND_FROM_EMAIL do not yet exist
-- in Vercel — see lib/resend.ts. An admin must add both, then enable this
-- process via the Tools UI, before any email actually goes out.
--
-- `mode` is part of the generic process_definitions shape (NOT NULL, checked
-- in ('dry_run','apply')) but has no meaning for a report process — it
-- neither proposes nor applies anything to FreshTrack. Seeded here as an
-- inert 'dry_run' placeholder; lib/processes/runReport/index.ts never reads
-- process_definitions.mode.
-- =============================================================================

begin;

insert into public.process_definitions (key, name, description, enabled, mode, config)
values (
  'consignor_auto_assign_report',
  'Auto FT Consignor Update — run report',
  'Emails a summary of Auto FT Consignor Update activity: rule health, '
  'orders needing a decision, failed writes, and successful/proposed '
  'consignor assignments since the last report.',
  false,      -- disabled until an admin turns it on via the Tools UI, and
              -- until RESEND_API_KEY/RESEND_FROM_EMAIL exist in Vercel
  'dry_run',  -- inert placeholder — see header note, not read by this process
  '{
     "recipient_email": "tim@mackaysmarketing.com.au",
     "schedule": {"frequency": "daily", "at_hour_brisbane": 7}
   }'::jsonb
)
on conflict (key) do nothing;

commit;

-- =============================================================================
-- Verification (service_role / postgres, after apply):
--
--   select key, enabled, mode, config from process_definitions
--     where key = 'consignor_auto_assign_report';
--   -- expect: enabled=false, mode=dry_run,
--   -- config.recipient_email = 'tim@mackaysmarketing.com.au',
--   -- config.schedule = {"frequency":"daily","at_hour_brisbane":7}
-- =============================================================================
