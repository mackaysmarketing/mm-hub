-- =============================================================
-- MM-Hub Migration 00003 — NetSuite Sync Config Seed
-- =============================================================
--
-- ⚠️  IMPORTANT: The field mappings below are BEST GUESSES based on
--     standard NetSuite vendorBill record fields. The actual NetSuite
--     field names, RCTI record type, and sublist structure MUST be
--     verified by the Mackays finance team and a test API call against
--     the NetSuite sandbox. An admin can update these mappings via the
--     Sync Config UI — no code deploy needed.
-- =============================================================

-- Step 1: RCTI / Vendor Bill sync → remittances
-- ⚠️ BEST GUESS: record type may be vendorBill, vendorCredit, or a custom record
-- ⚠️ BEST GUESS: field names (internalId, tranId, tranDate, total, entity) are
--    standard NetSuite fields but may differ in Mackays' configuration
INSERT INTO public.sync_config (
  sync_source, step_order, source_view, target_table, description,
  field_mapping, transform_rules, dedup_column, grower_resolve_field
)
VALUES (
  'netsuite',
  1,
  'vendorBill',
  'remittances',
  'Sync RCTI/vendor bill records from NetSuite into remittances + line items + charges',
  '{"internalId": "netsuite_id", "tranId": "rcti_ref", "tranDate": "payment_date", "total": "total_gross"}'::jsonb,
  '{}'::jsonb,
  'netsuite_id',
  'entity'
);
