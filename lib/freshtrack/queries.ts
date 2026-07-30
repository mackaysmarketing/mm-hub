/**
 * FreshTrack GraphQL queries + return-type interfaces.
 *
 * Hand-typed (no graphql-codegen) — we use <15 queries of 196 root fields
 * and the FT schema is owned upstream. Each query uses GraphQL variables
 * (never string concatenation) so injection is impossible and the wire
 * payload is small + cacheable.
 *
 * The field selections here are the SHAPE OF TRUTH for the FT* TS
 * interfaces — keep them in lock-step.
 */
import "server-only";

// --- Shared scalar types -------------------------------------------------

export type FTUuid = string;
export type FTDateTime = string; // ISO 8601
export type FTDate = string; // YYYY-MM-DD

// --- EntityNode + FarmNode (the production-axis catalogue) --------------

export interface FTFarmNodeMini {
  id: FTUuid;
  supplierId: FTUuid | null;
  regionId: FTUuid | null;
  timeZone: string | null;
  isActive: boolean;
}

export interface FTEntityParent {
  id: FTUuid;
  code: string;
}

export interface FTEntity {
  id: FTUuid;
  code: string;
  type: string;
  orgName: string;
  orgLegalName: string;
  orgContactName: string;
  orgTaxNo: string;
  indFirstName: string;
  indMiddleName: string;
  indLastName: string;
  email: string;
  phoneNo: string;
  mobileNo: string;
  isActive: boolean;
  isGrower: boolean;
  isConsignorActive: boolean;
  isConsigneeActive: boolean;
  isMarketerActive: boolean;
  isFarmActive: boolean;
  parentId: FTUuid | null;
  parent: FTEntityParent | null;
  farmId: FTUuid | null;
  farm: FTFarmNodeMini | null;
  // Role-record ids — let dispatch.consignor/consignee/carrier resolve back
  // to the owning entity (separate id-space from EntityNode.id). See 00014.
  consignorId: FTUuid | null;
  consigneeId: FTUuid | null;
  carrierId: FTUuid | null;
}

export const Q_ENTITIES_FULL = /* GraphQL */ `
  query EntitiesFull($limit: Int!) {
    entities(filterIsActive: true, filterLimit: $limit) {
      id code type
      orgName orgLegalName orgContactName orgTaxNo
      indFirstName indMiddleName indLastName
      email phoneNo mobileNo
      isActive isGrower
      isConsignorActive isConsigneeActive isMarketerActive isFarmActive
      parentId
      parent { id code }
      farmId
      farm { id supplierId regionId timeZone isActive }
      consignorId consigneeId carrierId
    }
  }
`;

export const Q_ENTITIES_INCREMENTAL = /* GraphQL */ `
  query EntitiesIncremental($limit: Int!, $modifiedSince: DateTime!) {
    entities(
      filterIsActive: true
      filterLimit: $limit
      filterLastModifiedOnStart: $modifiedSince
    ) {
      id code type
      orgName orgLegalName orgContactName orgTaxNo
      indFirstName indMiddleName indLastName
      email phoneNo mobileNo
      isActive isGrower
      isConsignorActive isConsigneeActive isMarketerActive isFarmActive
      parentId
      parent { id code }
      farmId
      farm { id supplierId regionId timeZone isActive }
      consignorId consigneeId carrierId
    }
  }
`;

/**
 * Rule-validation variant of the entities query — deliberately WITHOUT
 * filterIsActive:true. Q_ENTITIES_FULL filters on the entity's overall
 * isActive flag, which is a different thing from isConsignorActive; a
 * consignor role could in principle be active while its owning entity's
 * isActive is false (or vice versa isn't relevant here — we only care about
 * the role flag). Rule validation checks specific known ids, so it must not
 * risk hiding one behind an unrelated flag. Verified live 2026-07-30: returns
 * 325 entities unfiltered vs 314 in the (known-stale) Supabase ft_entities
 * mirror, and all 6 seeded consignor role ids resolve with isConsignorActive
 * true.
 */
export const Q_ENTITIES_FOR_RULE_VALIDATION = /* GraphQL */ `
  query EntitiesForRuleValidation($limit: Int!) {
    entities(filterLimit: $limit) {
      id code orgName
      consignorId isConsignorActive
      consigneeId isConsigneeActive
    }
  }
`;

/** Verifies MACKM marketer-role UUID at run start (fails loud if FT renumbers). */
export const Q_ENTITY_BOOTSTRAP_MACKM = /* GraphQL */ `
  query EntityBootstrapMACKM($entityId: UUID!) {
    entity(entityId: $entityId) {
      id code orgName isMarketerActive marketerId
    }
  }
`;

// --- DispatchLoadNode (Mackays-marketed dispatches) ---------------------

export interface FTDispatchLoad {
  id: FTUuid;
  loadNo: string;
  orderType: string;
  scheduledPickupOn: FTDateTime | null;
  actualPickupOn: FTDateTime | null;
  scheduledDeliveryOn: FTDateTime | null;
  actualDeliveryOn: FTDateTime | null;
  packDate: FTDate | null;
  manifestNo: string;
  certificateNo: string;
  dcSlotRef: string;
  orderNo: string;
  salesOrderNo: string;
  poNo: string;
  stockBoxes: number;
  reconsignedBoxes: number;
  rejectedBoxes: number;
  repackedBoxes: number;
  wasteBoxes: number;
  temperatureValue: number | null;
  temperatureUnit: string;
  isComplete: boolean;
  asnSentOn: FTDateTime | null;
  emailSentOn: FTDateTime | null;
  consignorId: FTUuid | null;
  consigneeId: FTUuid | null;
  marketerId: FTUuid | null;
  carrierId: FTUuid | null;
}

export const Q_DISPATCH_LOADS = /* GraphQL */ `
  query DispatchLoads(
    $marketerId: UUID!
    $limit: Int!
    $pickupStart: DateTime
    $pickupEnd: DateTime
  ) {
    dispatchLoads(
      filterMarketerIds: [$marketerId]
      filterLimit: $limit
      filterActualPickupOnStart: $pickupStart
      filterActualPickupOnEnd: $pickupEnd
    ) {
      id loadNo orderType
      scheduledPickupOn actualPickupOn scheduledDeliveryOn actualDeliveryOn
      packDate manifestNo certificateNo dcSlotRef
      orderNo salesOrderNo poNo
      stockBoxes reconsignedBoxes rejectedBoxes repackedBoxes wasteBoxes
      temperatureValue temperatureUnit isComplete
      asnSentOn emailSentOn
      consignorId consigneeId marketerId carrierId
    }
  }
`;

// --- PalletNode (one fan-out per dispatch) ------------------------------

export interface FTPallet {
  id: FTUuid;
  palletNo: string;
  dispatchLoadId: FTUuid | null;
  harvestLoadId: FTUuid | null;
  packedOn: FTDateTime | null;
  loadedOn: FTDateTime | null;
  bestBefore: FTDateTime | null;
  stockBoxes: number;
  reconsignedBoxes: number;
  rejectedBoxes: number;
  repackedBoxes: number;
  wasteBoxes: number;
  netWeightValue: number | null;
  netWeightUnit: string;
  grossWeightValue: number | null;
  grossWeightUnit: string;
  productDescription: string;
  cropDescription: string;
  varietyDescription: string;
  isArchived: boolean;
  productId: FTUuid | null;
  consigneeId: FTUuid | null;
}

export const Q_PALLETS_BY_DISPATCH = /* GraphQL */ `
  query PalletsByDispatch($dispatchLoadId: UUID!, $limit: Int!) {
    pallets(filterDispatchLoadId: $dispatchLoadId, filterLimit: $limit) {
      id palletNo
      packedOn loadedOn bestBefore
      stockBoxes reconsignedBoxes rejectedBoxes repackedBoxes wasteBoxes
      netWeightValue netWeightUnit
      grossWeightValue grossWeightUnit
      productDescription cropDescription varietyDescription
      isArchived
    }
  }
`;

// --- HarvestLoadNode (per-farm production) ------------------------------

export interface FTHarvestLoad {
  id: FTUuid;
  docketNo: string;
  plantingDescription: string;
  harvestedOn: FTDateTime;
  receivedOn: FTDateTime | null;
  isPurchased: boolean;
  isBlended: boolean;
  isArchived: boolean;
  shedId: FTUuid;
  stateId: FTUuid | null;
  stateName: string | null;
  farmId: FTUuid | null;
  farmName: string | null;
  supplierId: FTUuid | null;
  supplierName: string | null;
  blockId: FTUuid | null;
  blockName: string | null;
  cropId: FTUuid | null;
  cropName: string | null;
  varietyId: FTUuid | null;
  varietyName: string | null;
  subvarietyId: FTUuid | null;
  subvarietyName: string | null;
  amountTotalPurchasedValue: number | null;
  amountTotalPurchasedCurrency: string;
  grossWeightPurchasedValue: number | null;
  grossWeightPurchasedUnit: string;
}

export const Q_HARVEST_LOADS_BY_FARM = /* GraphQL */ `
  query HarvestLoadsByFarm(
    $farmId: UUID!
    $limit: Int!
    $harvestedStart: DateTime
    $harvestedEnd: DateTime
  ) {
    harvestLoads(
      filterFarmId: $farmId
      filterLimit: $limit
      filterHarvestedOnStart: $harvestedStart
      filterHarvestedOnEnd: $harvestedEnd
    ) {
      id docketNo plantingDescription
      harvestedOn receivedOn
      isPurchased isBlended isArchived
      shedId
      stateId stateName
      farmId farmName
      supplierId supplierName
      blockId blockName
      cropId cropName
      varietyId varietyName
      subvarietyId subvarietyName
      amountTotalPurchasedValue amountTotalPurchasedCurrency
      grossWeightPurchasedValue grossWeightPurchasedUnit
    }
  }
`;

// --- ChargeAppliedNode (the ONE node with lastModifiedOn on the row) ----

export interface FTChargeApplied {
  id: FTUuid;
  chargeId: FTUuid | null;
  dispatchLoadId: FTUuid | null;
  palletId: FTUuid | null;
  boxId: FTUuid | null;
  orderId: FTUuid | null;
  harvestLoadId: FTUuid | null;
  productId: FTUuid | null;
  supplierId: FTUuid | null;
  marketerId: FTUuid | null;
  text1: string;
  text2: string;
  text3: string;
  accountCode: string;
  reference: string;
  quantityValue: number | null;
  quantityUnit: string;
  amountValue: number | null;
  amountCurrency: string;
  totalAmountValue: number | null;
  totalAmountCurrency: string;
  appliedOn: FTDateTime | null;
  isDeductible: boolean;
  isActive: boolean;
  createdOn: FTDateTime | null;
  lastModifiedOn: FTDateTime | null;
}

export const Q_CHARGES_APPLIED_WINDOW = /* GraphQL */ `
  query ChargesAppliedWindow(
    $limit: Int!
    $appliedStart: DateTime
    $appliedEnd: DateTime
  ) {
    chargesApplied(
      filterLimit: $limit
      filterAppliedOnStart: $appliedStart
      filterAppliedOnEnd: $appliedEnd
    ) {
      id
      text1 text2 text3
      accountCode reference
      quantityValue quantityUnit
      amountValue amountCurrency
      totalAmountValue totalAmountCurrency
      appliedOn isDeductible isActive
      createdOn lastModifiedOn
    }
  }
`;

// --- ProductNode + CropNode (the crop catalogue) ------------------------
// Needed by the consignor auto-assignment process: a rule may be crop-specific
// (Coles Eastern Creek splits Papaya vs Passionfruit), and crop is only
// reachable as orderItem.productId → product.cropId. Both queries take no
// filter args and the tables are tiny (251 products, 7 crops), so orderSync
// pulls them whole and caches per run.

export interface FTCrop {
  id: FTUuid;
  code: string;
  name: string;
}

export interface FTProductMini {
  id: FTUuid;
  code: string;
  name: string;
  cropId: FTUuid | null;
}

export const Q_CROPS = /* GraphQL */ `
  query Crops($limit: Int!) {
    crops(filterLimit: $limit) {
      id code name
    }
  }
`;

/** NOTE: `products` accepts NO arguments — it always returns the full set. */
export const Q_PRODUCTS_ALL = /* GraphQL */ `
  query ProductsAll {
    products {
      id code name cropId
    }
  }
`;

// --- OrderStateNode (stable codes; drives the cancellation guard) --------
// Codes are stable strings — prefer them over UUIDs in config. Observed set:
// OR Ordered, SH Shipped, RI Ready to Invoice, IN Invoiced, RE Remitted,
// PD Paid, CL Closed, CA Cancelled, FI Filled, SY Synched, Default,
// FORD Farm Order, WLMO WWG- Load Moved.

export interface FTOrderState {
  id: FTUuid;
  code: string;
  name: string;
  sequence: number;
  isActive: boolean;
}

export const Q_ORDER_STATES = /* GraphQL */ `
  query OrderStates {
    orderStates {
      id code name sequence isActive
    }
  }
`;

// --- OrderNode ----------------------------------------------------------
// IMPORTANT: `orders` exposes NO filterLastModifiedOnStart — verified against
// live FT 2026-07-30, which rejects it with
// "Unknown argument 'filterLastModifiedOnStart' on field 'Query.orders'".
// (The cursor.ts header comment lists OrderNode among nodes that accept it —
// that comment is wrong.) OrderNode also has no modifiedOn field, and
// latestVersionNo was 1 on every order observed. So orders CANNOT use the
// watermark pattern: orderSync sweeps a scheduledDeliveryOn date window via
// ftPagedDateWindow and relies on upsert idempotency.

export interface FTOrder {
  id: FTUuid;
  priority: number | null;
  type: string;
  orderNo: string;
  salesOrderNo: string;
  poNo: string;
  comment: string;
  info: string;
  scheduledPickupOn: FTDateTime | null;
  actualPickupOn: FTDateTime | null;
  scheduledDeliveryOn: FTDateTime | null;
  actualDeliveryOn: FTDateTime | null;
  isEdi: boolean;
  ediStatus: string | null;
  totalOrdered: number | null;
  isArchived: boolean;
  stateId: FTUuid;
  consignorId: FTUuid | null;
  consigneeId: FTUuid | null;
  parentConsigneeId: FTUuid | null;
  marketAreaId: FTUuid | null;
  marketerId: FTUuid | null;
  supplierId: FTUuid | null;
  deliveryContactId: FTUuid | null;
  shedId: FTUuid | null;
  saleEntityId: FTUuid | null;
  latestVersionNo: number | null;
}

/**
 * Window on scheduledDeliveryOn (NOT actualPickupOn as dispatchSync does):
 * actual* fields are null for every not-yet-shipped order, so an actual-based
 * window would miss exactly the forward-dated orders the consignor process
 * exists to act on.
 */
export const Q_ORDERS_BY_DELIVERY_WINDOW = /* GraphQL */ `
  query OrdersByDeliveryWindow(
    $limit: Int!
    $deliveryStart: DateTime
    $deliveryEnd: DateTime
  ) {
    orders(
      filterLimit: $limit
      filterScheduledDeliveryOnStart: $deliveryStart
      filterScheduledDeliveryOnEnd: $deliveryEnd
      filterArchived: false
    ) {
      id priority type
      orderNo salesOrderNo poNo
      comment info
      scheduledPickupOn actualPickupOn scheduledDeliveryOn actualDeliveryOn
      isEdi ediStatus
      totalOrdered isArchived
      stateId
      consignorId consigneeId parentConsigneeId
      marketAreaId marketerId supplierId
      deliveryContactId shedId saleEntityId
      latestVersionNo
    }
  }
`;

/**
 * updateOrder is a FULL-OBJECT REPLACE — OrderInput has six NON_NULL fields
 * (type, stateId, orderNo, poNo, salesOrderNo, comment) and there is no
 * updatePartialOrder. Any omitted optional field gets nulled. This interface
 * lists every OrderInput field so a caller building the payload from a fresh
 * FTOrder fetch can't accidentally drop one. Verified end-to-end live
 * 2026-07-30 on real order 5024318 — see lib/processes/consignorAssign/apply.ts.
 */
export interface FTOrderInput {
  priority: number | null;
  type: string;
  stateId: FTUuid;
  orderNo: string;
  poNo: string;
  salesOrderNo: string;
  consignorId: FTUuid | null;
  consigneeId: FTUuid | null;
  marketAreaId: FTUuid | null;
  marketerId: FTUuid | null;
  supplierId: FTUuid | null;
  deliveryContactId: FTUuid | null;
  shedId: FTUuid | null;
  saleEntityId: FTUuid | null;
  scheduledPickupOn: FTDateTime | null;
  actualPickupOn: FTDateTime | null;
  scheduledDeliveryOn: FTDateTime | null;
  actualDeliveryOn: FTDateTime | null;
  comment: string;
}

/**
 * Build a full OrderInput from a live FTOrder fetch, overriding only
 * consignorId. Accepts null so the same helper serves both assignment and
 * the "Unassign" action in the activity log.
 */
export function orderToInputWithConsignor(
  o: FTOrder,
  consignorId: string | null
): FTOrderInput {
  return {
    priority: o.priority,
    type: o.type,
    stateId: o.stateId,
    orderNo: o.orderNo,
    poNo: o.poNo,
    salesOrderNo: o.salesOrderNo,
    consignorId,
    consigneeId: o.consigneeId,
    marketAreaId: o.marketAreaId,
    marketerId: o.marketerId,
    supplierId: o.supplierId,
    deliveryContactId: o.deliveryContactId,
    shedId: o.shedId,
    saleEntityId: o.saleEntityId,
    scheduledPickupOn: o.scheduledPickupOn,
    actualPickupOn: o.actualPickupOn,
    scheduledDeliveryOn: o.scheduledDeliveryOn,
    actualDeliveryOn: o.actualDeliveryOn,
    comment: o.comment,
  };
}

export const Q_UPDATE_ORDER_CONSIGNOR = /* GraphQL */ `
  mutation UpdateOrderConsignor($orderId: UUID!, $orderData: OrderInput!) {
    updateOrder(orderId: $orderId, orderData: $orderData) {
      order {
        id priority type orderNo salesOrderNo poNo comment info
        scheduledPickupOn actualPickupOn scheduledDeliveryOn actualDeliveryOn
        isEdi ediStatus totalOrdered isArchived stateId
        consignorId consigneeId parentConsigneeId marketAreaId marketerId supplierId
        deliveryContactId shedId saleEntityId latestVersionNo
      }
    }
  }
`;

export interface RspUpdateOrder {
  updateOrder: { order: FTOrder };
}

/**
 * Consignor-auto-assign discovery: scoped by consignee (only customers with an
 * active rule) rather than a bare date window, so a small handful of GraphQL
 * results covers exactly the candidates that matter. Verified live 2026-07-30
 * — correctly surfaces both null-consignor candidates and already-assigned
 * orders side by side (the latter get excluded client-side, not by a
 * consignorId filter, since FreshTrack has no such filter argument).
 */
export const Q_ORDERS_BY_CONSIGNEES = /* GraphQL */ `
  query OrdersByConsigneesForAssignment(
    $consigneeIds: [UUID!]
    $limit: Int!
    $deliveryStart: DateTime
    $deliveryEnd: DateTime
  ) {
    orders(
      filterConsigneeIds: $consigneeIds
      filterLimit: $limit
      filterScheduledDeliveryOnStart: $deliveryStart
      filterScheduledDeliveryOnEnd: $deliveryEnd
      filterArchived: false
    ) {
      id orderNo consignorId consigneeId stateId isArchived
      actualPickupOn actualDeliveryOn scheduledDeliveryOn
    }
  }
`;

export interface FTOrderCandidate {
  id: FTUuid;
  orderNo: string;
  consignorId: FTUuid | null;
  consigneeId: FTUuid | null;
  stateId: FTUuid;
  isArchived: boolean;
  actualPickupOn: FTDateTime | null;
  actualDeliveryOn: FTDateTime | null;
  scheduledDeliveryOn: FTDateTime | null;
}

/**
 * Live re-fetch of ONE order by id, used immediately before an apply-mode
 * write (both to build the full OrderInput and to re-check consignorId is
 * still null — the entire race-safety mechanism, design doc §6.2 step 5).
 * Verified live 2026-07-30 against real order 5024318.
 */
export const Q_ORDER_BY_ID = /* GraphQL */ `
  query OrderById($orderIds: [UUID!]) {
    orders(filterOrderIds: $orderIds, filterLimit: 1) {
      id priority type
      orderNo salesOrderNo poNo
      comment info
      scheduledPickupOn actualPickupOn scheduledDeliveryOn actualDeliveryOn
      isEdi ediStatus
      totalOrdered isArchived
      stateId
      consignorId consigneeId parentConsigneeId
      marketAreaId marketerId supplierId
      deliveryContactId shedId saleEntityId
      latestVersionNo
    }
  }
`;

// --- OrderVersionNode ---------------------------------------------------
// One call per order; there is no bulk "versions for many orders" query.
// NOTE: OrderVersionNode has NO `isLatest` field — pick the max versionNo.

export interface FTOrderVersion {
  id: FTUuid;
  versionNo: number;
}

export const Q_ORDER_VERSIONS_BY_ORDER = /* GraphQL */ `
  query OrderVersionsByOrder($orderId: UUID!) {
    orderVersions(filterOrderId: $orderId) {
      id versionNo
    }
  }
`;

// --- OrderItemNode (per-version order detail) ---------------------------

export interface FTOrderItem {
  id: FTUuid;
  orderVersionId: FTUuid;
  productId: FTUuid | null;
  shedId: FTUuid | null;
  dispatchLoadId: FTUuid | null;
  palletCount: number | null;
  boxesPerPallet: number | null;
  handStack: number | null;
  isSplit: boolean | null;
  ti: number | null;
  unsplitHi: number | null;
  bottomHi: number | null;
  topHi: number | null;
  priceValue: number | null;
  priceCurrency: string;
  pricePer: string;
  remittedPriceValue: number | null;
  remittedPriceCurrency: string;
  proposedQuantity: number | null;
  proposedPriceValue: number | null;
  proposedPriceCurrency: string;
  discountValue: number | null;
  discountCurrency: string;
  discountPercentage: number | null;
  itemNo: string;
  ean13: string | null;
  ean14: string | null;
  lineNo: number | null;
}

/**
 * FIXED 2026-07-30: previously selected neither `productId` nor `shedId`,
 * `dispatchLoadId` nor `orderVersionId`, despite FTOrderItem declaring all
 * four — a lock-step violation against this file's own header rule. `productId`
 * is load-bearing: it is the ONLY route from an order to its crop, which the
 * crop-specific consignor rules depend on. Selection now matches the interface
 * and the ft_order_items columns.
 */
export const Q_ORDER_ITEMS_BY_ORDER_VERSION = /* GraphQL */ `
  query OrderItemsByOrderVersion($orderVersionId: UUID!) {
    orderItems(filterOrderVersionId: $orderVersionId) {
      id
      orderVersionId
      productId shedId dispatchLoadId
      palletCount boxesPerPallet handStack isSplit
      ti unsplitHi bottomHi topHi
      priceValue priceCurrency pricePer
      remittedPriceValue remittedPriceCurrency
      proposedQuantity proposedPriceValue proposedPriceCurrency
      discountValue discountCurrency discountPercentage
      itemNo ean13 ean14 lineNo
    }
  }
`;

// --- Convenience: query response wrapper types ---------------------------

export interface RspEntities {
  entities: FTEntity[];
}
export interface RspEntityById {
  entity: FTEntity;
}
export interface RspDispatchLoads {
  dispatchLoads: FTDispatchLoad[];
}
export interface RspPallets {
  pallets: FTPallet[];
}
export interface RspHarvestLoads {
  harvestLoads: FTHarvestLoad[];
}
export interface RspChargesApplied {
  chargesApplied: FTChargeApplied[];
}
export interface RspCrops {
  crops: FTCrop[];
}
export interface RspProducts {
  products: FTProductMini[];
}
export interface RspOrderStates {
  orderStates: FTOrderState[];
}
export interface RspOrders {
  orders: FTOrder[];
}
export interface RspOrderCandidates {
  orders: FTOrderCandidate[];
}
export interface RspOrderById {
  orders: FTOrder[];
}
export interface RspOrderVersions {
  orderVersions: FTOrderVersion[];
}
export interface RspOrderItems {
  orderItems: FTOrderItem[];
}
