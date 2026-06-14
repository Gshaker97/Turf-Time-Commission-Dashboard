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
- A Google Apps Script (`scripts/ScheduleSync.gs`, entry `schSync`, 1-min
  trigger) imports deals from the ArcSite Jobs/Schedule spreadsheet.
  `scripts/Backup.gs` does daily Drive backups. `scripts/Sync.gs` is legacy —
  see the sync section below.

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

4. **Canceled deals never count in aggregates.** A deal whose `status` is
   `Canceled` (or `Cancelled`) is excluded from every roll-up — revenue, KPIs,
   the rep leaderboard, team breakdown, competitions, commissions, and payroll —
   via `isCanceled` / `activeDeals` in `src/utils/commission.js`. It still
   appears on the Deals page (and struck-through in the competition drill-down)
   so it can be moved back to another status, which makes it count again.

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
  fraction, default 0.5); `013` adds `profiles.is_admin` and makes `my_role()`
  report `admin` for flag-holders — **site access (admin) is now separate from
  sales title (`role`)**, so someone can be e.g. VP (title/overrides) **and**
  Admin (access). The guard trigger protects `is_admin` from self-escalation;
  `014` adds `deals.notes` (free-text, the collapsible notes box on the Deals
  page); `015` adds competition goal/credit params (`goal_mode`+`goal_target`
  for target-based contests with a progress bar, `credit_mode`+`credit_split_pct`
  for how setter/closer are credited — see `src/utils/competition.js`); `016`
  adds `profiles.ghost` (a ghost user's deals still count in every total, but
  their name is hidden from non-admins on leaderboards/competitions/team
  rows/rep filters — gated by `isAdmin`; the guard trigger also protects
  `ghost`); `017` adds `deals.commission_verified` (the gold leadership sign-off
  seal on the Deals page + the Payroll "To verify" worklist); `018` adds
  `weekly_stats.self_gen_estimates` + `lead_estimates` (Weekly Stats split into
  self-gen vs lead estimates/closes/close-rate; old `estimates` kept as the sum);
  `019` adds the `deal_history` table + a SECURITY DEFINER trigger on `deals`
  logging every INSERT/UPDATE diff (any path — app, sync, SQL) with the editor's
  profile id (null = service role); append-only, no client write policies; shown
  in the edit modal's collapsible "Edit history" panel; `020` adds
  `client_errors` (frontend crash reports — ErrorBoundary + global handlers via
  `logClientError`, read by the Watchdog); `021` adds `deal_notes` (append-only
  per-deal comment threads, replaces the single `deals.notes` text which now
  displays as a legacy "Original note") and `notifications` (the NavBar bell —
  posting a note notifies the deal's CLOSER + admins only, minus the author
  (setters/managers read threads but aren't pinged); users read/mark-read only their own rows;
  clicking a bell item deep-links to `/deals?note=<dealId>` which opens the
  thread); `022` adds note editing + admin delete: authors edit their own
  notes (RLS), a BEFORE UPDATE trigger snapshots the prior text into
  `deal_notes.edits` + stamps `edited_at` (tamper-proof, and author/deal/
  created_at are frozen), and only admins (`my_role()='admin'`) may delete. Do not re-run `001`/`002` against a populated database.

## User management (Admin page)

- **Create login / reset password** for roster members happens on Admin → Users,
  powered by `scripts/UserAdmin.gs` (an Apps Script web app holding the service
  key). The frontend (`userAdmin()` in `db.js`) calls it with the admin's own
  Supabase access token — the endpoint verifies the caller is an admin, so
  there's NO secret in the browser. Set `VITE_USER_ADMIN_URL` to the web-app URL
  to enable; unset = those buttons hide and you create logins in Studio.
  Already-linked users are untouched.
- **Deactivation:** the Active toggle flips `profiles.active`. A deactivated
  user is signed out and blocked at login (`AuthContext.fetchProfile` checks
  `active`), but **all their deals/stats stay and still count** — never filter
  aggregates by `active`. When `VITE_USER_ADMIN_URL` is set, deactivating also
  bans their auth login so a live token can't keep them in.

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

Deal statuses, payment methods, and offices are NOT hard-coded — they live in
`app_settings` and are edited live from **Admin → Settings**. Read them through
`useSettings()` (`src/contexts/SettingsContext.jsx`): `statusLabels`,
`statusColor(label)`, `paymentMethods`, `offices`. Never re-introduce a
hard-coded status/office/payment list in a page or component. (The per-deal
checklist feature was retired; `deals.checklist` and
`app_settings.checklist_items` remain in the DB but drive nothing.)
The default seed is `Deal Review`, `Pending Install`, `Change Order`,
`Pay Finalized`, `Paid`, `Sales Issue`, `Canceled` (each with a color). Because
statuses are configurable, there is no longer a DB CHECK on `deals.status` (see
`006_settings.sql`).

**Status lifecycle:** new deals (manual or scheduler-imported) default to
`Deal Review`; statuses are changed manually via the inline dropdown. The
sync's PAID PASS auto-moves `Pay Finalized` → `Paid` once the deal's `pay_date`
arrives. (The old per-deal checklist UI and its checklist-driven status
automation were removed — the `deals.checklist` column and the Admin →
Settings checklist editor still exist but drive nothing.)

**Staging ("Needs review").** The Deals page gives VP/admin two tabs: **Needs
review** (deals not yet vetted) and **All deals**. A deal graduates out of
staging when its commission gets the gold check (`commission_verified` —
`dealNeedsReview`, exported from `src/components/DealTable.jsx`). Change
orders clear `commission_verified`, so re-signed deals automatically fall back
into staging.

**Payroll totals are finalized-only.** The pay-run headline (`Total payout`,
Remaining, per-payee totals) counts only `Pay Finalized` + `Paid` deals
(`isFinalized` in `src/pages/Payroll.jsx`); other deals on the run show in a
separate "not yet finalized" line. The run also flags deals missing an `office`
(their override % likely defaulted to 5% instead of the office rate).

**Spreadsheet sync (`scripts/ScheduleSync.gs`, entry `schSync`).** One Apps
Script trigger (every minute) drives everything: the **Jobs** tab (ArcSite
"sold" feed) is the source of truth — every APPROVED job becomes a deal as soon
as it lands (status `Deal Review`; Rhett/Ronnie excluded; hand-entered deals
protected by name). The **Schedule** tab then layers on install date (+pay
date), payment, office (detected by VALUE — Tucson/Phoenix/Mesa — since the
column header is blank; office sets the 3.75%/5% dir+VP rate), and the real
setter from Lead Source (names resolved leniently: "JC" → "JC Correa" via
`schResolvePerson_`). A **change order** (baseline or sale price changed;
matched by project_id with a deal-name fallback for re-signs under a new ID)
updates the deal, sets status `Change Order`, and clears `checklist` +
`commission_verified` + stored amounts so everything recomputes and re-verifies.
**A gold-checked deal (`commission_verified=true`) is LOCKED — the change-order
pass skips it entirely, so manual baseline/price edits stick. Un-check the gold
seal to let the sync manage it again.**
**CANCELLED schedule rows are IGNORED** — the sync never cancels a deal;
cancellation is manual in the site. The sync never overrides
`Pay Finalized`/`Paid`/`Sales Issue`/`Canceled` with schedule info.
⚠️ After pasting any script update into Apps Script, confirm
`SCH_DRY_RUN = false` — a re-paste resets it to preview mode and the sync
silently stops writing.

**`scripts/Sync.gs` is LEGACY — never re-enable its trigger.** It writes stored
`*_amount` fields that override the in-site math and would stomp manually
corrected per-deal rates. All commission is computed in-site now.

**`scripts/Backup.gs` (`backupNow`, daily trigger).** Dumps every table to a
dated Google Sheet in the "Turf Time Backups" Drive folder, one tab per table,
keeping the most recent 30.

**`scripts/Watchdog.gs` (`watchdogRun`, hourly trigger).** The sentry: pings
the site, checks sync/backup heartbeats (incl. the DRY_RUN trap), scans for
payday hygiene problems (deals paying soon missing office/payment/install or
not gold-checked, overdue unfinalized deals, negative rep pools) and recent
`client_errors` rows, writes `watchdog_heartbeat` to app_settings (shown on
Admin → System Health), and emails ALERT_EMAIL a digest — only when findings
CHANGE. Detect-and-notify only; it never edits data. Frontend side: an
ErrorBoundary in Layout + global error/unhandledrejection handlers report
crashes to `client_errors` (migration 020) via `logClientError` in db.js.

## Known low-severity items (not yet addressed)

- `getMonths` / `monthRange` slice dates in UTC, which can be off-by-one at
  month boundaries for users in negative-offset timezones. Left as-is.

## Build / verify

- `npm install && npm run build` should pass with zero warnings (prebuild
  runs ESLint with `no-undef` as an error).
- Deals are created via the Deals page "+" modal only — the old New Deal page
  and the per-deal checklist were retired. Each deal's edit history (from
  migration 019) shows in the edit modal's collapsible "Edit history" panel.
