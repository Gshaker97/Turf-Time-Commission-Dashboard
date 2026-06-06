# Turf Time Commission Dashboard — Project Memory

Context for working on this repo. Read this before changing commission math,
data access, or the database schema.

## What this is

Internal sales + commission tracker for Turf Time (artificial turf company).
Tracks deals through their lifecycle and computes per-rep commission across
multiple roles. VP/admin enter deals; reps see their own; managers/directors
see their teams.

## Stack

- Frontend: Vite + React + Tailwind, React Router, Recharts.
- Backend: self-hosted Supabase (Postgres + GoTrue + PostgREST) on Railway.
- A Google Apps Script (`scripts/Sync.gs`) syncs a commission spreadsheet into
  the `deals` table. Stored `*_amount` fields originate there.

## Roles (hierarchy, low → high)

`rep → manager → director → vp → admin`

## Database tables

`profiles`, `deals`, `payments`, `monthly_goals`, `weekly_stats`,
`app_settings`. Schema lives in `supabase/migrations/`. See @SETUP.md for full
setup + deploy steps.

## CRITICAL conventions — do not violate these

1. **"Revenue" means `baseline_revenue`, everywhere.** Never use `job_price`
   for revenue aggregates, KPIs, or rollups. `job_price` is the raw sale price
   and is only shown as a per-deal headline figure. Mixing the two was a real
   bug that made the same rep show different totals on different pages.

2. **All commission math goes through `src/utils/commission.js`.** Never
   recompute commission inline (e.g. `job_price - baseline`) in a page or
   component. That bypasses overrides and the stored `*_amount` values synced
   from the sheet. The engine is the single source of truth:
   - `repPool = job_price − baseline_revenue`, split between setter and closer.
   - Overrides = `baseline × pct` for manager/director/vp.
   - When a stored `*_amount` field is present, it WINS over the computed value.
   - `getUserCommission` sums every role a user holds on a deal and must not
     double-count when the same person is both setter and closer.
   - `getSetterCommission(deal)` returns ONLY the setter's own share (never the
     closer's portion or overrides). The Dashboard rep leaderboard uses this so
     the setter is credited full revenue but only their split commission.

3. **All data access goes through `src/lib/db.js`.** Never import `supabase`
   directly into a page or component. The gateway is demo-aware: when
   `DEMO_MODE` is on (no live DB), it serves in-memory data from
   `src/lib/demoData.js` instead of hitting Supabase. Calling Supabase directly
   white-screens demo mode.

## Database migrations — read before touching the DB

- Fresh install: run `001_schema.sql`, `002_rls.sql`, `003_seed.sql`,
  `005_weekly_stats.sql`, `006_settings.sql`, then `007_backfill_pay_dates.sql`.
- **Already-deployed DB (the live one): run `004_patch.sql`, `005_weekly_stats.sql`,
  `006_settings.sql`, then `007_backfill_pay_dates.sql`.** All idempotent. `004` adds the
  `deduction_amount` / `deduction_note` columns and re-applies the hardened RLS
  policies; `005` adds the `weekly_stats` table (estimates per rep per week)
  behind the Team → Weekly Stats tab; `006` adds the `app_settings` table
  (admin-editable statuses / payment methods / offices), the `payment_method`
  column on `deals`, and **drops the fixed `deals.status` CHECK** so statuses
  are admin-configurable; `007` is a one-time backfill of `deals.pay_date` from
  `install_date` (Friday following the install week; only fills rows where
  `pay_date` is null, so it never clobbers a hand-set value); `008` adds the
  `deals.checklist` jsonb column backing the inline new-deal checklist on the
  Deals page; `009` adds the `competitions` table (sales contests; standings
  computed on the frontend, VP/admin-managed); `010` adds
  `deals.financed_amount` + `deals.dealer_fee_pct` (financing dealer fee,
  treated as a deduction = financed × fee% in the commission engine); `011`
  adds `deals.deduction_paid_by` (`closer` default | `setter` | `split`) —
  who absorbs the deduction on a split deal; `012` adds
  `deals.deduction_split_pct` (setter's share when `deduction_paid_by='split'`,
  fraction, default 0.5). Do not re-run `001`/`002` against a populated database.

## Security notes (already fixed — keep them fixed)

- `profiles_update_self` has a `WITH CHECK` plus a `guard_profile_columns()`
  trigger so non-admins cannot change `role`, `email`, `auth_id`, hierarchy,
  `active`, or timestamps. Do not loosen this.
- `deals_update` has a `WITH CHECK` so a rep cannot reassign a deal off
  themselves.

## Demo mode

Toggle via env (`DEMO_MODE` / `VITE_*` — see @.env.example). Demo login works
offline with any seeded account, password `TurfTime2026!`. Demo data is the
real Turf Time roster (23 people) with stable ids (`u-keaton`, `u-garrison`,
etc.) mirroring the seed file.

## Deal statuses & other config lists (admin-editable)

Deal statuses, payment methods, and offices are NOT hard-coded anymore — they
live in `app_settings` and are edited live from **Admin → Settings**. Read them
through `useSettings()` (`src/contexts/SettingsContext.jsx`):
`statusLabels`, `statusColor(label)`, `paymentMethods`, `offices`. Never
re-introduce a hard-coded status/office/payment list in a page or component.
The default seed is `Deal Review`, `Pending Install`, `Pay Finalized`, `Paid`,
`Sales Issue` (each with a color). Because statuses are configurable, there is
no longer a DB CHECK on `deals.status` (see `006_settings.sql`).

## Known low-severity items (not yet addressed)

- `getMonths` / `monthRange` slice dates in UTC, which can be off-by-one at
  month boundaries for users in negative-offset timezones. Left as-is.

## Build / verify

- `npm install && npm run build` should pass with zero warnings.
- New Deal entry is VP/admin only and writes `deduction_amount` /
  `deduction_note` — those columns must exist (they do after `004_patch.sql`).
