# FreshTrack GraphQL API — Discovery Notes

_Captured 2026-06-06 by probing `https://mackaysmarketing.freshtrack.com/api/graphql`._
_All findings below were obtained via **unauthenticated** schema introspection._

## Headline

The FreshTrack GraphQL API is a **dramatically richer surface than the
`v_power_bi_*` RDS view-sync** the original plan assumed. 196 root queries,
typed and filterable, covering every entity the dashboard needs.

**Recommendation:** retire the `v_power_bi_*` direct-RDS sync as the primary
integration path; replace with GraphQL-driven sync. Keep the `pg` direct
connection available only as an optional fallback (and now we can mint creds
on demand — see `readonlyDatabaseCredentials` below).

## Auth flow (from the guide)

```graphql
mutation {
  authenticateWithCredentials(authData: {
    email: "<user>",
    credentials: "<password>"
  }) {
    authToken { token }
  }
}
```

Returns `AuthTokenNode { token, deviceName, expiresOn, createdOn }`.

Subsequent requests: `Authorization: Bearer <token>`. Token has expiry
(`expiresOn`); re-authenticate when expired (no refresh mutation surfaced in
the auth-related list).

**Mint DB credentials programmatically** with an authenticated request:
```graphql
{ readonlyDatabaseCredentials { host port user password database } }
```
Returns `DatabaseCredentialsNode { host, port, user, password, database }`.

## High-value root queries (dashboard-relevant)

Argument shapes captured; return types are arrays of the matching `*Node`.

| Query | Filter args (excerpt) | Maps to |
|---|---|---|
| `entities` | `filterType, filterAssociations, filterIsActive, filterLastModifiedOn{Start,End}, filterLimit` | The farms axis (entities with `isGrower=true` or with a `farm` relation) |
| `entity(entityId)` | single entity by id | per-farm detail |
| `farms(filterSupplierId)` | farms by supplier | `farms` table |
| `dispatchLoads` | `filterStateIds, filterConsigneeIds, filterConsignorIds, filterMarketerIds, filterCarrierIds, filterScheduled/ActualPickup/DeliveryOn{Start,End}, filterPackDate{Start,End}, filterStockBoxes, filterLimit` | `ft_dispatch` |
| `dispatchLoadSummary(dispatchLoadId)` | per-load detail | `ft_pallets` + dispatch breakdown |
| `orders` | `filterStateIds, filterConsigneeIds, filterConsignorIds, filterScheduled/ActualPickup/DeliveryOn{Start,End}` | `ft_orders` |
| `orderItems(filterOrderVersionId!)` | per-version line items | order lines |
| `pallets` | `filterDispatchLoadId, filterPackedOn{Start,End}, filterConsigneeId, filterCropId, filterArchived` | `ft_pallets` |
| `harvestLoads` | `filterFarmId, filterCropId, filterHarvestedOn{Start,End}` | per-farm harvest data |
| `chargesApplied` | `filterAppliedOn{Start,End}, filterDispatchLoadId, filterPalletId, filterProductId` | `ft_charges` |
| `products`, `productTypes` | no args | `ft_products` |
| `qaResults` | no args | `qa_*` tables (future) |
| `cropForecasts`, `commitmentForecasts` | `filterCropId, filterEntityId, filterStart/EndOn` | Forecasting page |
| `invoices` | `filterDispatchLoadId, filterPaymentStatuses, filterSentOn/PaidOn{Start,End}` | financial reconciliation |

## EntityNode (63 fields)

Key fields for mapping to our `farms` axis:

- **Identity:** `id, code, extLink, type` (`CoreEntityTypeChoices` enum)
- **Org vs individual:** `orgNo, orgName, orgLegalName, orgContactName, indFirstName, indMiddleName, indLastName`
- **Contact:** `email, phoneNo, mobileNo`
- **Banking:** `bankAccountName, bankBsbNo, bankAccountNo, orgTaxNo`
- **Roles (each with id + active flag):** `farm/farmId/isFarmActive, supplier, shed, consignor, consignee, marketer, carrier, employee, laborHire, certificationAuthority`
- **Flags:** `isActive, isGrower`
- **Misc:** `geometry: GeoJSON, color, comment, notesHtml, tags`

**Mapping to our model:**
- A farm in our `farms` table = an entity where `isGrower=true` OR `farmId != null`.
- The entity's `code` ≈ our `farms.freshtrack_code` (need to verify with a sample query).
- `orgName`/`orgLegalName` → `farms.name`.
- `orgTaxNo` → `farms.abn` (assuming AU ABN format).
- The `consignor`/`consignee`/`marketer` roles on the same entity are how FreshTrack tracks the multi-axis relationships we modelled as `rcti_recipients`.

## DispatchLoadNode (57 fields)

Key fields for `ft_dispatch`:

- **IDs:** `id, loadNo, orderNo, salesOrderNo, poNo, manifestNo, certificateNo, dcSlotRef`
- **Schedule:** `scheduledPickupOn, actualPickupOn, scheduledDeliveryOn, actualDeliveryOn, packDate`
- **Type:** `orderType` (`CoreDispatchLoadOrderTypeChoices`)
- **Counts:** `stockBoxes, reconsignedBoxes, rejectedBoxes, repackedBoxes, wasteBoxes`
- **Temperature:** `temperatureProfile, temperatureValue, temperatureUnit`
- **Status:** `isComplete, asnSentOn, emailSentOn`
- **Misc:** `comment, palletOverview, attachedDocumentCount`

(Plus relation IDs not shown above for the carrier/consignor/consignee/marketer.)

## Status of the existing v_power_bi_* sync

- `lib/freshtrack.ts` and `/api/cron/sync-freshtrack` connect via `pg` Pool to
  `fts-cloud-prod-rds...amazonaws.com:5432`. TCP path is open from the dev
  machine; the host accepts SSL connections.
- `sync_config` has 8 best-guess step mappings (the review's open blocker).
- These were never verified against real view shapes.

The GraphQL discovery makes that workstream essentially obsolete unless we
specifically need bulk-extract performance the RDS direct connection offers.
Even then, `readonlyDatabaseCredentials` lets us mint creds on demand inside
the same auth scope, so the static `FRESHTRACK_DATABASE_URL` env var becomes
optional.

## Next steps (require Tim's input)

1. **Tim creates an admin user** in FT Cloud per step 1 of `SIMPLE INSTRUCTION.txt`.
   The sample `matteo@freshtrack.com.au` creds in the guide have been rotated
   and return `auth/credentials-incorrect`.
2. **Tim shares the new email + password** (paste in chat or drop into
   `.env.local` as `FT_GRAPHQL_EMAIL` / `FT_GRAPHQL_PASSWORD`).
3. With those credentials I will:
   - Authenticate, mint a token, and verify a small live data pull
     (`entities filterLimit:5` + `dispatchLoads filterScheduledPickupWithinPastDays:30 filterLimit:5`)
   - Confirm the field mappings on a real row (esp. how `code` relates to
     our `farms.freshtrack_code`)
   - Decide whether to (a) rewrite `lib/freshtrack.ts` as a GraphQL client and
     overhaul the sync, or (b) use the GraphQL `readonlyDatabaseCredentials`
     to mint DB creds and keep the RDS-direct sync (less churn but less typed).
   - Propose the migration plan back to Tim with the trade-offs.

## Confirmed against live data (2026-06-06, Tim's token)

Auth verified, ran a series of probe queries. Findings:

### The hierarchy matches our two-axis model exactly

```
MACKM (Mackays Marketing)              ← THE marketer (only entity with marketerId set)
  ↓
MG (Mackays Growers)                   ← top-level grouping (could be our grower_groups root)
  ↓ parent-of relationship
recipient-level entities               ← our rcti_recipients
  - LMBFA  (LMB)                         (3 child farms)
  - MACMR  (Mackays - Mullins Road)
  - MACBO  (Mackays - Bolinda)
  - MACGT  (Mackays - Gold Tyne)
  - MACRR  (Mackays - Ranch Road)
  - MACSD  (Mackays - South Davidson)
  ↓ parent-of relationship
leaf farm entities                     ← our farms
  - LMBCO  (LMB - Cooroo Bananas)
  - LMBEP  (LMB - East Palmerston)
  - LMBBF  (LMB - Bartle Frere)
  ↓ has farmId →
FarmNode (physical farm property)      ← richer farm metadata (region, timezone, geometry)
```

This validates the multi-farms-per-recipient cardinality Tim flagged as
non-negotiable: the RCTI sample we parsed (LMB - Cooroo Bananas, RCTI ref
2620-LMBCO) sits under a parent `LMBFA` entity that has 3 farms.

### Entity sample stats

- 200 active entities probed: 65 growers (`isGrower=true`), 135 non-growers
  (consignees, marketers, carriers, etc.)
- 105 farms in the top-level `farms` query
- Real-time data flowing: pallets packed yesterday (2026-06-07)

### LMBCO harvest data ties to the RCTI we have

Pulled `harvestLoads(filterFarmId: "01955ac3-7ef6-5a17-4172-175b7d5aec74", filterHarvestedWithinDays: 30)`:

| Docket | Harvested | Crop | Block |
|---|---|---|---|
| LMBCB-EF26-WK20 | 2026-05-11 | Banana Cavendish | LMB Cooroo Bananas - Entire Farm |
| LMBCB-EF26-WK21 | 2026-05-18 | Banana Cavendish | LMB Cooroo Bananas - Entire Farm |
| LMBCB-EF26-WK22 | 2026-05-25 | Banana Cavendish | LMB Cooroo Bananas - Entire Farm |

These are precisely the harvest weeks that became the RCTI dated 03/06/2026
we parsed earlier (the RCTI's sale dates were 16–21 May 2026 — the dispatch
window right after these harvests).

### Filtering pattern that worked

- `dispatchLoads(filterConsignorIds: ["<farm-uuid>"], ...)` → **0 rows** (the
  consignor on a dispatch is the parent recipient, NOT the leaf farm)
- `harvestLoads(filterFarmId: "<farm-uuid>", filterHarvestedWithinDays: N)` →
  works — this is the right grain for per-farm volume

So the sync pattern is:
1. **Per-farm production** → `harvestLoads filterFarmId` (or `pallets`
   filtered by box-harvest-load-farm)
2. **Per-recipient dispatch** → `dispatchLoads filterConsignorIds: [recipient]`
3. **Marketer-scoped dispatch overall** → `dispatchLoads filterMarketerIds: [MACKM]`

### Recommended sync architecture

1. **Entity sync** — pull `entities(filterIsActive: true)` in batches. Classify
   each as:
   - `rcti_recipient` if it has child grower entities (use the `parent`
     relation to detect) AND is itself a grower
   - `farm` if it's a grower AND has no children
   - Skip non-growers (they're customers/carriers, not in our scope)
2. **Farm metadata** — for each leaf entity, follow `farm { id supplierId
   regionId isActive }` for additional metadata.
3. **Production data** — for each farm, pull `harvestLoads filterFarmId`
   into `ft_consignments` (or a new `ft_harvests` table closer to the
   GraphQL model).
4. **Dispatch data** — pull `dispatchLoads filterMarketerIds: [MACKM]`
   (all Mackays-marketed dispatches), with date-range filtering. Drop into
   `ft_dispatch`.
5. **Pallets** — for each dispatch, pull `pallets filterDispatchLoadId` to
   reconstruct the box/pallet/origin-load chain — this is what surfaces on
   the RCTI line items.
6. **Charges** — `chargesApplied filterDispatchLoadId` for per-dispatch
   charges; matches the RCTI charges section format.

Auth handling: cache the token; watch `expiresOn`; re-authenticate via the
mutation when expired. Store FT_GRAPHQL_EMAIL/FT_GRAPHQL_PASSWORD in env;
never expose to client.

## Saved snapshots

Raw GraphQL probe results are gitignored to keep the repo small:
- `/c/Dev/MMHub/ft-queries-result.json` — all 196 root queries with arg/return shapes
- `/c/Dev/MMHub/ft-types.json` — EntityNode, DispatchLoadNode, OrderNode, DatabaseCredentialsNode, AuthTokenNode + mutation list

Regenerate by running the curl commands documented above.
