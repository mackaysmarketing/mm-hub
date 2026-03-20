# Mackays Marketing — Grower Portal

## Developer Specification Document

**Version:** 2.0 — Production Architecture
**Date:** March 2026
**Stack:** Next.js 14 (App Router) + Vercel + PostgreSQL (Prisma ORM)

---

## 1. Project Overview

The Mackays Marketing Grower Portal is a private web application that gives growers visibility into their sales performance, remittance payments, dispatch volumes, compliance documents, and upcoming orders. It replaces manual reporting (PDF/email) with a live, self-service portal.

The portal forms part of the broader **MM-Hub** platform and shares its authentication infrastructure.

### 1.1 Data Sources

| Data Domain | Source System | Connection Method |
|---|---|---|
| Sales & dispatch (grower consignments, pallets, orders, charges) | FreshTrack — AWS RDS PostgreSQL | Read-only direct connection via Prisma secondary datasource |
| Remittances (RCTI payments) | NetSuite ERP | NetSuite REST API (SuiteTalk REST Web Services) |
| QA & compliance scores | Grower Portal app database | Manual entry via admin interface |
| Documents & certificates | Grower Portal app database | File upload to Vercel Blob Storage |
| Users & access control | Grower Portal app database | Microsoft Entra ID SSO (staff) + email/password (growers) |

### 1.2 FreshTrack Database Details

**Server:** `fts-cloud-prod-rds.c1unadkiffrs.ap-southeast-2.rds.amazonaws.com`
**Engine:** PostgreSQL (port 5432)

| Database | Purpose | Credentials |
|---|---|---|
| `cloud_mackaysmarketing` | Sales, dispatch, customer, pricing, grower data | `cloud_mackaysmarketing_readonly` (read-only) |
| `cloud_mackaysprocessing` | Processing and pack house data | `cloud_mackaysprocessing_readonly` (read-only) |

> **Note:** Credentials are stored in environment variables, never committed to source. The Vercel deployment must have its IP whitelisted in the AWS RDS security group.

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router, React Server Components) |
| Frontend | React 18, TailwindCSS, Shadcn/UI |
| Data Fetching | TanStack Query v5 (client), Server Actions (mutations) |
| Charts | Recharts |
| ORM | Prisma (dual datasource — app DB + FreshTrack read-only) |
| App Database | PostgreSQL (Neon or Supabase, managed via Vercel integration) |
| File Storage | Vercel Blob Storage |
| Authentication | NextAuth.js v5 — Microsoft Entra ID provider (staff) + Credentials provider (growers) |
| Deployment | Vercel (ap-southeast-2 region, closest to AU users) |
| Validation | Zod |
| External APIs | NetSuite REST API (SuiteTalk) for remittance data |

---

## 3. Repository Structure

```
/
├── app/
│   ├── layout.tsx                     # Root layout with providers
│   ├── page.tsx                       # Redirect to /dashboard
│   ├── (auth)/
│   │   ├── login/page.tsx             # Dual login — SSO + email/password
│   │   └── layout.tsx                 # Auth pages layout (no sidebar)
│   ├── (portal)/
│   │   ├── layout.tsx                 # Portal layout — sidebar + top bar
│   │   ├── dashboard/page.tsx         # KPI cards, volume charts, customer mix
│   │   ├── sales/page.tsx             # Volume/price charts, weekly breakdown
│   │   ├── remittances/page.tsx       # RCTI list + detail panel
│   │   ├── remittances/[id]/page.tsx  # Single remittance detail
│   │   ├── documents/page.tsx         # File library with upload
│   │   ├── qa/page.tsx                # Compliance health scores + audit tracker
│   │   ├── forecasting/page.tsx       # Placeholder (coming soon)
│   │   └── settings/page.tsx          # User management + data sync status
│   ├── (admin)/
│   │   ├── layout.tsx                 # Admin layout — admin sidebar
│   │   ├── qa-entry/page.tsx          # QA score entry form
│   │   ├── qa-entry/[growerId]/page.tsx # QA entry for specific grower
│   │   ├── growers/page.tsx           # Grower management
│   │   └── sync-status/page.tsx       # FreshTrack + NetSuite sync monitoring
│   └── api/
│       ├── auth/[...nextauth]/route.ts # NextAuth handlers
│       ├── trpc/[trpc]/route.ts       # tRPC API handler (optional)
│       ├── cron/
│       │   ├── sync-freshtrack/route.ts # Vercel Cron — FreshTrack data sync
│       │   └── sync-netsuite/route.ts   # Vercel Cron — NetSuite remittance sync
│       └── webhooks/
│           └── netsuite/route.ts       # NetSuite webhook receiver (optional)
├── components/
│   ├── app-sidebar.tsx                # Navigation sidebar with Mackays logo
│   ├── top-bar.tsx                    # Page header bar
│   ├── stat-card.tsx                  # Reusable KPI metric card
│   ├── produce-type-selector.tsx      # Global produce category filter
│   ├── time-range-selector.tsx        # Date range filter (4W/12W/26W/52W)
│   └── ui/                            # Shadcn/UI components
├── lib/
│   ├── prisma.ts                      # Prisma client (app DB)
│   ├── freshtrack.ts                  # Prisma client (FreshTrack read-only)
│   ├── netsuite.ts                    # NetSuite REST API client
│   ├── auth.ts                        # NextAuth configuration
│   └── utils.ts                       # Shared utilities
├── prisma/
│   ├── schema.prisma                  # App database schema
│   └── freshtrack.prisma              # FreshTrack read-only schema (introspected)
├── types/
│   └── index.ts                       # Shared TypeScript types
├── tailwind.config.ts
├── next.config.ts
└── vercel.json                        # Cron job definitions
```

---

## 4. Database Architecture

The portal uses **two database connections**:

### 4.1 App Database (Prisma primary datasource)

Hosted on Neon/Supabase via Vercel. Contains portal-specific data: users, QA scores, documents, cached/synced data.

### 4.2 FreshTrack Database (Prisma secondary datasource, read-only)

Direct read-only connection to the FreshTrack AWS RDS PostgreSQL instance. Used for live queries of sales, dispatch, and grower data.

---

## 5. FreshTrack Data Mapping

The FreshTrack `cloud_mackaysmarketing` database contains pre-built Power BI views that serve as the primary data source for the portal. Using these views (rather than raw tables) ensures consistency with existing Mackays reporting.

### 5.1 Key FreshTrack Views (cloud_mackaysmarketing)

| FreshTrack View | Portal Usage | Maps To |
|---|---|---|
| `v_power_bi_consignment_summary` | Sales dashboard, weekly breakdowns, KPI calculations | Dashboard stats, Sales & Pricing page |
| `v_power_bi_orders_view` | Upcoming orders, dispatch schedule | Dashboard recent orders, order tracking |
| `v_power_bi_pallet_box_details_view` | Detailed pallet/box level data, volume calculations | Sales drill-down, dispatch detail |
| `v_power_bi_pallet_with_bins_view` | Pallet data including bin information | Dispatch tracking |
| `v_power_bi_pallet_without_bins_view` | Pallet data excluding bins | Dispatch tracking |
| `v_power_bi_dispatch_load_view` | Dispatch load details, freight tracking | Dispatch page, logistics |
| `v_power_bi_entities_view` | Grower/consignee/consignor entity details | Grower profile, entity lookup |
| `v_power_bi_locations_view` | Farm and facility locations | Grower farm mapping |
| `v_power_bi_products_view` | Product catalogue (varieties, grades, pack types) | Product filters, sales breakdown |
| `v_power_bi_charges` | Charge details (freight, commission, pallets) | Charge breakdown in sales |
| `v_power_bi_charge_split` | Charge allocation splits | Charge detail |
| `v_power_bi_soh` | Stock on hand | Dashboard stock indicator |

### 5.2 Key FreshTrack Tables (underlying)

These raw tables may be queried directly when views don't expose the required data:

| Table | Purpose |
|---|---|
| `entity` | Master entity table (growers, customers, suppliers) |
| `farm` | Farm locations linked to entities |
| `crop` | Crop types and details |
| `variety` / `subvariety` | Produce variety classification |
| `product` | Product definitions |
| `crop_grade` | Quality grading |
| `order` / `order_item` | Purchase orders and line items |
| `dispatch_load` | Dispatch load headers |
| `dispatch_load_freight` | Freight details per load |
| `pallet` | Pallet records |
| `box` | Individual box/carton records |
| `harvest_load` / `harvest_load_bin` | Harvest intake records |
| `consignment_type` | Consignment classification |
| `charge` / `charge_applied` | Charge definitions and applications |
| `grader_batch` | Grading/packing batch records |
| `planting` | Planting records for forecasting |

### 5.3 FreshTrack → Portal Data Flow

```
FreshTrack RDS (PostgreSQL, read-only)
    │
    ├── Live queries via Prisma secondary datasource
    │   └── Dashboard stats, sales charts, order lists
    │       (queries run against v_power_bi_* views)
    │
    └── Scheduled sync (Vercel Cron, every 15 min)
        └── Caches key aggregates into app DB
            for faster dashboard rendering
```

**Grower identification:** FreshTrack entities are matched to portal growers using the `entity.code` field, which maps to the portal's `grower.freshtrack_code` column. The `v_power_bi_entities_view` provides the lookup.

---

## 6. App Database Schema (Prisma)

All models below are defined in `prisma/schema.prisma` for the portal's own database.

### 6.1 growers

The top-level entity. Each grower has one portal account context. Linked to FreshTrack via `freshtrack_code`.

| Column | Type | Notes |
|---|---|---|
| id | String (cuid) PK | |
| name | String | Grower business name |
| code | String (unique) | Short identifier |
| freshtrack_code | String (unique) | Maps to FreshTrack `entity.code` for data linkage |
| freshtrack_entity_id | Int? | FreshTrack entity ID (cached) |
| abn | String | Australian Business Number |
| address | String? | Physical address |
| email | String | Contact email |
| phone | String? | Contact phone |
| active | Boolean | Default true |
| created_at | DateTime | Auto-set |
| updated_at | DateTime | Auto-updated |

### 6.2 portal_users

Users with access to the grower portal. Supports dual auth: Microsoft SSO for Mackays staff, email/password for growers.

| Column | Type | Notes |
|---|---|---|
| id | String (cuid) PK | |
| name | String | Display name |
| email | String (unique) | Login identifier |
| password_hash | String? | Null for SSO users, bcrypt hash for growers |
| auth_provider | String | `"microsoft"` or `"credentials"` |
| microsoft_id | String? | Microsoft Entra ID object ID (SSO users) |
| role | String | `"admin"`, `"staff"`, or `"grower"` |
| grower_id | String? FK → growers.id | Required for `grower` role — scopes all data to this grower |
| allowed_menu_items | String[] | Array of permitted menu items |
| active | Boolean | Default true |
| last_login_at | DateTime? | |
| created_at | DateTime | Auto-set |

**Roles:**

| Role | Auth Method | Capabilities |
|---|---|---|
| `admin` | Microsoft SSO | Full access — manage users, QA entry, view all growers, sync controls |
| `staff` | Microsoft SSO | View all growers, limited admin |
| `grower` | Email/password | View own data only — scoped by `grower_id` |

**Valid menu items** (enforced by Zod enum):
`Dashboard`, `Sales & Pricing`, `QA & Compliance`, `Forecasting`, `Remittances`, `Documents`

### 6.3 remittances

Top-level payment record (RCTI — Recipient Created Tax Invoice). Synced from NetSuite.

| Column | Type | Notes |
|---|---|---|
| id | String (cuid) PK | |
| grower_id | String FK → growers.id | |
| netsuite_id | String (unique) | NetSuite internal ID for deduplication |
| rcti_ref | String | RCTI reference number |
| payment_date | DateTime | Date of payment |
| grower_name | String | Denormalised name at time of invoice |
| grower_abn | String? | Denormalised ABN |
| total_gross | Decimal | Gross sales total |
| total_deductions_ex_gst | Decimal | Charges excluding GST |
| total_deductions_gst | Decimal | GST component of charges |
| total_deductions | Decimal | Total deductions |
| total_invoiced | Decimal | Net amount payable |
| total_quantity | Int | Total cartons |
| netsuite_pdf_url | String? | Link to PDF in NetSuite |
| status | String | Default `"processed"` |
| synced_at | DateTime | When synced from NetSuite |
| created_at | DateTime | Auto-set |

### 6.4 remittance_line_items

Individual sale lines within a remittance. Synced from NetSuite.

| Column | Type | Notes |
|---|---|---|
| id | String (cuid) PK | |
| remittance_id | String FK → remittances.id | |
| netsuite_line_id | String? | NetSuite line ID |
| sale_date | DateTime? | |
| dispatch_date | DateTime? | |
| origin_load | String? | Load/truck reference |
| destination | String? | Delivery location |
| po_number | String? | Purchase order |
| manifest | String? | Manifest reference |
| customer_ref | String? | Customer's reference |
| consignee_code | String? | Consignee identifier |
| product | String | Full product name (e.g. "Bananas 13.5kg") |
| description | String? | Line description |
| quantity | Int | Number of cartons |
| unit_price | Decimal | Price per carton |
| total_amount | Decimal | Line total |
| customer | String? | Buyer name (Coles, Woolworths, ALDI, etc.) |
| produce_category | String? | Banana, Avocado, Papaya, etc. |
| grade | String? | Quality grade |

### 6.5 remittance_charges

Deductions and fees applied to a remittance. Synced from NetSuite.

| Column | Type | Notes |
|---|---|---|
| id | String (cuid) PK | |
| remittance_id | String FK → remittances.id | |
| line_item_id | String? FK → remittance_line_items.id | Optional line-level charge |
| charge_type | String | e.g. "Freight", "Commission", "Pallets" |
| ex_gst | Decimal | Amount excluding GST |
| gst | Decimal | GST component |
| total_amount | Decimal | Total charge |

### 6.6 qa_assessments

QA & compliance scores — manually entered by Mackays admin staff.

| Column | Type | Notes |
|---|---|---|
| id | String (cuid) PK | |
| grower_id | String FK → growers.id | |
| assessment_date | DateTime | Date of assessment |
| assessed_by | String FK → portal_users.id | Admin who entered the data |
| overall_score | Decimal | Overall compliance score (0–100) |
| status | String | `"compliant"`, `"at_risk"`, `"non_compliant"` |
| notes | String? | General notes |
| created_at | DateTime | |
| updated_at | DateTime | |

### 6.7 qa_category_scores

Individual category scores within an assessment.

| Column | Type | Notes |
|---|---|---|
| id | String (cuid) PK | |
| assessment_id | String FK → qa_assessments.id | |
| category | String | e.g. "Food Safety", "Certification", "Traceability", "Chemical Management", "Environmental" |
| score | Decimal | Score (0–100) |
| max_score | Decimal | Maximum possible score |
| status | String | `"pass"`, `"warning"`, `"fail"` |
| findings | String? | Specific findings or issues |
| action_required | String? | Required corrective actions |
| due_date | DateTime? | Deadline for corrective action |

### 6.8 qa_audits

Audit schedule tracking.

| Column | Type | Notes |
|---|---|---|
| id | String (cuid) PK | |
| grower_id | String FK → growers.id | |
| audit_type | String | e.g. "HARPS", "Freshcare", "GlobalGAP", "Internal" |
| scheduled_date | DateTime | |
| completed_date | DateTime? | Null until completed |
| auditor | String? | Auditor name or firm |
| result | String? | `"pass"`, `"conditional_pass"`, `"fail"`, pending if null |
| certificate_expiry | DateTime? | When the resulting certificate expires |
| notes | String? | |
| document_id | String? FK → documents.id | Link to uploaded certificate/report |
| created_at | DateTime | |

### 6.9 documents

Uploaded files stored in Vercel Blob Storage.

| Column | Type | Notes |
|---|---|---|
| id | String (cuid) PK | |
| grower_id | String FK → growers.id | |
| name | String | Filename |
| category | String | `"compliance"`, `"certificate"`, `"agreements"`, `"unpaid_lots"`, `"general"` |
| blob_url | String | Vercel Blob Storage URL |
| file_size | Int | Bytes |
| mime_type | String | MIME type |
| uploaded_by | String FK → portal_users.id | |
| uploaded_at | DateTime | |

### 6.10 sync_logs

Tracks data synchronisation runs from FreshTrack and NetSuite.

| Column | Type | Notes |
|---|---|---|
| id | String (cuid) PK | |
| source | String | `"freshtrack"` or `"netsuite"` |
| sync_type | String | `"full"` or `"incremental"` |
| status | String | `"running"`, `"success"`, `"failed"` |
| records_synced | Int | Count of records processed |
| error_message | String? | Error details if failed |
| started_at | DateTime | |
| completed_at | DateTime? | |

---

## 7. NetSuite Integration

### 7.1 Connection

Remittance data (RCTIs) is sourced from NetSuite via the **SuiteTalk REST Web Services API**.

| Setting | Value |
|---|---|
| Auth method | OAuth 2.0 (Client Credentials flow) or Token-Based Authentication (TBA) |
| Base URL | `https://{account_id}.suitetalk.api.netsuite.com/services/rest/` |
| Record types | `vendorBill` or custom RCTI record (to be confirmed with Mackays finance team) |

### 7.2 Environment Variables

| Variable | Purpose |
|---|---|
| `NETSUITE_ACCOUNT_ID` | NetSuite account identifier |
| `NETSUITE_CONSUMER_KEY` | OAuth consumer key |
| `NETSUITE_CONSUMER_SECRET` | OAuth consumer secret |
| `NETSUITE_TOKEN_ID` | Token ID (for TBA) |
| `NETSUITE_TOKEN_SECRET` | Token secret (for TBA) |

### 7.3 Sync Process

```
Vercel Cron (every 30 min)
    │
    ├── GET /services/rest/record/v1/vendorBill
    │   ?q=type IS 'RCTI' AND lastModifiedDate AFTER {last_sync}
    │
    ├── For each RCTI:
    │   ├── Match grower by ABN or entity code
    │   ├── Upsert remittance header (dedupe on netsuite_id)
    │   ├── Upsert line items
    │   └── Upsert charges
    │
    └── Write sync_log entry
```

### 7.4 NetSuite → Portal Field Mapping

This mapping will be finalised during integration, but the expected structure is:

| NetSuite Field | Portal Field |
|---|---|
| `internalId` | `remittances.netsuite_id` |
| `tranId` | `remittances.rcti_ref` |
| `tranDate` | `remittances.payment_date` |
| `entity.entityId` | Lookup → `growers.freshtrack_code` |
| `total` | `remittances.total_gross` |
| Line items sublists | `remittance_line_items` rows |
| Expense/charge sublists | `remittance_charges` rows |

---

## 8. API Routes (Next.js App Router)

All data access uses Server Components and Server Actions where possible. Client-side API routes are provided for dynamic interactions.

### 8.1 Server Actions (mutations)

| Action | File | Description |
|---|---|---|
| `uploadDocument` | `app/(portal)/documents/actions.ts` | Upload file to Vercel Blob + create DB record |
| `createQaAssessment` | `app/(admin)/qa-entry/actions.ts` | Create new QA assessment with category scores |
| `updateQaAssessment` | `app/(admin)/qa-entry/actions.ts` | Update existing assessment |
| `createQaAudit` | `app/(admin)/qa-entry/actions.ts` | Schedule or record an audit |
| `createPortalUser` | `app/(portal)/settings/actions.ts` | Create user (admin only) |
| `updatePortalUser` | `app/(portal)/settings/actions.ts` | Update user fields |
| `deletePortalUser` | `app/(portal)/settings/actions.ts` | Deactivate user |
| `triggerSync` | `app/(admin)/sync-status/actions.ts` | Manually trigger FreshTrack or NetSuite sync |

### 8.2 API Routes (data fetching for client components)

| Method | Path | Description |
|---|---|---|
| GET | `/api/dashboard/stats` | KPI metrics: gross sales, avg price, price range, reject rate, net return |
| GET | `/api/dashboard/volume` | Weekly dispatch volumes by produce type (KG) |
| GET | `/api/dashboard/customer-mix` | Sales distribution by customer (%) |
| GET | `/api/dashboard/recent-orders` | Latest 10 orders |
| GET | `/api/sales/weekly-breakdown` | Weekly sales rows with customer, grade, qty, price breakdowns |
| GET | `/api/sales/price-landscape` | Price comparison data by grade/customer |
| GET | `/api/remittances` | All remittance headers for current grower |
| GET | `/api/remittances/[id]` | Single remittance with line items and charges |
| GET | `/api/orders` | All orders for current grower |
| GET | `/api/documents` | All documents for current grower |

### 8.3 Cron Routes (Vercel Cron)

| Path | Schedule | Description |
|---|---|---|
| `/api/cron/sync-freshtrack` | Every 15 minutes | Cache key FreshTrack aggregates into app DB |
| `/api/cron/sync-netsuite` | Every 30 minutes | Pull new/updated RCTIs from NetSuite |

Defined in `vercel.json`:
```json
{
  "crons": [
    { "path": "/api/cron/sync-freshtrack", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/sync-netsuite", "schedule": "*/30 * * * *" }
  ]
}
```

### 8.4 Data Scoping

All data queries are scoped by the authenticated user's role:

- **`grower` role:** All queries filtered by `grower_id` from the user's session. FreshTrack queries filtered by matching `entity.code`.
- **`staff` / `admin` role:** Can view any grower's data. Grower selection via dropdown in the top bar.

---

## 9. Authentication

### 9.1 NextAuth.js v5 Configuration

```
lib/auth.ts
├── Microsoft Entra ID Provider (staff + admin)
│   ├── Tenant: Mackays Marketing Azure AD tenant
│   ├── Scopes: openid, profile, email
│   └── On sign-in: match by email → create/update portal_user with auth_provider="microsoft"
│
└── Credentials Provider (growers)
    ├── Email + password (bcrypt)
    └── On sign-in: validate against portal_users where auth_provider="credentials"
```

### 9.2 Environment Variables

| Variable | Purpose |
|---|---|
| `NEXTAUTH_SECRET` | Session encryption key |
| `NEXTAUTH_URL` | Canonical app URL |
| `AZURE_AD_CLIENT_ID` | Microsoft Entra ID app client ID |
| `AZURE_AD_CLIENT_SECRET` | Microsoft Entra ID app client secret |
| `AZURE_AD_TENANT_ID` | Mackays Marketing Azure AD tenant ID |

### 9.3 Session Shape

```typescript
interface Session {
  user: {
    id: string
    name: string
    email: string
    role: "admin" | "staff" | "grower"
    growerId: string | null       // null for staff/admin
    allowedMenuItems: string[]
    authProvider: "microsoft" | "credentials"
  }
}
```

### 9.4 Login Page

The login page (`/login`) presents two sections:

1. **Mackays Staff** — "Sign in with Microsoft" button (SSO via Entra ID)
2. **Grower Access** — Email + password form with forgot password flow

---

## 10. Frontend Pages

### 10.1 Dashboard (`/dashboard`)

**Purpose:** High-level performance overview for the grower.

**Data source:** FreshTrack `v_power_bi_consignment_summary`, `v_power_bi_orders_view`, `v_power_bi_soh`

**Components:**
- `TopBar` — page title + `TimeRangeSelector` (4W / 12W / 26W / 52W)
- `ProduceTypeSelector` — filters all charts by produce category
- 4x `StatCard` — Gross Sales, Avg Price/Carton, Price Range, Net Return
- Stacked bar chart — Weekly dispatch volumes (KG) by customer
- Donut/pie chart — Customer mix (% of total volume)
- Recent orders table — Last 10 dispatches with status badges

### 10.2 Sales & Pricing (`/sales`)

**Purpose:** Detailed sales trends and pricing analysis.

**Data source:** FreshTrack `v_power_bi_consignment_summary`, `v_power_bi_charges`, `v_power_bi_pallet_box_details_view`

**Components:**
- Composed chart — Stacked bars (volume by customer in KG) + dashed line (avg price per KG)
- Expandable weekly breakdown table — rows per week showing customer, grade, qty, price, total
- Summary row per week with totals

### 10.3 Remittances (`/remittances`)

**Purpose:** View and reconcile RCTI payment documents.

**Data source:** App DB `remittances`, `remittance_line_items`, `remittance_charges` (synced from NetSuite)

**Components:**
- Search input (filter by RCTI ref or grower name)
- Remittance list (left panel) — RCTI ref, payment date, gross total, status badge
- Detail panel (right) — header summary, line items table, charges breakdown
- PDF download link (via `netsuite_pdf_url`)

### 10.4 Documents (`/documents`)

**Purpose:** Centralised file library for compliance and commercial documents.

**Data source:** App DB `documents`, Vercel Blob Storage

**Components:**
- Search input
- Category filter pills: All / Compliance / Certificate / Agreements / Unpaid Lots / General
- Document grid/list — filename, category badge, file size, upload date, download action
- Upload dialog — drag-and-drop or file picker, category selector

### 10.5 QA & Compliance (`/qa`)

**Purpose:** Quality assurance health overview and audit schedule tracking.

**Data source:** App DB `qa_assessments`, `qa_category_scores`, `qa_audits`

**Components:**
- Overall health score gauge/progress (from latest `qa_assessments.overall_score`)
- Individual compliance area scores (from `qa_category_scores` — food safety, certification, traceability, etc.)
- Status indicators per category (pass / warning / fail)
- Action items list (from `qa_category_scores.action_required` where `due_date` is upcoming)
- Upcoming audit calendar list (from `qa_audits` where `completed_date` is null)
- Historical score trend chart

### 10.6 Forecasting (`/forecasting`)

**Purpose:** Yield and price forecasting tools.

**Current state:** Placeholder page — "Coming Soon" message displayed.

**Future data source:** FreshTrack `planting`, `crop_forecast`, `crop_forecast_crop_value` tables

### 10.7 Settings (`/settings`)

**Purpose:** Administration of portal users and data sync monitoring.

**Tabs:**

1. **User Management** (admin/staff only)
   - Table of portal users (name, email, role, auth provider, active status, allowed pages)
   - Add user dialog — name, email, role selector, menu item checkboxes
   - For grower users: grower assignment dropdown, password set
   - Edit user — same fields
   - Deactivate user

2. **Sync Status** (admin only)
   - FreshTrack connection status (last successful query timestamp)
   - NetSuite sync status (last sync, records processed, errors)
   - Manual sync trigger buttons

---

## 11. Admin Interface — QA Entry

### 11.1 QA Entry Page (`/admin/qa-entry`)

**Purpose:** Allows Mackays admin staff to enter and manage QA assessment scores for growers.

**Access:** `admin` role only.

**Grower list view:**
- Table of all active growers with their latest QA status (compliant / at risk / non-compliant)
- Last assessment date
- Next audit due date
- Quick action to create new assessment

### 11.2 QA Entry Form (`/admin/qa-entry/[growerId]`)

**Assessment form fields:**
- Assessment date (default: today)
- Overall score (auto-calculated from category scores)
- Status (auto-set based on score thresholds: ≥80 compliant, 60–79 at risk, <60 non-compliant)
- General notes

**Category score sub-form (repeatable section):**
- Category dropdown: Food Safety, Certification, Traceability, Chemical Management, Environmental, Workplace Health & Safety
- Score (0–100)
- Findings (text)
- Action required (text)
- Due date for corrective action

**Audit scheduling section:**
- Audit type dropdown: HARPS, Freshcare, GlobalGAP, Internal
- Scheduled date
- Auditor name
- Upload certificate/report (links to Documents)

---

## 12. Shared Components

### 12.1 AppSidebar

- Mackays logo + "Grower Portal" label in header
- Navigation links scoped by `allowedMenuItems` from user session
- Grower name displayed (for grower users) or grower selector dropdown (for staff/admin)
- White background, neutral active state styling
- Built on Shadcn `Sidebar` primitive

### 12.2 TopBar

- Page title (left)
- Action slot (right) — used for `TimeRangeSelector` and/or `ProduceTypeSelector`

### 12.3 StatCard

- Props: `title`, `value`, `change` (±%), `icon`, `color`
- Displays: title label, large hero value, pill badge showing % change

### 12.4 ProduceTypeSelector

- Pill buttons for each produce type with data: Banana (yellow), Avocado (green), Papaya (orange), Frozen Banana (dark blue), Passionfruit (purple)
- Hidden when no data exists; shows "All" option plus each available type

### 12.5 TimeRangeSelector

- Options: 4W, 12W, 26W, 52W
- Dark filled active pill styling

---

## 13. Design System

### 13.1 Colour Palette

| Token | Hex | Usage |
|---|---|---|
| Forest | `#172e24` | Primary brand, sidebar logo, headings |
| Canopy | `#1A5C34` | Avocado data, Woolworths colour, positive indicators |
| Fire | `#E05528` | Papaya data, Coles colour, alert badges |
| Sun | `#E8B824` | Banana data, warning indicators |
| Earth | `#6B4C2A` | Tertiary accent |
| Frozen Banana | `#1B3A5C` | Frozen banana data, ALDI colour |
| Passionfruit | `#8B5CF6` | Passionfruit data |

### 13.2 Layout Tokens

| Token | Value |
|---|---|
| Background | `hsl(0 0% 94%)` — light neutral grey |
| Card background | White (`#ffffff`) |
| Card border | `1px solid #e3e3e3` |
| Card radius | `rounded-xl` (16px) |
| Sidebar background | White |

### 13.3 Typography

- Body / UI: **Inter** (weights 400, 500, 600, 700)
- Numeric data: **JetBrains Mono**

### 13.4 Customer Colour Mapping

| Customer | Colour |
|---|---|
| Coles | `#E05528` (Fire red) |
| Woolworths | `#1A5C34` (Canopy green) |
| ALDI | `#1B3A5C` (Dark blue) |

---

## 14. Volume Calculation

Dispatch volumes are displayed in **kilograms (KG)**, not carton count.

Weight is extracted from the product name using regex: `(\d+(?:\.\d+)?)\s*kg`

Examples:
- `"Bananas 13.5kg"` → 13.5 kg/carton
- `"Avocados 6kg"` → 6 kg/carton
- Fallback if no weight found: **15 kg/carton**

Total KG = `quantity (cartons) × weight per carton`

---

## 15. Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | App database connection string (Neon/Supabase) |
| `FRESHTRACK_DATABASE_URL` | FreshTrack RDS read-only connection string |
| `NEXTAUTH_SECRET` | Session encryption key |
| `NEXTAUTH_URL` | Canonical app URL |
| `AZURE_AD_CLIENT_ID` | Microsoft Entra ID client ID |
| `AZURE_AD_CLIENT_SECRET` | Microsoft Entra ID client secret |
| `AZURE_AD_TENANT_ID` | Mackays Marketing Azure AD tenant |
| `NETSUITE_ACCOUNT_ID` | NetSuite account ID |
| `NETSUITE_CONSUMER_KEY` | NetSuite OAuth consumer key |
| `NETSUITE_CONSUMER_SECRET` | NetSuite OAuth consumer secret |
| `NETSUITE_TOKEN_ID` | NetSuite TBA token ID |
| `NETSUITE_TOKEN_SECRET` | NetSuite TBA token secret |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob Storage token |
| `CRON_SECRET` | Secret to authenticate Vercel Cron requests |

---

## 16. Deployment

### 16.1 Vercel Configuration

- **Region:** `syd1` (Sydney, ap-southeast-2) — closest to Australian users and FreshTrack RDS
- **Framework:** Next.js (auto-detected)
- **Build command:** `prisma generate && next build`
- **Node.js version:** 20.x

### 16.2 Database Setup

1. Provision PostgreSQL via Vercel Postgres (Neon) or Supabase
2. Run `npx prisma db push` to create app schema
3. Seed initial grower records and admin user

### 16.3 FreshTrack Connectivity

The Vercel deployment's egress IPs must be whitelisted in the AWS RDS security group for `fts-cloud-prod-rds`. Vercel Pro/Enterprise provides static IP ranges. Alternatively, use a connection proxy (e.g., AWS PrivateLink or a lightweight proxy on EC2).

### 16.4 Domain

The portal will be accessible at a subdomain of the MM-Hub (e.g., `growers.mackaysmarketing.com.au` or `portal.mm-hub.com.au`).

---

## 17. Development Workflow

```bash
# Install dependencies
npm install

# Generate Prisma clients (both app + FreshTrack)
npx prisma generate

# Push app schema to database
npx prisma db push

# Run development server
npm run dev

# Introspect FreshTrack schema (one-time, to generate types)
npx prisma db pull --schema=prisma/freshtrack.prisma
```

---

## 18. Known Limitations / Future Work

| Area | Status |
|---|---|
| FreshTrack view column mapping | Needs introspection — exact column names TBC from `v_power_bi_*` views |
| NetSuite RCTI record type | Needs confirmation — may be `vendorBill`, `vendorCredit`, or custom record |
| Vercel static IP for RDS access | Requires Vercel Pro/Enterprise or a proxy solution |
| Forecasting module | Placeholder — future integration with FreshTrack `planting` / `crop_forecast` |
| Mobile layout | Sidebar collapses but pages not fully optimised for small screens |
| Multi-grower support | Supported via `grower_id` scoping — each grower sees only their data |
| Password reset for growers | Needs email sending (Resend or AWS SES) |
| QA category list | Currently hardcoded — may need to be configurable per grower type |

---

*Document generated from codebase inspection and FreshTrack database analysis — March 2026*
