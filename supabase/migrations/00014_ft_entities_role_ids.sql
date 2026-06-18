-- =============================================================================
-- Migration 00014 — Capture entity role-record ids (consignor/consignee/carrier)
-- =============================================================================
-- FreshTrack's DispatchLoadNode references its parties by *role-record* id
-- (consignorId, consigneeId, carrierId) — NOT by EntityNode.id. Those role ids
-- live in a separate id-space, so dispatch.consignor_ft_id matches nothing in
-- ft_entities.freshtrack_id (verified: 0/19 consignors matched).
--
-- EntityNode DOES expose consignorId / consigneeId / carrierId (each entity's
-- own role-record ids). Capturing them here lets us resolve a dispatch's
-- consignor/consignee/carrier back to the owning entity (and thence to a
-- provisioned farm for grower scoping, and to a display name).
--
-- Additive only; re-runnable.
-- =============================================================================

begin;

alter table public.ft_entities
  add column if not exists consignor_freshtrack_id uuid,
  add column if not exists consignee_freshtrack_id uuid,
  add column if not exists carrier_freshtrack_id   uuid;

create index if not exists idx_ft_entities_consignor
  on public.ft_entities (consignor_freshtrack_id)
  where consignor_freshtrack_id is not null;
create index if not exists idx_ft_entities_consignee
  on public.ft_entities (consignee_freshtrack_id)
  where consignee_freshtrack_id is not null;
create index if not exists idx_ft_entities_carrier
  on public.ft_entities (carrier_freshtrack_id)
  where carrier_freshtrack_id is not null;

commit;
