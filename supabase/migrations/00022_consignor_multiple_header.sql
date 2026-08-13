-- =============================================================================
-- Migration 00022 — MULTIPLE consignor header (Stage A)
-- =============================================================================
-- An order whose crops resolve to MORE THAN ONE consignor used to be skipped as
-- `ambiguous_multi_crop` and left for a human. It now takes a header consignor
-- of MULTIPLE, which is a true statement about the order, and stops a wrong
-- single consignor propagating to the loads that inherit from it.
--
-- Stage B — setting the per-crop consignor on each LOAD — is NOT built. Loads
-- still need splitting by hand. Confirmed against the live API before building:
--
--   * dispatchLoads(filterOrderId:) and DispatchLoadNode.consignorId exist, and
--     bulkUpdateDispatchLoads({stateId, consignorId, carrierId}) can write it,
--     so Stage B is possible whenever it is wanted.
--   * BUT orderItems.dispatchLoadId is null on every line of every order
--     sampled across all six live states (0 of 48) — the line->load link this
--     tenant would need simply is not used. Crop-per-load is only knowable from
--     PALLETS, which exist only after packing. Of 25 packed loads sampled, all
--     25 carried exactly one crop, so the signal is clean once it exists — just
--     late.
--
-- WHY THIS IS SAFE TO TURN ON. Sampled all 10 blank-consignor orders in a
-- 400-order window: 9 had all-blank load consignors, and the one exception was
-- a CANCELLED order, a state assignable_state_codes already excludes. So a
-- blank order consignor implies blank load consignors for everything this
-- process acts on, and setting the header never overwrites a load value.
--
-- consignorId here is the MULTIPLE entity's CONSIGNOR ROLE id, not its entity
-- id. The two differ and mixing them up is silent: the write succeeds and the
-- order points at nothing usable. Verified live 2026-08-13 —
--   entity  MULTI "MULTIPLE"  id 019ff95b-e75a-3a8b-7ec6-45cb77193190
--   consignor role id         019ff95b-e763-b796-2f35-26c24b5ea7a2
-- the same shape the seeded rules already use (APPEC entity
-- 01957e98-... vs consignor role 019588ed-...).
-- =============================================================================

begin;

update public.process_definitions
set config = config || jsonb_build_object(
      'multiple_consignor_ft_id', '019ff95b-e763-b796-2f35-26c24b5ea7a2'
    ),
    updated_at = now()
where key = 'consignor_auto_assign'
  and not (config ? 'multiple_consignor_ft_id');

commit;

-- =============================================================================
-- Verification (service_role / postgres, after apply):
--
--   select config->>'multiple_consignor_ft_id'
--   from process_definitions where key = 'consignor_auto_assign';
--   -- expect: 019ff95b-e763-b796-2f35-26c24b5ea7a2
--
-- TO TURN STAGE A OFF without touching code — the process falls straight back
-- to the previous behaviour, skipping such orders as `multiple_not_configured`
-- for a human, because the runner treats an absent key as "not configured":
--
--   update process_definitions
--   set config = config - 'multiple_consignor_ft_id'
--   where key = 'consignor_auto_assign';
--
-- To find orders that took the MULTIPLE header and therefore still need their
-- LOADS split by hand:
--
--   select target_ref, consignee_name, after->>'consignor_codes' as codes, created_at
--   from process_actions
--   where process_key = 'consignor_auto_assign'
--     and status = 'applied'
--     and after->>'reason' = 'multiple'
--   order by created_at desc;
-- =============================================================================
