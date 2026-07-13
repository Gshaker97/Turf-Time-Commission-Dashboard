# Turf Time Commission Dashboard — Project Memory

Context for working on this repo. Read this before changing commission math,
data access, or the database schema.

## What this is

Internal sales + commission tracker for Turf Time (artificial turf company).
Tracks deals through their lifecycle and computes per-rep commission across
multiple roles. VP/admin enter deals; reps see their own; managers/directors
see their teams.

## Stack

- Frontend: Vite + React + Tailwind, React Router, Recharts — served in
  production by `server.js` (Express, `npm start`), which also hosts the
  site's own `/api/user-admin` endpoint (service key via the
  `SUPABASE_SERVICE_KEY` Railway variable).
- Backend: self-hosted Supabase (Postgres + GoTrue + PostgREST) on Railway.
- **The site is fully standalone** (per Keaton): the Apps Scripts only FEED
  data in or watch from outside — never host site functionality. If they
  vanished, everything still works minus the sheet import.
  `scripts/ScheduleSync.gs` (entry `schSync`, 1-min trigger) imports deals
  from the ArcSite Jobs/Schedule spreadsheet. `scripts/Backup.gs` does daily
  Drive backups. `scripts/Sync.gs` and `scripts/UserAdmin.gs` are legacy —
  see the sync and user-management sections below.

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
   - Overrides = `baseline × pct` for manager/director/vp, but ONLY when that
     person is assigned — a stranded override %/amount with no manager/director/vp
     id counts as 0 (it pays nobody, so it must never inflate a total). The
     DealModal clears the % when its person is set to None and saves it null.
   - **Override exclusions** (migration 030): `deals.override_exclusions` =
     jsonb `[{ item, amount }]` — subcontracted items (defaults Electrical/Gas/
     Pergolas; list is admin-editable via `app_settings.override_exclusion_items`)
     whose price earns NO override. Baseline/job price stay untouched; overrides
     compute off `overrideBase = baseline − exclusions`. Displays show the
     EFFECTIVE rate (`amount ÷ baseline`, e.g. 2.7% not 3%) — Commissions
     `myParts`, Payroll payee lines + exports; the DealModal keeps the entered
     contract rate in the % inputs and shows the effective rates in the
     Override Exclusions section note. `dealAmounts` returns `exclusionsTotal`
     + `overrideBase`.
   - When a stored `*_amount` field is present, it WINS over the computed value.
   - **Rep bonus** (migrations 025→026): several roles can chip in toward a
     bonus for the rep (`bonus_recipient` = setter|closer). Each contribution is
     a resolved $ stored per source — `bonus_manager`/`bonus_director`/`bonus_vp`
     (pulled from THAT role's override, capped at what they have) + `bonus_company`
     (extra, from nobody). The editor lets you type a % of baseline or a $ and
     stores the $. Baked into the per-role amounts in `dealAmounts`, so every
     roll-up reflects it automatically. (025's single-source columns are unused.)
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
  created_at are frozen), and only admins (`my_role()='admin'`) may delete;
  `024` adds the `rep_goals` table (per-rep + per-team monthly goals, shared
  across devices — replaces the old per-browser localStorage goals; `scope='rep'`
  → subject is the rep, `scope='team'` → subject is the manager; company-wide
  goal stays in `monthly_goals`). RLS: anyone reads; writes allowed for admins,
  the subject themselves, or the subject's direct manager; `025` adds the rep
  bonus columns (single-source: `bonus_amount`/`bonus_pct`/`bonus_source`,
  `bonus_recipient` = `setter`|`closer`); `026` SUPERSEDES the single-source
  bonus with multi-source `bonus_company`/`bonus_manager`/`bonus_director`/
  `bonus_vp` (resolved $ each — several roles can chip in at once) — applied in
  `commission.js` (the 025 single-source columns linger unused); `027` adds
  `payroll_adjustments` (per-rep, per-`pay_date` +/- $ with a note — manual
  payroll corrections like a deduction discovered after a deal already paid out;
  RLS: anyone reads, admins write). Folded into the Payroll run totals +
  pay statements in `src/pages/Payroll.jsx` (a payee can appear on an
  adjustment alone); `028` adds `payroll_locks` (freeze a completed pay run:
  admins Lock/Unlock a `pay_date` on the Payroll page; a `guard_locked_payroll()`
  trigger on `deals` + `payroll_adjustments` rejects ANY insert/update/delete
  touching a locked pay date — app, sync, and raw SQL alike — with a snapshot of
  payee totals stored at lock time). The sync's AUTO-LOCK pass also freezes any
  past-due run whose payable deals are ALL Paid (`snapshot.auto = true`); a
  manual Unlock is honored for 24h (`app_settings.payroll_unlocks` grace map)
  before auto-lock re-arms; `029` adds `team_changes` (a date-stamped log of
  reports-to moves — a SECURITY DEFINER trigger on `profiles` records old/new
  lead + who changed it whenever `manager_id` changes; read-only for clients;
  shown as the collapsible "Team change log" on Admin → Users, and the latest
  change stamps "since <date>" on roster rows); `030` adds
  `deals.override_exclusions` (jsonb `[{ item, amount }]` — subcontracted items
  that earn no override; see the engine rules above); `031` adds
  `deals.change_alert` (jsonb `{ prev_baseline, prev_job_price, baseline,
  job_price, at }` — the sync's replacement for automatic change orders; see
  the sync section); `032` lets trusted SERVICE contexts (`auth.uid() IS NULL`
  — GoTrue's auto-link trigger, the service key, Studio SQL) through
  `guard_profile_columns()` so login creation can actually stamp
  `profiles.auth_id` (the old guard silently reverted it, leaving
  half-created logins), and bulk-links any orphaned auth users by email;
  `033` deletes sync-created clone deals (same project_id + name, keeping the
  earliest; verified copies never deleted) and adds a partial UNIQUE index on
  `deals.project_id` — the DB backstop against duplicate imports (the sync
  itself now also takes a script lock and pages its deal fetch past
  PostgREST's max-rows cap); `034` scopes the pay-run lock to the PAYOUT: the
  `guard_locked_payroll()` trigger freezes only finalized/paid deals (and all
  adjustments) on a locked date, lets a non-finalized deal parked on a locked
  date be edited (e.g. a pulled Sales Issue deal whose install date changed),
  and still rejects any change that would FINALIZE a deal onto a locked run.
  Payroll's `openEdit` mirrors this (blocks only `isFinalized` deals); `035`
  lets a LOCKED run's deals still go `Pay Finalized` → `Paid` (only when
  nothing else changes) so the sync's PAID pass and the Mark-paid button keep
  working after an early lock — the payout itself stays frozen. Do
  not re-run `001`/`002` against a populated database.

## User management (Admin page)

- **Create login / reset password** for roster members happens on Admin → Users,
  served by the site's OWN `/api/user-admin` endpoint in `server.js` (the
  Express server that also serves the SPA — no Apps Script involved). It needs
  the `SUPABASE_SERVICE_KEY` variable on the frontend Railway service; the key
  never reaches the browser. The frontend (`userAdmin()` in `db.js`) calls it
  with the admin's own Supabase access token — the server verifies the caller
  is an active admin before acting. `create_login` links `profiles.auth_id`
  explicitly, VERIFIES the link stuck (migration 032's guard bypass makes that
  possible), and self-heals half-created logins by adopting an existing auth
  user with that email. (`scripts/UserAdmin.gs` was the old Apps Script
  version — LEGACY, do not deploy; `VITE_USER_ADMIN_URL` is no longer read.)
  The Edit User modal also has a **Login Password** field — an admin types a
  password of their choice and it's set via
  `userAdmin('reset_password'|'create_login', { email, password })` (creates the
  login if none yet), so admins manage known passwords directly.
- **Users tab layout:** a team-grouped roster (Leadership & Admin → one
  section per team lead → Unassigned reps) with search; row badges are
  display-only and edits go through the Edit modal (`UserModal`).
- **What teams exist (`src/utils/team.js`, the ONE shared rule — ROLE-based,
  per Keaton):** the `manager` ROLE is what makes a team — having people report
  to you never makes you a head (a rep pointed at by a stale reports-to link is
  NOT a team). Leadership exception: a director/VP shows as a head when ACTIVE
  people report directly to them (Garrison's directs). Reporting to a non-head
  groups as Unassigned. Moving/demoting someone WITH direct reports prompts a
  cascade in Admin `saveUser` — "move their reports to the new lead too?" —
  with each move date-stamped in `team_changes`. Dissolving/absorbing a team is
  done by CHANGING THE PERSON'S ROLE (Colt: manager → rep when Team Niznik
  merged into Team Jones), not by rewiring reports. Used by the Admin roster,
  Team page (comparison + card grouping + visibleReps), Dashboard
  breakdown/filter, and Weekly Stats — never re-derive headship inline.
- **"Reports to" (`profiles.manager_id`) can be a manager, DIRECTOR, or VP** —
  some reps are managed directly by Garrison (director). It drives Team-page
  grouping (team heads = managers + anyone with direct reports), goal
  permissions, and Dashboard team breakdowns. BUT the deal-level
  manager-override default only applies when the reports-to person is an
  actual MANAGER — the sync (`profById` role guard) stamps `deal.manager_id`
  null otherwise, so a director never double-dips manager + director override.
- **Deactivation:** the Active toggle flips `profiles.active`. A deactivated
  user is signed out and blocked at login (`AuthContext.fetchProfile` checks
  `active`), but **all their deals/stats stay and still count** — never filter
  aggregates by `active`. When user admin is configured (SUPABASE_SERVICE_KEY
  on the site service), deactivating also
  bans their auth login so a live token can't keep them in.

## Permissions model — who can SEE vs CHANGE

**Editing data anywhere is admin-only** (`isAdmin` from `useAuth()` = the `admin`
title OR the `is_admin` flag). Everyone else gets a read-only view; they can
still filter, sort, and read/post/edit-their-own notes. Concretely, every
data-mutation affordance is gated on `isAdmin`, NOT on sales title:
- Deals page: inline cell edits, status/office/payment dropdowns, date fields,
  the edit (pencil) + delete buttons, the gold-check seal, and the "+" create
  FAB (`canEdit`/`canVerify` in `DealTable.jsx`, the FAB in `Deals.jsx`).
- `DealModal` is only ever opened by admins (Deals via `canEdit`, Payroll via
  `openEdit` which no-ops for non-admins).
- Payroll: advancing status (`canApprove`/`canPay` require `isAdmin`) and the
  edit-modal openers. Non-admins (a future non-admin VP) get a read-only run.
- Competitions: create/edit/delete (`canManage = isAdmin`); everyone can VIEW.
- Team: coach notes + weekly stats are admin-only (`canEditNotes = isAdmin`).
- Dashboard **company** monthly revenue goal (`canEditGoal = isAdmin`).
When adding a new edit/mutate control, gate it on `isAdmin` — never on `role`.

**GOALS are the one carve-out** (they're personal/team targets, not commission
data): reps set their OWN personal goal, managers set their team's reps' goals
AND their own team goal, admins set any. Goals are DB-backed in `rep_goals`
(migration 024) and shared across devices/users — `fetchRepGoals`/`saveRepGoal`/
`deleteRepGoal` in `db.js`, scoped to the current calendar month. On `Team.jsx`
the per-rep card uses `canEditGoal = isAdmin || profile.id===rep.id ||
rep.manager_id===profile.id`, and the team-goal pencil shows for `role==='manager'`;
RLS in 024 enforces the same on the server. The Dashboard's goal is the
company-wide revenue goal (separate `monthly_goals` table, admin-only).
(Coach notes on the Team page are still per-browser localStorage — not yet shared.)

**Visibility (view scoping, NOT edit) by sales title:**
- **Rep:** their own deals only (`role === 'rep'` filter in `Deals.jsx`); NEVER
  any override amounts. Reps DO have Team-page access (to set their personal
  goal and view the team), consistent with the company-wide Dashboard.
- **Manager/Director/VP:** their deals + their team's deals, and their OWN
  override on the Commissions page. The Commissions page is siloed by identity
  (`myParts(deal, id)` only emits roles the viewer personally holds), so nobody
  sees anyone else's commission/override there.
- **Admin:** sees and adjusts everything.
- **Dashboard + Competitions are company-wide for everyone** (full leaderboards
  / standings), by design — ghost names still hidden from non-admins.
- Payroll/Import are route-guarded to `vp`/admin; Admin page to `admin`;
  Requires-Audit self-guards to `isAdmin || isKeaton`.

## Security notes (already fixed — keep them fixed)

- `profiles_update_self` has a `WITH CHECK` plus a `guard_profile_columns()`
  trigger so non-admins cannot change `role`, `email`, `auth_id`, hierarchy,
  `active`, or timestamps. Do not loosen this for SIGNED-IN users. (Migration
  032 deliberately bypasses the guard when `auth.uid() IS NULL` — GoTrue's
  auto-link trigger, service-key calls, Studio SQL — because anon API traffic
  can't reach a profiles UPDATE anyway and the guard was silently undoing
  `auth_id` links on login creation.)
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

**Override rates are admin-configurable (`app_settings.override_rates`).**
Admin → Settings → Override Rates holds effective-dated rate "eras":
`{ effective, manager, default, byOffice: { <office lc>: pct } }` with HUMAN
percents (3.75 = 3.75%). A deal's era is picked by its SALE DATE (last era
effective on/before it), so adding a new era never re-prices older deals; a
deal's own stored `*_override_pct` always wins over these defaults. Consumers:
`officeOverrideRate(deal)` / `managerDefaultRate(saleDate)` /
`rateEraFor(saleDate)` in `commission.js` (schedule injected by
SettingsContext via `setOverrideRateSchedule`); DealModal's stamped defaults;
`officeChangePatch` in DealTable; and the sync (`SCH_RATES` +
`schOfficeRate_`/`schManagerRate_`, read per run). No schedule configured →
legacy constants (manager 3%; dir/VP 5%, Tucson 3.75%).

**More admin-configurable behavior (`app_settings`, Admin → Settings).**
`pay_date_rule` = `{ day: 1..7 Mon..Sun, weeks_after }` — the auto pay date is
that weekday of the Nth week after the install week (default Friday/1 =
historical Monday+11). Injected into `payDateFromInstall` via
`setPayDateRule` (SettingsContext) and read per run by the sync
(`SCH_PAY_RULE`/`schPayDate_`). Only applies when an install date is set or
changed — existing pay dates never move. `note_notify` =
`{ closer, setter, manager, admins }` booleans — who gets the bell when a deal
note posts (default closer+admins; exposed as `noteNotify` from
`useSettings()`, consumed in `NotesThread`). `sync_excluded_reps` +
`sync_skip_names` (string arrays) — the sync's never-import rep list and
junk-customer-name substrings (defaults rhett/ronnie + test/cute; read per run,
lowercased substring match; a SAVED empty list means "no exclusions" while a
missing key means "use defaults").

**Legacy data cutoff (`data_start_date`).** Admin → Settings has a "Data Start
Date" (an `app_settings` value, default `2026-06-01`, read as
`dataStartDate` from `useSettings()`). Deals closed before it (`sale_date <
dataStartDate`) predate our atomized data (office/pay date/payment weren't
captured until June 1), so they're treated as "it is what it is": they STILL
count in every historical total, but background nags leave them alone —
excluded from the Deals "Needs review" staging (`dealNeedsReview(deal,
dataStartDate)`), the Payroll overdue list (`overdueDeals`), the Requires-Audit
panel (`dealsRequiringAudit(deals, dataStartDate)`), and the Watchdog's
"overdue" + "negative pool" checks (`wdDataStart_`). What's deliberately KEPT
(pay-time prompts, so old deals get corrected as they approach payout): the
Payroll current-run banners, the amber missing-field flags, and the Watchdog's
"paying within 7 days" missing-info/unverified checks. When changing the
cutoff, never filter it through `activeDeals`/aggregate roll-ups — legacy deals
must keep counting; the cutoff ONLY gates alert/task surfaces.

**Status lifecycle:** new deals (manual or scheduler-imported) default to
`Deal Review`; statuses are changed manually via the inline dropdown. The
sync's PAID PASS auto-moves `Pay Finalized` → `Paid` once the deal's `pay_date`
arrives. (The old per-deal checklist UI and its checklist-driven status
automation were removed — the `deals.checklist` column and the Admin →
Settings checklist editor still exist but drive nothing.)

**Staging ("Needs review").** The Deals page gives VP/admin two tabs: **Needs
review** (deals not yet vetted) and **All deals**. A deal graduates out of
staging when its commission gets the gold check (`commission_verified` —
`dealNeedsReview`, exported from `src/components/DealTable.jsx`). UNchecking a
deal sends it back to staging — even a Paid deal — and an undismissed
`change_alert` (❗) also holds a deal in staging even while gold-checked, so
the only state-based exclusions are Canceled and legacy (`sale_date` before
`dataStartDate`). The Needs-review list is also scoped by the page's current
filters/date range.

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
`schResolvePerson_`). **Automatic change orders were RETIRED (migration 031)
— the sync never rewrites an existing deal's financials.** When the sheet's
baseline or sale price changes for an already-imported deal (matched by
project_id with a deal-name fallback for re-signs under a new ID), the sync
only stamps `deals.change_alert` = `{ prev_baseline, prev_job_price, baseline,
job_price, at }` and advances the `synced_*` snapshot (migration 023) so each
sheet version alerts exactly once. Nothing else changes: numbers, status, gold
check, and stored amounts all stay put. The deal wears a clickable amber ❗
next to its name (`ChangeAlertTag` in `DealTable.jsx`, both table + mobile
card) showing old → new figures; admins apply the new numbers by hand if the
re-sign is real, then **Dismiss** (sets `change_alert` null). An undismissed
alert also holds the deal in the Needs-review tab (`dealNeedsReview`). The
detection is still driven by the SHEET changing, not "stored differs" — a
manual in-app edit or a duplicate sheet row with the same numbers does NOT
fire. The SCHEDULE pass (install/pay/payment/office/override %s/setter) is
still locked by the gold check. (The PAID pass that advances Pay Finalized →
Paid still runs. The `Change Order` status label still exists in
`app_settings` for manual use only.)
**CANCELLED schedule rows are IGNORED** — the sync never cancels a deal;
cancellation is manual in the site. The sync never overrides
`Pay Finalized`/`Paid`/`Sales Issue`/`Canceled` with schedule info.
Preview mode (`SCH_DRY_RUN`) now lives in SCRIPT PROPERTIES, not code —
re-pasting the script can no longer silently disable the sync (absent
property = LIVE; set the property to `true` only to preview). The sync also
reports `version` (SCH_VERSION), an `issues` list (unmatched setters, failed
writes), and `sheet_issue` (missing sheet columns — the format tripwire) in
its heartbeat; System Health displays them and the Watchdog CRITs on sheet
issues. Office detection follows the admin-editable `offices` settings list.
schSync holds a script lock (no overlapping runs) and pages its deal fetch.

**`scripts/Sync.gs` is LEGACY — never re-enable its trigger.** It writes stored
`*_amount` fields that override the in-site math and would stomp manually
corrected per-deal rates. All commission is computed in-site now.

**`scripts/Backup.gs` (`backupNow`, daily trigger).** Dumps every table to a
dated Google Sheet in the "Turf Time Backups" Drive folder, one tab per table,
keeping the most recent 30.

**`scripts/Watchdog.gs` (`watchdogRun`, hourly trigger).** A SITE/BACKEND
sentry only: pings the site, checks sync/backup heartbeats (incl. the DRY_RUN
trap), reports recent `client_errors` rows, and watches **permission/roster
changes** — it snapshots every profile's role + `is_admin` + `active` (stored in
the `WATCHDOG_PERMS` script property) and alerts (CRIT) when a role flips, admin
is granted/removed, an account is (de)activated, or accounts are added/removed.
Writes `watchdog_heartbeat` to app_settings (shown on Admin → System Health) and
emails ALERT_EMAIL a digest — only when findings CHANGE. It deliberately does
NOT report deal/payroll status (overdue deals, below-baseline pricing, missing
fields) — those are surfaced in-app (Payroll banners, the Deals "Needs review"
tab). It can't see what a user's browser renders; a UI permission leak is
guarded by the app's role-gating + RLS, plus a tripwire on `Commissions.jsx`
that `logClientError`s if a plain rep is ever shown override $ (which the
Watchdog then reports). Detect-and-notify only; it never edits data. Frontend side: an ErrorBoundary in Layout + global
error/unhandledrejection handlers report crashes to `client_errors`
(migration 020) via `logClientError` in db.js.

## Known low-severity items (not yet addressed)

- `getMonths` / `monthRange` slice dates in UTC, which can be off-by-one at
  month boundaries for users in negative-offset timezones. Left as-is.

## Build / verify

- `npm install && npm run build` should pass with zero warnings (prebuild
  runs ESLint with `no-undef` as an error).
- **The DealModal saves only CHANGED fields** (diff vs the deal it opened
  with, `saveDeal` in DealModal.jsx) so a save can't stomp fields the sync or
  an inline edit updated while the modal sat open; stored `*_amount` values
  are cleared only when a money-relevant field changed. Every db.js UPDATE
  goes through `requireRow` (zero-row writes = error, never silent success),
  and reads on deals/users retry once through `readWithAuthRetry` after
  refreshing an expired session (`tt-session-expired` → the red banner in
  `Notices.jsx`). Use `toast.error/info/success` from `src/lib/toast.js` for
  user-facing notices — never `alert()`.
- `server.js` exposes `GET /api/health` (`{ ok, userAdmin, build }`) — the
  Watchdog pings it hourly and warns if the user-admin key is missing.
- Deals are created via the Deals page "+" modal only — the old New Deal page
  and the per-deal checklist were retired. Each deal's edit history (from
  migration 019) shows in the edit modal's collapsible "Edit history" panel.
