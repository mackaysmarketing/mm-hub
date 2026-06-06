# MM-Hub

Internal data platform for **Mackays Marketing**. Aggregates data from
FreshTrack (packhouse / logistics) and NetSuite (finance) and presents it to
growers and internal staff through role-based portal interfaces.

## Read first

| If you are… | Start here |
|---|---|
| **New to the codebase** | [`HANDOFF.md`](HANDOFF.md) — current architecture, what works end-to-end, what's deferred, traps recorded. |
| **Spinning up the rebuild on a fresh DB** | [`FOUNDATION-RECONCILIATION.md`](FOUNDATION-RECONCILIATION.md) — why the repo and the live Supabase had forked, and the source-of-truth decision. |
| **Looking for the high-level "what does it do"** | [`ABOUT.md`](ABOUT.md) — product summary + tech stack. |
| **An agent picking up work** | [`AGENTS.md`](AGENTS.md) — bd issue-tracking + "Landing the Plane" workflow. |
| **Deploying** | [`DEPLOYMENT_RUNBOOK.md`](DEPLOYMENT_RUNBOOK.md). |

> **Historical reference only:** `PROGRESS.md` and `grower_portal/Mackays-Grower-Portal-Spec-v2.md` describe the **pre-rebuild** state — useful as a record of original intent, but do not use them as architectural guidance. HANDOFF.md is the current source of truth.

## Stack

Next.js 14 (App Router, standalone) · React 18 · Supabase (Postgres + Auth + Storage + RLS) · TanStack Query 5 · shadcn/ui · Recharts · `pg` Pool for FreshTrack RDS · `oauth-1.0a` for NetSuite TBA · Vercel (Sydney).

## Quick checks

```bash
npm install        # one-time
npm run dev        # local Next.js dev server
npm test           # vitest unit tests (17 currently)
npm run typecheck  # tsc --noEmit
npm run lint       # next lint
npm run build      # production build
```

CI runs `typecheck + lint + tests` on every PR to `main`
(see `.github/workflows/ci.yml`).

Production health probe: `GET /api/health` → `{status:"ok", db:"ok"}` or 503.

## Project structure

```
app/                Next.js App Router (auth, grower portal, hub admin, /api/*)
components/         shared UI + portal shell + hub-admin sections
hooks/              React hooks (grower context, mobile, user session)
lib/                server utilities (auth, portal-access, financial-filter,
                    supabase clients, freshtrack, netsuite, modules,
                    subdomain, sync-utils)
types/              TypeScript type definitions
supabase/
  migrations/       SQL migrations 00001-00009
  fixtures/         the LMB Cooroo RCTI sample as extracted text
  tests/            RLS isolation suite (run manually against a branch)
.github/workflows/  CI gate (typecheck + lint + tests)
.beads/             bd issue tracker (Dolt-backed)
.claude/            local Claude Code settings
```

## Module access in one screen

A user gets module access through `module_access.config` keys:
`grower_group_id` (tenant), `grower_ids` (farm-axis scope; null = all farms in group),
`recipient_ids` (financial-axis scope; null = all recipients in group),
`allowed_menu_items` (server-enforced page permissions), `financial_access` (per-page money toggle),
`capabilities` (named permissions).

RLS in the DB is the authoritative tenant boundary (helpers live in the
`private` schema). App-layer filters are defense-in-depth. See HANDOFF.md for
the full table.
