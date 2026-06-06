# MM-Hub — Progress Tracker

> ## ⚠️ HISTORICAL — superseded by [HANDOFF.md](./HANDOFF.md)
>
> Phases 1–7 below describe the **pre-rebuild** state. The foundation has since
> been replaced (see commits on `sprint-0-foundation`):
>
> - The two-axis access model (`farms` + `rcti_recipients`) replaced the
>   single-axis `growers`-only model. `growers` is now a backward-compat view.
> - The wide-open RLS in prod was replaced with real group + axis-scoped RLS
>   (migrations 00005, 00007, 00009; helpers live in `private` schema).
> - The broken NetSuite REST sync is **gated** behind `NETSUITE_SYNC_ENABLED`.
>   RCTIs are served via on-demand PDF upload (`rcti_documents`, migration 00006)
>   pending a verified raw-data export.
> - `/api/remittances` and the `RemittanceDetail` component referenced below
>   were **removed**. Use `/api/rcti-documents` and the new master/detail page.
> - The Dashboard null-crash, switcher "All growers" label, sync-status
>   `ended_at`, and admin `region` column bugs documented here are fixed.
>
> Read [HANDOFF.md](./HANDOFF.md) for the current architecture, what works
> end-to-end, what's deferred, and the subtle traps recorded. Treat this file
> as a historical record of the pre-rebuild phases.

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

## Phase 7: Grower Groups & Access Control Restructure (COMPLETE)

### Data Model Change
- OLD: `growers` (businesses) → `farms` (sub-units, synced from FreshTrack) — WRONG assumption
- NEW: `grower_groups` (parent businesses, Mackays-side only) → `growers` (individual farms/FreshTrack entities)
- Each row in `growers` IS a farm (one FreshTrack entity = one farm)
- `grower_groups` is a Mackays admin concept — hub admin creates groups and assigns growers to them
- `farms` table, `farm_id` columns, `get_portal_farm_ids()` — all REMOVED

### Database (migration 00004 — rewritten)
- [x] `grower_groups` table — parent business grouping (name, code, abn, contact info, address)
- [x] `grower_group_id` column added to `growers` table (FK to grower_groups)
- [x] RLS policies: hub admin manages all, portal staff reads all, grower reads own group, service role full access
- [x] `get_portal_grower_group_id()` helper — returns user's grower_group_id from module_access config
- [x] `get_portal_grower_ids()` helper — returns accessible grower UUIDs (null = all in group)
- [x] Grower group member RLS: users see growers in their group (grower_admin sees all, grower user filtered by grower_ids config)
- [x] Grower admin RLS for module_access — can read users in same grower_group

### Access Control Model
- [x] `GrowerPortalConfig`: `grower_group_id` (which group), `grower_ids` (null = all, array = specific), `financial_access`, `capabilities`
- [x] `GrowerPortalContext`: `growerGroupId`, `growerIds`, `financialAccess`, `moduleRole`, `capabilities`, `menuItems`
- [x] `lib/portal-access.ts` — `getPortalAccessContext()` + `getGrowerFilter()` shared helpers for API routes
- [x] `lib/financial-filter.ts` — `stripFinancials()` recursively nulls monetary fields

### Grower Context & Switcher
- [x] `hooks/use-grower-context.ts` — fetches accessible growers (filtered by grower_group_id + grower_ids), manages selectedGrowerId state
- [x] `components/grower-switcher.tsx` — dropdown with "All growers" + individual grower names with region/code
- [x] `components/portal-shell.tsx` — provides `PortalDataContext` (selectedGrowerId, financialAccess) via React context

### API Grower Filtering & Financial Access
- [x] `/api/dashboard/stats`, `/volume`, `/customer-mix` — grower_id filter via getGrowerFilter()
- [x] `/api/sales/weekly-breakdown`, `/price-landscape` — grower_id filter, financial access stripping
- [x] `/api/remittances` — financial access stripping (grower-level)

### Grower Admin User Management
- [x] `app/api/grower-portal/admin/users/route.ts` — scoped by grower_group_id (was grower_id), grower_ids validation
- [x] `app/api/grower-portal/admin/growers/route.ts` — lists growers in admin's grower_group (replaced farms route)
- [x] `app/(grower-portal)/settings/users/page.tsx` — grower checkboxes (was farm checkboxes), menu items, financial toggles

### Hub Admin Updates
- [x] `app/api/hub-admin/grower-groups/route.ts` — NEW: GET list all, POST create grower_group
- [x] `app/api/hub-admin/growers/route.ts` — updated: returns grower_group_id
- [x] Module assignment POST defaults: `grower_ids: null`, `financial_access` auto-populated per role
- [x] User edit page: "Grower Group" dropdown (was "Grower"), grower checkboxes for grower role, info text for grower_admin

### Seed Data
- [x] 2 sample grower_groups (North Queensland Banana Co, Tropical Fruit Partners)
- [x] 5 sample growers assigned to groups (was farms)

### Architecture Decisions
- **Grower groups:** Hub admin creates grower_groups (parent businesses) and assigns growers (FreshTrack entities) to them. grower_groups table is Mackays-side only — not synced from FreshTrack. Each grower (farm) can belong to one grower_group.
- **Grower-level access:** A user's `grower_ids` in module_access config controls which growers they see within their group. null = all growers in group (admin/staff/grower_admin default). Array = specific growers only.
- **Financial access:** Per-menu-item boolean in `financial_access` config. When false, API routes strip monetary fields from responses (replaced with null, not 0).
- **Grower admin role:** `grower_admin` manages users within their grower group from /settings/users. Has `manage_grower_users` and `view_all_growers` capabilities.
- **Grower switcher:** Appears in portal shell top bar when user has 2+ accessible growers. "All growers" = consolidated view.

### File Structure
```
supabase/migrations/00004_farms_and_grower_admin.sql — grower_groups table, grower_group_id column, RLS, helper functions
lib/portal-access.ts                                  — Shared API access context (growerGroupId, growerIds, financialAccess)
lib/financial-filter.ts                               — stripFinancials() + getPageNameFromPath()
hooks/use-grower-context.ts                            — Client grower context hook (growers, selectedGrowerId, switcher logic)
components/grower-switcher.tsx                         — Grower dropdown selector for portal users
components/grower-selector.tsx                         — Admin grower selector (for staff/admin picking any grower)
components/portal-shell.tsx                            — PortalDataContext (selectedGrowerId + financialAccess)
app/api/grower-portal/admin/users/route.ts             — Grower admin user CRUD (scoped by grower_group_id)
app/api/grower-portal/admin/growers/route.ts           — Grower list for admin (scoped by grower_group_id)
app/api/hub-admin/grower-groups/route.ts               — Hub admin grower_groups CRUD
app/(grower-portal)/settings/users/page.tsx            — Grower admin user management page
app/(hub-admin)/hub-admin/users/[id]/page.tsx          — Hub admin user edit with grower group selector
```

### Grower Switcher Wiring (COMPLETE)
- [x] Dashboard page — passes `selectedGrowerId` as `growerId` query param to all 4 API routes
- [x] Sales page — passes `selectedGrowerId` to weekly-breakdown and price-landscape API routes
- [x] Remittances page — passes `selectedGrowerId` to remittances list API
- [x] All API routes: `getGrowerFilter(accessCtx, growerId)` — unified grower filtering (removed redundant `eq("grower_id")` calls)
- [x] `/api/dashboard/recent-orders` — added access control via `getPortalAccessContext()` + `getGrowerFilter()`
- [x] `/api/remittances/[id]` — added grower access validation (403 if unauthorized) + financial access filtering via `stripFinancials()`
- [x] `/api/remittances` list — added grower group filtering via `getGrowerFilter()`

### Hub Admin Modules Page (COMPLETE)
- [x] `/api/hub-admin/modules` — GET all modules with user counts per role, assigned user list
- [x] `/hub-admin/modules` — Expandable module cards with role breakdown (user counts, capabilities), menu items, assigned users table

### Grower Portal Data Pages (COMPLETE)
- [x] Orders page — filterable/searchable table with status pills, fulfilment %, time range selector, grower switcher support
- [x] Dispatch tracking — summary cards (loads/pallets/weight), status filter, carrier/truck info table
- [x] Stock on hand — summary cards (lines/qty/weight/locations), searchable inventory table
- [x] Forecasting — 4 KPI cards (avg volume, avg revenue, stock on hand, weeks of cover), 26-week volume bar chart with avg reference line, pending orders table
- [x] Menu items added to `lib/modules.ts` for Orders, Dispatch, Stock (with ClipboardList, Truck, Warehouse icons)
- [x] All roles updated with new default menu items
- [x] Sidebar icon map updated in `components/app-sidebar.tsx`
- [x] All 4 API routes with `getPortalAccessContext()`, `getGrowerFilter()`, and `stripFinancials()` support

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

## Phase 8: Documentation & Deployment Readiness (COMPLETE)

### Deployment Runbook (COMPLETE)
- [x] `DEPLOYMENT_RUNBOOK.md` — comprehensive deployment guide covering:
  - Prerequisites (accounts, access, tools)
  - First-time deployment (Supabase setup, Azure AD, Vercel project, first admin user, branded emails)
  - Routine deployments (code-only vs migration deploys, preview deployments)
  - Rollback procedures (instant Vercel rollback, DB recovery, emergency cron disable)
  - Environment variables reference (all 12 vars with sources)
  - Cron jobs (FreshTrack 15min, NetSuite 30min) — monitoring + manual triggers
  - DNS & domain setup (CNAME records, SSL, RDS IP whitelisting)
  - Database migration workflow (running, creating, updating field mappings)
  - Post-deploy verification checklist (smoke tests, API health, cron checks)
  - Troubleshooting tables (build, runtime, sync, domain issues)
  - Contacts & escalation matrix
  - Architecture diagram (ASCII)

### Project Documentation (COMPLETE)
- [x] `ABOUT.md` — project overview, tech stack, features, architecture summary
- [x] `PROGRESS.md` — full progress tracker (this file)
- [x] `.env.local.example` — all env vars documented with comments

### Issue Tracking (COMPLETE)
- [x] Beads issue tracking initialised (`.beads/` directory)
- [x] Dolt-backed version control for issues

---

## Post-launch

- [ ] Introspect FreshTrack `v_power_bi_*` views and update `sync_config` mappings (`SELECT * FROM v_power_bi_xxx LIMIT 1`)
- [ ] Confirm NetSuite RCTI record type with finance team (`vendorBill` vs `vendorCredit` vs custom)
- [ ] Verify Vercel static IPs for FreshTrack RDS whitelisting (Vercel → Settings → Security)
- [ ] Test end-to-end sync with real data (trigger manual sync from Sync Status page)
- [ ] Mobile QA pass — test all pages on iPhone/Android at 375px and 768px breakpoints
- [ ] Set up monitoring/alerting for sync failures (Vercel → Monitoring or external: Datadog, PagerDuty)
- [ ] Wire up `usePortalData().selectedGrowerId` in dashboard/sales pages for grower-level filtering in client
- [ ] Test grower_admin user creation flow end-to-end
- [ ] Hub admin: dedicated grower_groups management page (currently managed via user edit)
- [ ] RCTI PDF retrieval (deferred — requires NetSuite file cabinet access or PDF generation endpoint)
