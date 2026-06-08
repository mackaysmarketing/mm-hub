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

## Saved snapshots

Raw GraphQL probe results are gitignored to keep the repo small:
- `/c/Dev/MMHub/ft-queries-result.json` — all 196 root queries with arg/return shapes
- `/c/Dev/MMHub/ft-types.json` — EntityNode, DispatchLoadNode, OrderNode, DatabaseCredentialsNode, AuthTokenNode + mutation list

Regenerate by running the curl commands documented above.
