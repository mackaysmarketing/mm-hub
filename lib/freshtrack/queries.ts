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

// --- OrderItemNode (per-version order detail) ---------------------------

export interface FTOrderItem {
  id: FTUuid;
  productId: FTUuid | null;
  shedId: FTUuid | null;
  dispatchLoadId: FTUuid | null;
  palletCount: number | null;
  boxesPerPallet: number | null;
  priceValue: number | null;
  priceCurrency: string;
  pricePer: string;
  remittedPriceValue: number | null;
  remittedPriceCurrency: string;
  proposedQuantity: number | null;
  itemNo: string;
  lineNo: number | null;
}

export const Q_ORDER_ITEMS_BY_ORDER_VERSION = /* GraphQL */ `
  query OrderItemsByOrderVersion($orderVersionId: UUID!) {
    orderItems(filterOrderVersionId: $orderVersionId) {
      id
      palletCount boxesPerPallet
      priceValue priceCurrency pricePer
      remittedPriceValue remittedPriceCurrency
      proposedQuantity
      itemNo lineNo
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
export interface RspOrderItems {
  orderItems: FTOrderItem[];
}
