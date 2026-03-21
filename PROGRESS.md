# MM-Hub — Progress Tracker

## Phase 1: Foundation (COMPLETE)
- [x] Next.js scaffold with App Router
- [x] Supabase auth (Microsoft SSO + email/password)
- [x] Two-tier access model (hub_users + module_access)
- [x] Database schema: growers, remittances, QA, documents, FreshTrack ft_* tables, sync_logs
- [x] RLS policies for all tables
- [x] Grower portal shell (dashboard, sales, remittances, documents, QA, forecasting, settings, admin pages)
- [x] Hub admin shell (users, modules)

## Phase 2: Sync Engine (COMPLETE)

### FreshTrack Sync
- [x] `sync_config` table — admin-configurable field mappings per sync step (migration 00002)
- [x] Default FreshTrack mappings seeded (8 steps: entities → products → consignments → orders → pallets → dispatch → charges → stock)
- [x] `lib/freshtrack.ts` — pg Pool connection to FreshTrack RDS (read-only, max 3 connections, SSL)
- [x] `lib/sync-utils.ts` — shared utilities (extractWeightKg, deriveProduceCategory, chunkArray, mapSourceRow, applyTransforms)
- [x] `app/api/cron/sync-freshtrack/route.ts` — Vercel Cron handler (every 15 min, CRON_SECRET auth, config-driven sync loop, batch upsert, sync logging)

### NetSuite Sync
- [x] `lib/netsuite.ts` — NetSuite REST API client (OAuth 1.0 TBA via HMAC-SHA256, pagination, rate limit retry)
- [x] `sync_config` seeded for NetSuite RCTI sync (migration 00003)
- [x] `app/api/cron/sync-netsuite/route.ts` — Vercel Cron handler (every 30 min, incremental sync, RCTI → remittances + line items + charges)
- [ ] RCTI PDF retrieval (deferred — requires NetSuite file cabinet access or PDF generation endpoint)

### Infrastructure
- [x] `vercel.json` — cron definitions for both FreshTrack (*/15) and NetSuite (*/30)
- [x] `sync_logs` recording on every cron run (status, records_synced, error_message, timestamps)
- [x] `CRON_SECRET` validation on all cron routes (skipped in development)

### Architecture Decisions
- **sync_config table:** Field mappings are database-driven and admin-configurable, not hardcoded. 8 FreshTrack steps + 1 NetSuite step seeded with best-guess column names. When actual column names are discovered, an admin updates mappings in the browser — no code deploy needed.
- **NetSuite OAuth:** Uses `oauth-1.0a` with HMAC-SHA256 Token-Based Authentication. RCTI record type (`vendorBill`) is a configurable constant in `lib/netsuite.ts`.
- **Sync error isolation:** Each step/record is wrapped in try/catch — one failure doesn't block others. Step-level errors are collected and reported in sync_logs.
- **Grower resolution:** Uses `growers.freshtrack_code` to map FreshTrack `entity_code` to portal `grower_id` (same mapping for both FreshTrack and NetSuite sync).
- **Transform rules:** Support `extract_from_product_name`, `calculate_from_quantity_and_product`, and `derive_from_product` transforms.
- **NetSuite line items:** Use delete+reinsert pattern (leveraging ON DELETE CASCADE on remittance_line_items/charges FK).
- **Rate limiting:** NetSuite client has exponential backoff on HTTP 429, max 3 retries.

### Known Issues
- All FreshTrack field mappings are best guesses — need introspection against actual `v_power_bi_*` views by running `SELECT * FROM v_power_bi_xxx LIMIT 1` against the real database.
- NetSuite RCTI record type (`vendorBill` vs `vendorCredit` vs custom) and field names need verification with the Mackays finance team and a sandbox API call.
- `oauth-1.0a` package installed for NetSuite TBA (not a widely maintained package — monitor for security updates).

## Phase 3: Dashboard & Data Pages (COMPLETE)

### Dashboard (COMPLETE)
- [x] 4x KPI stat cards (gross sales, avg price, price range, total volume) with period-over-period % change
- [x] Stacked bar chart — weekly dispatch volumes by customer (Recharts)
- [x] Donut chart — customer mix with corporate colours
- [x] Recent orders table (last 10, status badges)
- [x] TimeRangeSelector (4W/12W/26W/52W) and ProduceTypeSelector components
- [x] StatCard reusable component
- [x] 4 API routes: `/api/dashboard/stats`, `/volume`, `/customer-mix`, `/recent-orders`

### Sales & Pricing (COMPLETE)
- [x] Composed chart — stacked bars (volume by customer in KG) + dashed line overlay (avg price $/kg)
- [x] Expandable weekly breakdown table — accordion rows with customer/grade/qty/price detail
- [x] 2 API routes: `/api/sales/weekly-breakdown`, `/api/sales/price-landscape`

### Remittances (COMPLETE)
- [x] Remittance list API (`/api/remittances`) — search by RCTI ref / grower name, RLS-respecting
- [x] Remittance detail API (`/api/remittances/[id]`) — header + line items + charges
- [x] Shared `RemittanceDetail` component — header, 4 summary cards, sale lines table, deductions table
- [x] Remittances list page — responsive split view (list + detail on desktop, list-only on mobile with links)
- [x] Remittance detail page (`/remittances/[id]`) — standalone detail view for mobile / direct navigation
- [x] Debounced search (300ms), status badges, customer colour dots, PDF download link

### Remaining
- [ ] Orders page
- [ ] Dispatch tracking
- [ ] Stock on hand

## Phase 4: Documents & QA (COMPLETE)

### Documents (COMPLETE)
- [x] Document list API (`/api/documents`) — filter by growerId, category, search (ILIKE on name)
- [x] Document upload API (`/api/documents/upload`) — FormData POST, 10MB limit, mime type validation, Supabase Storage upload + DB record
- [x] Document download API (`/api/documents/[id]/download`) — 60-second signed URL redirect from Supabase Storage
- [x] Documents page — category filter pills, debounced search, responsive document grid with file type icons
- [x] Upload dialog — drag-and-drop zone, category selector, file preview, TanStack Query mutation with cache invalidation

### QA & Compliance (COMPLETE)
- [x] QA overview API (`/api/qa/overview`) — latest assessment, category scores, action items (from scores with action_required), upcoming audits
- [x] QA page — circular SVG health score gauge, category score cards with progress bars, action items list, upcoming audits table
- [x] Status-aware colour coding (compliant/pass → green, at_risk/warning → amber, non_compliant/fail → red)

## Phase 5: Admin Pages & Polish (COMPLETE)

### Hub Admin — User Management (COMPLETE)
- [x] Users list API (`/api/hub-admin/users`) — GET all users with module_access, search by name/email; POST create user via Supabase Auth admin
- [x] Single user API (`/api/hub-admin/users/[id]`) — GET detail, PATCH update (name/hub_role/active + auth ban/unban), DELETE soft-deactivate
- [x] Module assignments API (`/api/hub-admin/users/[id]/modules`) — POST assign (upsert with role defaults + farm_ids + financial_access), PATCH update (role/config/active), DELETE remove
- [x] Growers list API (`/api/hub-admin/growers`) — active growers for grower dropdown
- [x] Users list page — Shadcn Table with auth/role/module/status badges, relative time, search, Add User dialog
- [x] User edit page — editable details card, module assignments with role selector/menu item checkboxes/capability checkboxes/grower dropdown/grower_admin info text, danger zone with deactivate confirmation

### Grower Management (COMPLETE)
- [x] Grower list/create API (`/api/grower-portal/admin/growers`) — GET all growers (requires view_all_growers), POST create (requires manage_users)
- [x] Grower detail/update API (`/api/grower-portal/admin/growers/[id]`) — GET single with stats (consignment count, latest remittance, QA status), PATCH update
- [x] Grower management page — table with code/FreshTrack code/ABN/email/status, add/edit dialog with FreshTrack code helper text, active toggle

### QA Entry (COMPLETE)
- [x] QA overview API (`/api/grower-portal/admin/qa`) — GET all growers with latest assessment + next audit; POST create assessment with category scores (auto-derived status)
- [x] QA audits API (`/api/grower-portal/admin/qa/audits`) — POST schedule audit, PATCH update (mark complete, attach certificate)
- [x] QA entry list page — grower table with status badges, scores, last assessed, next audit, "New Assessment" buttons
- [x] QA entry form page — assessment date + notes, 6 pre-populated category cards (Food Safety, Certification, Traceability, Chemical Management, Environmental, WHS), score/max_score/status override/findings/action required/due date per category, auto-calculated overall score, optional audit scheduling (HARPS/Freshcare/GlobalGAP/Internal)

### Sync Status (COMPLETE)
- [x] Sync status API (`/api/grower-portal/admin/sync`) — GET logs + config + summary (last sync/last success per source); POST trigger manual sync via internal cron endpoint
- [x] Sync status page — FreshTrack + NetSuite status cards with "Sync Now" buttons, sync history table with source/type/status/records/duration/error filterable by source, collapsible field mapping viewer showing source→target column mapping + transform rules per step

### Settings (COMPLETE)
- [x] Settings page — account info (name, email, auth provider, hub role, module role), admin links (Grower Management, QA Entry, Sync Status — shown by capability), grower admin links (User Management — shown by manage_grower_users capability), sign out button

## Phase 6: Polish, Mobile & Deployment (COMPLETE)

### Subdomain Architecture (COMPLETE)
- [x] `lib/subdomain.ts` — portal mode detection (`grower` | `hub` | `dev`) from hostname, with env var override support (`NEXT_PUBLIC_GROWER_DOMAIN`, `NEXT_PUBLIC_HUB_DOMAIN`)
- [x] `middleware.ts` — detects portal mode, sets `x-portal-mode` header, blocks `/hub-admin/*` in grower mode
- [x] Login page — three subdomain-aware layouts:
  - **Grower** (`grower.mackaysmarketing.com.au`): "Grower Portal" header, email/password only, no SSO
  - **Hub** (`hub.mackaysmarketing.com.au`): "MM-Hub" header, Microsoft SSO only, no email form
  - **Dev** (`localhost`): both auth methods (existing dual layout)
- [x] Root page (`app/page.tsx`) — grower mode always redirects to `/dashboard`, hub/dev follows multi-module routing
- [x] Auth callback (`app/(auth)/callback/route.ts`) — redirects to `/dashboard` in grower mode, `/` in hub/dev
- [x] Grower portal layout — suppresses module switcher in grower mode, shows "Grower Portal" in sidebar header

### Error Boundaries (COMPLETE)
- [x] `app/(grower-portal)/error.tsx` — client error boundary with blaze left border, try-again + dashboard link
- [x] `app/(hub-admin)/error.tsx` — same pattern for hub admin
- [x] `app/(auth)/error.tsx` — same pattern for auth pages
- [x] `app/not-found.tsx` — custom 404 page with centred card layout

### Loading States (COMPLETE)
- [x] `app/(grower-portal)/loading.tsx` — pulsing dots loader on parchment background
- [x] `components/skeleton-card.tsx` — reusable skeleton with stat/chart/table/list variants

### Mobile Responsiveness (COMPLETE)
- [x] `components/app-sidebar.tsx` — hidden on mobile by default, overlay drawer with backdrop on open, auto-close on nav click, exported `SidebarTrigger` hamburger button, grower admin "Users" link
- [x] `components/top-bar.tsx` — accepts sidebarTrigger and badge slots
- [x] `components/portal-shell.tsx` — client wrapper managing sidebar state + freshness badge + farm selector, exports `usePortalData()` context hook
- [x] `app/(grower-portal)/layout.tsx` — uses `PortalShell` for mobile-aware layout, passes farm/financial context

### Data Freshness (COMPLETE)
- [x] `components/data-freshness-badge.tsx` — relative time display with green/harvest/blaze status dot, auto-refreshes every 60s
- [x] `app/api/sync-status/latest/route.ts` — returns latest successful FreshTrack sync timestamp

### Deployment Prep (COMPLETE)
- [x] `next.config.mjs` — standalone output, Supabase Storage image domains
- [x] `vercel.json` — syd1 region, cron definitions
- [x] `.env.local.example` — all env vars documented with comments, including subdomain routing vars
- [x] Storage bucket comment in document upload route

## Phase 7: Farm-Level Access & Grower Admin (COMPLETE)

### Database (migration 00004)
- [x] `farms` table — linked to growers, synced from FreshTrack (name, code, freshtrack_farm_id, region, location)
- [x] RLS policies: hub admin reads all, portal staff reads all, grower_admin reads own grower farms, grower user reads assigned farms only
- [x] `farm_id` column added to ft_consignments, ft_orders, ft_pallets, ft_dispatch, ft_charges, ft_stock (with indexes)
- [x] `get_portal_farm_ids()` RLS helper function — returns accessible farm UUIDs (null = all farms)
- [x] Grower admin RLS: `grower_admin_read_grower_users` policy on module_access for same-grower user visibility
- [x] Farm sync config row (step 9) seeded for FreshTrack farm sync

### Access Control Model
- [x] New `grower_admin` role — between staff and grower, manages users within their grower entity
- [x] `GrowerPortalConfig` extended: `farm_ids` (null = all, array = specific), `financial_access` (per menu item boolean)
- [x] `GrowerPortalContext` extended: `farmIds`, `financialAccess` fields
- [x] `lib/portal-access.ts` — `getPortalAccessContext()` + `getFarmFilter()` shared helpers for API routes
- [x] `lib/financial-filter.ts` — `stripFinancials()` recursively nulls monetary fields, `getPageNameFromPath()` maps routes to menu items

### Farm Context & Selector
- [x] `hooks/use-farm-context.ts` — fetches accessible farms, manages selectedFarmId state, handles single-farm lock
- [x] `components/farm-selector.tsx` — dropdown with "All farms" + individual farm names with region
- [x] `components/portal-shell.tsx` — provides `PortalDataContext` (selectedFarmId, financialAccess) via React context, `usePortalData()` hook

### API Farm Filtering & Financial Access
- [x] `/api/dashboard/stats` — farm_id filter, financial access stripping
- [x] `/api/dashboard/volume` — farm_id filter
- [x] `/api/dashboard/customer-mix` — farm_id filter
- [x] `/api/sales/weekly-breakdown` — farm_id filter, financial access stripping
- [x] `/api/sales/price-landscape` — farm_id filter, financial access stripping
- [x] `/api/remittances` — financial access stripping (remittances are grower-level, not farm-level)

### Grower Admin User Management
- [x] `app/api/grower-portal/admin/users/route.ts` — GET (list grower's users), POST (create user with Auth + module_access), PATCH (update farm/menu/financial config), DELETE (deactivate)
- [x] `app/api/grower-portal/admin/farms/route.ts` — GET (list grower's farms), POST (hub admin create farm manually)
- [x] `app/(grower-portal)/settings/users/page.tsx` — full user management page with add/edit dialogs, farm checkboxes, menu items, per-page financial toggles, deactivate
- [x] Settings page — grower admin links section with "User Management" card

### FreshTrack Sync Updates
- [x] Farm ID resolution during sync (freshtrack_farm_id → farms.id)
- [x] Farm lookup map loaded alongside grower map in sync-freshtrack route

### Hub Admin Updates
- [x] Module assignment POST defaults: `farm_ids: null`, `financial_access` auto-populated per role
- [x] User edit page: grower dropdown shown for both `grower` and `grower_admin` roles, info text for grower_admin

### Seed Data
- [x] 5 sample farms across 2 growers (Tully River Block A/B, Lakeland Station, Mission Beach Farm, El Arish Property)

### Architecture Decisions
- **Farm-level access:** Farms belong to growers. A user's `farm_ids` in module_access config controls which farms they see. null = all farms (admin/staff/grower_admin default). Array = specific farms only. Single-farm users get a flat experience (no farm switcher).
- **Financial access:** Per-menu-item boolean in `financial_access` config. When false, API routes strip monetary fields from responses (replaced with null, not 0). UI shows "—" or "Restricted" for null financial values.
- **Grower admin role:** New role `grower_admin` sits between staff and grower. Can manage users within their own grower entity from the grower subdomain (/settings/users). Cannot see other growers, access hub admin, or change their own role.
- **Farm selector:** Appears in the portal shell top bar (both mobile and desktop). Only shown when user has 2+ farms. "All farms" = consolidated view. Portal data context provides `selectedFarmId` and `financialAccess` to child pages.
- **Subdomain routing:** One Next.js app, one Vercel deployment serving two subdomains. Portal mode detected in middleware via `request.headers.get("host")`. `lib/subdomain.ts` provides `getPortalMode()` used by middleware (server-side), login page (client-side via `window.location.hostname`), and server components (via `headers().get("host")`). Grower subdomain restricts to email/password auth and grower-portal module only. Hub subdomain restricts to Microsoft SSO and allows all modules. Localhost shows everything for development. Env vars `NEXT_PUBLIC_GROWER_DOMAIN` and `NEXT_PUBLIC_HUB_DOMAIN` allow custom domain overrides without code changes.

### File Structure
```
supabase/migrations/00004_farms_and_grower_admin.sql — Farms table, farm_id columns, RLS, get_portal_farm_ids()
lib/portal-access.ts                                  — Shared API access context (growerId, farmIds, financialAccess)
lib/financial-filter.ts                               — stripFinancials() + getPageNameFromPath()
hooks/use-farm-context.ts                             — Client farm context hook (farms, selectedFarmId, switcher logic)
components/farm-selector.tsx                          — Farm dropdown selector component
components/portal-shell.tsx                           — Updated with PortalDataContext (farm + financial)
app/api/grower-portal/admin/users/route.ts            — Grower admin user CRUD API
app/api/grower-portal/admin/farms/route.ts            — Farm list/create API
app/(grower-portal)/settings/users/page.tsx           — Grower admin user management page
```

### Remaining
- [ ] Hub admin modules page
- [ ] Forecasting page
- [ ] Orders page / Dispatch tracking / Stock on hand
- [ ] Dashboard page: pass selectedFarmId to API calls from usePortalData() context
- [ ] Remittances detail: financial access filtering on detail API

---

## Deployment Checklist

1. Push migrations to Supabase: `npx supabase db push`
2. Create "documents" storage bucket in Supabase dashboard (private, not public)
3. Configure Microsoft Entra ID provider in Supabase Auth → Providers → Azure
4. Set all env vars in Vercel project settings (see `.env.local.example`), including:
   - `NEXT_PUBLIC_GROWER_DOMAIN=grower.mackaysmarketing.com.au`
   - `NEXT_PUBLIC_HUB_DOMAIN=hub.mackaysmarketing.com.au`
5. Add both domains in Vercel project settings → Domains:
   - `grower.mackaysmarketing.com.au`
   - `hub.mackaysmarketing.com.au`
6. Configure DNS: CNAME records for both subdomains → `cname.vercel-dns.com`
7. Deploy to Vercel
8. Create first `hub_admin` user (insert into `hub_users` with `hub_role: 'hub_admin'`)
9. Brand Supabase Auth emails with Mackays template (Auth → Email Templates)

## Post-launch

- Introspect FreshTrack `v_power_bi_*` views and update `sync_config` mappings (`SELECT * FROM v_power_bi_xxx LIMIT 1`)
- Confirm NetSuite RCTI record type with finance team (`vendorBill` vs `vendorCredit` vs custom)
- Verify Vercel static IPs for FreshTrack RDS whitelisting (Vercel → Settings → Security)
- Test end-to-end sync with real data (trigger manual sync from Sync Status page)
- Mobile QA pass — test all pages on iPhone/Android at 375px and 768px breakpoints
- Set up monitoring/alerting for sync failures (Vercel → Monitoring or external: Datadog, PagerDuty)
- Wire up `usePortalData().selectedFarmId` in dashboard/sales pages for farm-level filtering in client
- Test grower_admin user creation flow end-to-end
