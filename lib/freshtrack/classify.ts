/**
 * Classify a FreshTrack EntityNode into one of the MM-Hub provisioning
 * categories. TS mirror of `private.ft_classify_entity` (kept in sync —
 * if you change one, change the other).
 *
 * Categories drive the catalogue UI: the super admin picks an entity
 * classified as `farm` or `self_paid_farm` from the FreshTrack catalogue
 * to attach to a customer-facing grower_group.
 */
import type { FTEntity } from "./queries";

export type FtEntityClassification =
  | "skip"
  | "rcti_recipient"
  | "farm"
  | "self_paid_farm"
  | "orphan_farm";

export interface FtEntityClassifyContext {
  /** Whether this entity is a parent of any other grower entity in the same sync window. */
  hasChildren: boolean;
}

/**
 * Decide what role an EntityNode plays in our model.
 *
 *   - skip            → not a grower; ignore (consignees, marketers, carriers).
 *   - rcti_recipient  → grower entity that has children. Acts as the payee
 *                       grouping (e.g. LMBFA "LMB" parents LMBCO/LMBEP/LMBBF).
 *   - farm            → grower entity with a parent. Production-axis leaf.
 *   - self_paid_farm  → grower entity with NO parent, NO children, but acting
 *                       as its own consignor (e.g. SHPER). Maps to BOTH a
 *                       farm row AND its own rcti_recipient row.
 *   - orphan_farm     → grower entity with no parent + no children + not a
 *                       consignor. Surfaces in the catalogue with a warning;
 *                       provisioning requires manual recipient assignment.
 */
export function classifyEntity(
  e: FTEntity,
  ctx: FtEntityClassifyContext
): FtEntityClassification {
  if (!e.isGrower) return "skip";
  if (ctx.hasChildren) return "rcti_recipient";
  if (e.parentId !== null) return "farm";
  if (e.isConsignorActive) return "self_paid_farm";
  return "orphan_farm";
}

/**
 * Build the children-map for a batch of entities so `hasChildren` is O(1)
 * per row. Uses parentId on the entity, not the parent { } object.
 */
export function buildChildrenMap(entities: readonly FTEntity[]): Set<string> {
  const parentsWithChild = new Set<string>();
  for (const e of entities) {
    if (e.parentId) parentsWithChild.add(e.parentId);
  }
  return parentsWithChild;
}

/** Convenience: classify a whole batch in one pass. */
export function classifyBatch(
  entities: readonly FTEntity[]
): Array<{ entity: FTEntity; classification: FtEntityClassification }> {
  const parents = buildChildrenMap(entities);
  return entities.map((entity) => ({
    entity,
    classification: classifyEntity(entity, {
      hasChildren: parents.has(entity.id),
    }),
  }));
}
