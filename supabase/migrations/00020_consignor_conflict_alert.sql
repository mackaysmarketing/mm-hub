-- =============================================================================
-- Migration 00020 — Conflict alert switch for Auto FT Consignor Update
-- =============================================================================
-- Adds config.alert_on_conflicts to the report definition. The per-run
-- conflict alert (lib/processes/consignorAssign/conflictAlert.ts) fires at the
-- end of every assign run when an order is found that the mapping rules cannot
-- resolve — ambiguous_multi_crop or no_rule_matched — and only for orders it
-- has not already alerted on.
--
-- The switch and the recipient list both live on the REPORT definition rather
-- than the assign one, because the "Email reports" tab owns every outbound
-- email this tool sends. It is deliberately independent of that row's own
-- `enabled` flag: turning the routine summary off must not silently turn the
-- exception alerts off too.
--
-- Seeded TRUE, unlike 00017/00019 which seeded their processes disabled. This
-- is not a new thing that acts on FreshTrack — it sends mail about work the
-- tool already declined to do, and the failure mode of it being off (a
-- conflicted order sits unnoticed until the next summary) is worse than the
-- failure mode of it being on. The code also treats an absent key as ON for
-- the same reason, so this migration only makes the default explicit and
-- gives the admin UI something to bind to.
-- =============================================================================

begin;

update public.process_definitions
set config = config || '{"alert_on_conflicts": true}'::jsonb,
    updated_at = now()
where key = 'consignor_auto_assign_report'
  and not (config ? 'alert_on_conflicts');

commit;

-- =============================================================================
-- Verification (service_role / postgres, after apply):
--
--   select key, config->'alert_on_conflicts' as alert_on_conflicts
--   from process_definitions where key = 'consignor_auto_assign_report';
--   -- expect: true
--
-- To switch alerts off without touching the summary report:
--   update process_definitions
--   set config = config || '{"alert_on_conflicts": false}'::jsonb
--   where key = 'consignor_auto_assign_report';
-- =============================================================================
