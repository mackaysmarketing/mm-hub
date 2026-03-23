# MM-Hub

Internal data platform for **Mackays Marketing**, an Australian banana and tropical fruit marketing company. MM-Hub aggregates data from two external systems — FreshTrack (packhouse/logistics) and NetSuite (finance) — and presents it to growers (farmers) and internal staff through role-based portal interfaces.

## What it does

- **Grower Portal** — Growers log in to see their sales, pricing, remittances (RCTI payments), QA compliance, and documents. Access is scoped: each grower user sees only the farms (growers) they're assigned to.
- **Hub Admin** — Mackays internal staff manage users, assign module access, create grower groups (business entities that own one or more farms), and monitor sync health.
- **Automated Sync** — Cron jobs pull data from FreshTrack (every 15 min) and NetSuite (every 30 min) into Supabase, using admin-configurable field mappings stored in `sync_config`.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router, standalone output) |
| Auth | Supabase Auth (Microsoft SSO for staff, email/password for growers) |
| Database | Supabase (Postgres) with Row-Level Security |
| UI | Tailwind CSS, shadcn/ui, Recharts |
| State | TanStack Query (React Query) |
| External data | FreshTrack (Postgres RDS, read-only) and NetSuite (REST API, OAuth 1.0 TBA) |
| Hosting | Vercel (Sydney region) |

## Data model (key tables)

```
grower_groups          Parent business entities (Mackays-side concept, not in FreshTrack)
  └─ growers           Individual farms — each is one FreshTrack entity
       └─ ft_*         Synced FreshTrack data (consignments, orders, pallets, dispatch, etc.)
       └─ remittances  Synced NetSuite RCTIs with line items and charges

hub_users              Internal staff accounts with hub_role (hub_admin | staff)
module_access          Per-user module assignments with role + config (grower_group_id, grower_ids, etc.)
sync_config            Admin-editable field mappings for FreshTrack and NetSuite sync steps
sync_logs              Audit trail of every sync run
```

## Access control

Two-tier model:

1. **Hub level** — `hub_users.hub_role` controls platform-wide permissions (hub_admin or staff).
2. **Module level** — `module_access` grants per-module roles with config:
   - `admin` / `staff` — Mackays internal users, see all growers
   - `grower_admin` — Grower-side admin, manages users within their grower group
   - `grower` — Individual grower user, restricted to specific growers via `grower_ids`

Financial visibility is controlled per menu item via `financial_access` in the module config.

## Subdomain routing

| Subdomain | Mode | Auth method | Scope |
|-----------|------|-------------|-------|
| `grower.mackaysmarketing.com.au` | Grower | Email/password | Grower portal only |
| `hub.mackaysmarketing.com.au` | Hub | Microsoft SSO | Full platform |
| `localhost` | Dev | Both | Both portals |

## Project structure

```
app/
  (auth)/              Login, callback, error pages
  (grower-portal)/     Grower-facing pages (dashboard, sales, remittances, documents, QA, settings)
  (hub-admin)/         Hub admin pages (user management, module config)
  api/                 API routes
    cron/              FreshTrack + NetSuite sync cron handlers
    dashboard/         Dashboard stats, volume, customer mix
    sales/             Weekly breakdown, price landscape
    remittances/       Remittance list + detail
    documents/         Upload, download, list
    qa/                QA overview
    grower-portal/     Grower admin APIs (users, growers, QA entry, sync status)
    hub-admin/         Hub admin APIs (users, grower-groups, growers)
    sync-status/       Data freshness endpoint

components/            Shared UI components (sidebar, portal shell, grower switcher, charts, etc.)
  ui/                  shadcn/ui primitives (button, card, dialog, table, etc.)

hooks/                 React hooks (grower context, mobile detection, user session)
lib/                   Server utilities (auth, Supabase clients, sync, portal access, subdomain detection)
types/                 TypeScript type definitions (module configs, contexts)

supabase/
  migrations/          SQL migrations (00001–00004)
  seed.sql             Sample data for development
```

## Current status

Phases 1–7 complete. See `PROGRESS.md` for detailed status and remaining work items.
