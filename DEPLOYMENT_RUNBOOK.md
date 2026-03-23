# MM-Hub Deployment Runbook

> **Platform:** Next.js 14 (standalone) on Vercel (syd1) + Supabase + FreshTrack RDS + NetSuite REST API
>
> **Subdomains:** `grower.mackaysmarketing.com.au` (grower portal) / `hub.mackaysmarketing.com.au` (hub admin)

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [First-Time Deployment](#2-first-time-deployment)
3. [Routine Deployments](#3-routine-deployments)
4. [Rollback Procedures](#4-rollback-procedures)
5. [Environment Variables](#5-environment-variables)
6. [Cron Jobs](#6-cron-jobs)
7. [DNS & Domain Setup](#7-dns--domain-setup)
8. [Database Migrations](#8-database-migrations)
9. [Post-Deploy Verification](#9-post-deploy-verification)
10. [Troubleshooting](#10-troubleshooting)
11. [Contacts & Escalation](#11-contacts--escalation)

---

## 1. Prerequisites

### Accounts & Access

| Service | Required Access | Where to Get It |
|---------|----------------|-----------------|
| Vercel | Team member (deploy access) | Vercel dashboard |
| Supabase | Project owner or editor | Supabase dashboard |
| GitHub | Push access to `mackaysmarketing/mm-hub` | GitHub org settings |
| FreshTrack RDS | Read-only connection string | FreshTrack admin / AWS console |
| NetSuite | TBA credentials (consumer key/secret, token ID/secret) | NetSuite > Setup > Integration |
| Microsoft Entra ID | App registration (client ID/secret/tenant) | Azure portal |
| Domain registrar | DNS management for `mackaysmarketing.com.au` | Domain provider |

### Tools

- Node.js 18+
- `npx supabase` CLI (`npm i -g supabase`)
- Vercel CLI (optional: `npm i -g vercel`)
- Git

---

## 2. First-Time Deployment

Follow these steps **in order**. Each step has a verification check.

### 2.1 Supabase Project Setup

```bash
# Link local project to Supabase
npx supabase link --project-ref <PROJECT_REF>

# Push all migrations (00001 through 00004)
npx supabase db push
```

**Verify:** In Supabase SQL Editor, run:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```
Expected tables: `consignments`, `dispatch_loads`, `documents`, `grower_groups`, `growers`, `hub_users`, `module_access`, `orders`, `qa_assessments`, `qa_audits`, `qa_category_scores`, `remittance_charges`, `remittance_line_items`, `remittances`, `stock_items`, `sync_config`, `sync_logs`

### 2.2 Supabase Storage

1. Go to Supabase dashboard > Storage
2. Create a new bucket named **`documents`**
3. Set to **Private** (not public)
4. Leave default file size limit (50MB) or reduce to 10MB

**Verify:** Bucket appears in Storage > Buckets list

### 2.3 Microsoft Entra ID (Azure AD)

1. Go to Supabase dashboard > Authentication > Providers > Azure
2. Enable the Azure provider
3. Enter:
   - **Client ID** from Azure app registration
   - **Client Secret** from Azure app registration
   - **Azure Tenant URL:** `https://login.microsoftonline.com/<TENANT_ID>`
4. Copy the **Callback URL** from Supabase and add it to Azure app registration > Redirect URIs

**Verify:** Hub login page shows Microsoft SSO button and redirects to Azure login

### 2.4 Vercel Project Setup

```bash
# From project root
vercel link
```

Or create the project in Vercel dashboard:
1. Import the GitHub repo `mackaysmarketing/mm-hub`
2. Framework preset: **Next.js**
3. Root directory: `.` (default)
4. Build command: `next build` (default)
5. Output directory: `.next` (default)

### 2.5 Environment Variables

Set **all** variables from section 5 in Vercel > Project Settings > Environment Variables.

Set for: **Production**, **Preview**, and **Development** as appropriate.

### 2.6 Domain Configuration

See section 7 for full DNS and domain setup.

### 2.7 Deploy

```bash
git push origin main
```

Vercel auto-deploys on push to `main`.

### 2.8 Create First Admin User

After deploy, create the first hub admin user:

1. Sign up via the hub subdomain (Microsoft SSO)
2. In Supabase SQL Editor:

```sql
-- Find the user's auth ID
SELECT id, email FROM auth.users WHERE email = 'admin@mackaysmarketing.com.au';

-- Insert hub_users record
INSERT INTO hub_users (id, full_name, email, hub_role)
VALUES ('<AUTH_USER_ID>', 'Admin Name', 'admin@mackaysmarketing.com.au', 'hub_admin');
```

**Verify:** Log in at `hub.mackaysmarketing.com.au` — should see hub admin dashboard

### 2.9 Brand Auth Emails

1. Supabase dashboard > Authentication > Email Templates
2. Customise Confirm Signup, Magic Link, Reset Password templates with Mackays branding

---

## 3. Routine Deployments

### Standard Deploy (code-only, no migrations)

```
1. Merge PR to main           -> Vercel auto-deploys
2. Monitor build in Vercel     -> Dashboard > Deployments
3. Verify deployment           -> See section 9
```

Build time: ~60-90 seconds typical.

### Deploy with Database Migration

```
1. Push migration to Supabase  -> npx supabase db push
2. Verify migration applied     -> Check tables/columns in SQL Editor
3. Merge PR to main            -> Vercel auto-deploys
4. Verify deployment            -> See section 9
```

**Always push migrations before deploying code that depends on them.**

### Preview Deployments

Every PR gets an automatic Vercel preview URL. Preview deployments use the same environment variables as production unless overridden.

---

## 4. Rollback Procedures

### Code Rollback (Vercel)

1. Go to Vercel dashboard > Deployments
2. Find the last known-good deployment
3. Click the three-dot menu > **Promote to Production**

This is instant — no rebuild required.

### Database Rollback

Supabase does not have built-in migration rollback. Options:

1. **Write a reverse migration** — create a new migration that undoes the changes
2. **Point-in-time recovery** — Supabase Pro plan supports PITR (contact Supabase support)
3. **Restore from backup** — Supabase dashboard > Database > Backups

**Always test migrations on a Supabase branch or staging project first.**

### Emergency: Disable Cron Jobs

If a sync job is causing issues, disable it immediately:

1. Remove the cron entry from `vercel.json`
2. Push to `main`
3. Or: temporarily change the `CRON_SECRET` env var so auth fails

---

## 5. Environment Variables

| Variable | Required | Where to Get It |
|----------|----------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase > Settings > API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase > Settings > API |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase > Settings > API (secret) |
| `FRESHTRACK_DATABASE_URL` | Yes | FreshTrack admin (PostgreSQL conn string) |
| `NETSUITE_ACCOUNT_ID` | Yes | NetSuite > Setup > Company > Company Information |
| `NETSUITE_CONSUMER_KEY` | Yes | NetSuite > Setup > Integration |
| `NETSUITE_CONSUMER_SECRET` | Yes | Same as above |
| `NETSUITE_TOKEN_ID` | Yes | NetSuite > Setup > Users/Roles > Access Tokens |
| `NETSUITE_TOKEN_SECRET` | Yes | Same as above |
| `NEXT_PUBLIC_GROWER_DOMAIN` | Yes | `grower.mackaysmarketing.com.au` |
| `NEXT_PUBLIC_HUB_DOMAIN` | Yes | `hub.mackaysmarketing.com.au` |
| `CRON_SECRET` | Yes | Generate: `openssl rand -hex 32` |

### Generating CRON_SECRET

```bash
openssl rand -hex 32
```

Set this in Vercel and keep it safe — it protects all `/api/cron/*` endpoints.

---

## 6. Cron Jobs

Defined in `vercel.json`:

| Job | Path | Schedule | Purpose |
|-----|------|----------|---------|
| FreshTrack Sync | `/api/cron/sync-freshtrack` | Every 15 min | Sync entities, products, consignments, orders, pallets, dispatch, charges, stock from FreshTrack RDS |
| NetSuite Sync | `/api/cron/sync-netsuite` | Every 30 min | Sync RCTIs (remittances + line items + charges) from NetSuite |

### Monitoring Sync Health

- **In-app:** Grower Portal > Settings > Sync Status (hub admin only)
- **Database:** `SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT 20;`
- **Vercel:** Functions tab > `/api/cron/*` invocation logs

### Manual Sync Trigger

From the Sync Status admin page, click "Sync Now" for either FreshTrack or NetSuite.

Or via curl:
```bash
curl -X POST https://hub.mackaysmarketing.com.au/api/cron/sync-freshtrack \
  -H "Authorization: Bearer <CRON_SECRET>"
```

---

## 7. DNS & Domain Setup

### Required DNS Records

| Subdomain | Type | Value |
|-----------|------|-------|
| `grower.mackaysmarketing.com.au` | CNAME | `cname.vercel-dns.com` |
| `hub.mackaysmarketing.com.au` | CNAME | `cname.vercel-dns.com` |

### Vercel Domain Configuration

1. Vercel dashboard > Project > Settings > Domains
2. Add `grower.mackaysmarketing.com.au`
3. Add `hub.mackaysmarketing.com.au`
4. Vercel auto-provisions SSL certificates

**Verify:** Both subdomains resolve and show valid HTTPS certificates.

### FreshTrack RDS Whitelisting

Vercel functions need network access to FreshTrack's AWS RDS instance:

1. Vercel dashboard > Project > Settings > Security > Vercel IP Addresses
2. Note the static IPs for the `syd1` region
3. Add these IPs to the FreshTrack RDS security group inbound rules (port 5432)

---

## 8. Database Migrations

### Migration Files

Located in `supabase/migrations/`:

| File | Description |
|------|-------------|
| `00001_initial_schema.sql` | Core tables, RLS policies, auth helpers |
| `00002_sync_config.sql` | Sync config table + FreshTrack step mappings |
| `00003_netsuite_sync_config.sql` | NetSuite RCTI sync config |
| `00004_farms_and_grower_admin.sql` | Grower groups, access control restructure |

### Running Migrations

```bash
# Push all pending migrations
npx supabase db push

# Check migration status
npx supabase migration list
```

### Creating New Migrations

```bash
npx supabase migration new <migration_name>
# Edit the generated file in supabase/migrations/
# Test locally, then push
```

### Updating Sync Field Mappings

Field mappings in `sync_config` are admin-configurable — no code deploy needed:

```sql
UPDATE sync_config
SET field_mappings = '{"source_col": "target_col", ...}'::jsonb
WHERE step_name = 'sync_entities' AND source = 'freshtrack';
```

---

## 9. Post-Deploy Verification

Run through this checklist after every production deploy:

### Smoke Tests

- [ ] `grower.mackaysmarketing.com.au` loads login page (email/password form, no SSO)
- [ ] `hub.mackaysmarketing.com.au` loads login page (Microsoft SSO button, no email form)
- [ ] Grower login works (email/password)
- [ ] Hub login works (Microsoft SSO)
- [ ] Dashboard loads with data (stats, charts, recent orders)
- [ ] Sales page loads (weekly breakdown table, price landscape chart)
- [ ] Remittances page loads (list + detail view)
- [ ] Navigation works (sidebar links, mobile hamburger menu)

### API Health Checks

```bash
# Sync status (public, no auth needed)
curl https://hub.mackaysmarketing.com.au/api/sync-status/latest
```

### Cron Verification

After deploy, wait for the next cron cycle and check:

```sql
SELECT source, status, records_synced, error_message, started_at
FROM sync_logs
ORDER BY started_at DESC
LIMIT 5;
```

---

## 10. Troubleshooting

### Build Failures

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| TypeScript errors | Type mismatch in new code | Fix types, push again |
| Module not found | Missing dependency | `npm install`, commit `package-lock.json` |
| Out of memory | Large build | Add `NODE_OPTIONS=--max-old-space-size=4096` env var |

### Runtime Errors

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| 500 on API routes | Missing env var | Check Vercel env vars are set for Production |
| Auth redirect loops | Supabase URL mismatch | Verify `NEXT_PUBLIC_SUPABASE_URL` matches project |
| Blank page after login | Missing `hub_users` record | Insert user record in Supabase |
| CORS errors | Domain not in allowed origins | Add domain in Supabase > Auth > URL Configuration |

### Sync Failures

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| FreshTrack connection refused | IP not whitelisted | Check RDS security group, verify connection string |
| NetSuite 401 | Token expired/invalid | Regenerate token in NetSuite |
| NetSuite 429 | Rate limited | Built-in retry handles this; reduce frequency if persistent |
| All syncs failing | `CRON_SECRET` mismatch | Verify env var matches what cron routes expect |
| 0 records synced | Field mapping mismatch | Check `sync_config` mappings against actual source columns |

### Domain Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| SSL error | DNS not propagated | Wait 24-48h, verify CNAME records |
| Wrong portal mode | Subdomain env var mismatch | Check `NEXT_PUBLIC_GROWER_DOMAIN` / `NEXT_PUBLIC_HUB_DOMAIN` |
| Hub admin 404 on grower domain | Middleware blocking correctly | Expected behaviour — hub routes blocked on grower subdomain |

---

## 11. Contacts & Escalation

| Area | Contact | Notes |
|------|---------|-------|
| Vercel platform | Vercel support (dashboard) | Check status.vercel.com first |
| Supabase | Supabase support (dashboard) | Check status.supabase.com first |
| FreshTrack RDS | FreshTrack admin | IP whitelist changes, column verification |
| NetSuite API | Mackays finance team | Record types, field names, token rotation |
| DNS changes | Domain registrar admin | CNAME record updates |
| Microsoft Entra ID | Azure AD admin | App registration, tenant config |

---

## Architecture Diagram

```
                    ┌──────────────────────────┐
                    │   Vercel (syd1 region)    │
                    │                           │
  grower.mmm.au --> │  Next.js 14 (standalone)  │ <-- hub.mmm.au
                    │                           │
                    │  Cron: FreshTrack (15min)  │
                    │  Cron: NetSuite  (30min)   │
                    └─────────┬────┬────────────┘
                              │    │
                 ┌────────────┘    └────────────┐
                 v                              v
    ┌────────────────────┐         ┌────────────────────┐
    │     Supabase       │         │  FreshTrack RDS     │
    │  (Auth, DB, Store) │         │  (read-only, SSL)   │
    └────────────────────┘         └────────────────────┘
                                            │
                                   ┌────────┘
                                   v
                          ┌────────────────┐
                          │  NetSuite REST  │
                          │  (OAuth 1.0 TBA)│
                          └────────────────┘
```
