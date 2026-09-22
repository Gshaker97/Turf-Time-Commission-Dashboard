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
  from the ArcSite Jobs/Schedule spreadsheet. `scripts/Watchdog.gs` is an
  hourly outside sentry. `scripts/Sync.gs` and `scripts/UserAdmin.gs` are
  legacy — see the sync and user-management sections below. (The Drive backup
  script was retired — DB backups are Railway volume snapshots, per SETUP.md.)
- **Deals spreadsheet backup:** `GET /api/export/deals?since=` on `server.js`
  (auth = the service key as bearer) serves deal rows computed by the SAME
  commission engine as payroll, grouped by closing month (July 2026+, newest
  first). `scripts/DealsExport.gs` (daily trigger, entry `dealsExportRun`)
  writes them into ONE live spreadsheet ("Turf Time Deals — Live Backup" in
  the "Turf Time Deal Exports" Drive folder, remembered by ID): a tab per
  month, red tint = Canceled / green = Paid, and a MONTH SUMMARY per tab
  (company + per-rep baseline/total/commissions/overrides, canceled
  excluded). Old states = Sheets version history. Never recompute commission
  in the export script — always feed from the endpoint.

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
   - **Rep bonus** (migrations 025→026→044): several roles can chip in toward
     a bonus for the rep (`bonus_recipient` = setter|closer|**split**; with
     `split`, `bonus_split_pct` = the SETTER's share as a fraction, null =
     50/50 — mirrors `deduction_paid_by='split'`+`deduction_split_pct` exactly,
     same slider in the modal). `closer`/`split` need a DISTINCT closer; a solo
     deal pays the whole bonus to the setter. `dealAmounts` returns
     `bonusSetter`/`bonusCloser` alongside `bonus`). Each contribution is
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
   - **Sale ownership (`saleOwnerId` in `utils/team.js`): deal counts + revenue
     credit the SETTER, falling back to the CLOSER when no setter is recorded**
     — used by the Dashboard leaderboard/teams and the Team page so no deal
     can vanish from breakdowns while still counting in company totals. Both
     team breakdowns append an "Unassigned" bucket (owner on no current team,
     or no people at all) so they always sum exactly to the company totals.
     Closed leads are NOT extra sales for the closer — their pay shows in
     commission columns only.
   - **Dashboard Rep Leaderboard count columns are MUTUALLY EXCLUSIVE**
     (per Keaton: "if the same person set and closed it, that's a self-gen,
     not a set"): **Self Gen** = set AND closed by them (a deal with a setter
     and no `closer_id` counts here — the setter closed it, same rule
     `dealAmounts` pays by), **Set** = they set it, another rep
     closed it (the column is LABELLED just "Set" — per Keaton — but it
     excludes self-gens), **Lead Closes** = another rep set it, they closed
     it. Every deal a rep touched lands in exactly ONE of the three, and
     Self Gen + Set = the deals they OWN (which is what Personal Rev is the
     revenue of). There is no combined "Closed" column any more — it was
     Self Gen + Lead Closes and double-counted a self-gen as a set. NOTE the
     unit differs from the Performance page, where Set/Ran are APPOINTMENTS;
     here every count is DEALS.
   - **Dashboard Rep Leaderboard under a TEAM FILTER lists that team's
     MEMBERS, not everyone who touched the team's deals** (per Keaton). It
     credits each rep from every deal in the date range (`dateFiltered`),
     then keeps only reps whose date-effective team as of the range end is
     the filtered team (`teamOfSale(rep.id, asOf, …)`). A closer from another
     team keeps their close credit on THEIR team's leaderboard. Filtering the
     deals first put Stephen (Conner's team) under Jared's team because he
     closed a deal Jared set.

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
  (entered on the Performance page's weekly views); `006` adds the `app_settings` table
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
  change stamps "since <date>" on roster rows. **Team attribution is
  DATE-EFFECTIVE**: a sale belongs to the team its owner was on AS OF THE
  SALE DATE — `buildChangesByProfile`/`managerAsOf`/`teamOfSale` in
  `utils/team.js` replay this log, used by the Dashboard team
  breakdown/filter/goal and the Team page comparison, so moving a rep never
  rewrites history; deals from a dissolved team follow its old lead's current
  grouping, a dissolved+unabsorbed lead renders as a HISTORICAL team row, and
  a first log entry of "Unassigned → X" is treated as roster setup — pre-log
  deals follow the first known lead, per Keaton); `030` adds
  `deals.override_exclusions` (jsonb `[{ item, amount }]` — subcontracted items
  that earn no override; see the engine rules above); `031` adds
  `deals.change_alert` (jsonb `{ prev_baseline, prev_job_price, baseline,
  job_price, at }` — the sync's replacement for automatic change orders; see
  the sync section); `032` lets trusted SERVICE contexts (`auth.uid() IS NULL`
  — GoTrue's auto-link trigger, the service key, Studio SQL) through
  `guard_profile_columns()` so login creation can actually stamp
  `profiles.auth_id` (the old guard silently reverted it, leaving
  half-created logins), and bulk-links any orphaned auth users by email
  (`036` completes the fix: GoTrue runs with `search_path=auth`, so the
  auto-link trigger and the profile-trigger helpers are pinned to
  `search_path=public` — without it every GoTrue user INSERT died with 500
  "Database error creating new user");
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
  working after an early lock — the payout itself stays frozen; `038` adds
  competition `sides` + `rounds` jsonb — type `squads` ("Grouped Teams"):
  named sides mixing whole teams + individual reps (`[{ id, name, team_ids,
  rep_ids }]`, membership DATE-EFFECTIVE via `teamOfSale`; scoring fns take
  `opts.teamCtx`), and `rounds` on ANY comp type (`[{ id, name, start, end,
  prize, winner_id }]` — each round a fresh race with its own prize;
  `winner_id` null = auto-crowned top scorer, set = admin override via the
  select on the card; Overall/round chips pick the displayed race, defaulting
  to the active round; the modal has an "Auto-split into weeks" button).
  Finished comps auto-minimize into the collapsed "Past competitions" section
  (compact strips: name/dates/winner, expandable to the full card); `039`
  lets a LOCKED run's deals still move their change-alert lifecycle — an
  UPDATE whose only changed columns are `change_alert`/`synced_baseline`/
  `synced_job_price` passes the guard (admin dismiss + sync stamping both
  work on locked runs; the dismiss button also asks for confirmation); `040`
  adds `personal_goals` (weekly + monthly commitments per rep — period
  'week'|'month' + `period_start` Sunday/1st, `est_target` (SELF-GEN
  estimates) / `deals_target` / `revenue_target`; RLS mirrors 024: anyone
  reads, writes by admins, the rep, or their direct manager); `044` adds
  `deals.bonus_split_pct` (setter's share of a `bonus_recipient='split'` rep
  bonus, fraction; see the engine rules above); `045` adds the BONUS-POD
  tables `sales_teams` / `team_members` / `bonus_tiers` + the
  `team_month_summary()` RPC (see "Bonus pods" below — a model SEPARATE from
  the org chart); `046` adds `profiles.team_name` (a team's official name;
  see "What teams exist"); `049` adds `leads.ignored` (take a duplicate
  appointment out of every count without deleting it — see the Leads
  section); `050` makes `payroll_adjustments.pay_date` NULLABLE and adds
  `deal_id` / `parent_id` / `written_off_*` — the DEDUCTION LEDGER (see
  "Deductions owed" below); `047` adds `competitions.excluded_ids` (jsonb
  array of profile ids) for the **Team Average (per rep)** competition type
  `team_avg` — entrants are TEAM HEADS (any `headIdSet` head, picked in the
  modal as "Teams competing"), score = the team's metric (deals or baseline
  revenue, per `credit_mode`, each deal counted ONCE per team like `team`/
  `squads`) ÷ its REP COUNT. The divisor = active date-effective members as
  of `min(end_date, today)` ∪ everyone who earned credit in the window (a
  rep who moved mid-contest counts on BOTH teams, for the deals they made on
  each) − `excluded_ids`. Excluding a person removes them from BOTH sides —
  their deals and their headcount — which is how a part-timer is pulled
  from a contest without warping the average (per Keaton); a deal they
  shared with a counting teammate still counts via that teammate. The head
  counts as a rep by default; exclude them via the same chips if they don't
  sell. Membership is DATE-EFFECTIVE via `teamOfSale` when `opts.teamCtx`
  is passed (Competitions page AND Home's "my competitions" card — Home
  fetches `team_changes` too so the two never disagree on rank); without a
  teamCtx the fallback is the CURRENT grouping via `teamKeyFor` — never raw
  `manager_id`, which put a manager who reports to a director on both
  teams. **`teamAvgRoster(headId, deals, users, comp, teamCtx)` is the ONE
  roster rule** (exported): the engine divides by it minus exclusions, and
  the modal's "Who counts toward the average" chips render FROM it (it gets
  `deals` + `teamCtx` props), so "N of M count" always equals the card's
  "÷ N reps"; deactivated earners are listed with a tag. Known caveat:
  deactivation isn't date-logged, so a deactivated member who sold nothing
  in the window drops out of a finished contest's divisor too. Stale
  exclusions (team unpicked, rep moved) show as an "Also left out" row and
  are pruned to picked rosters on save; switching type prunes
  `participant_ids` to the new pick list. A rep in `excluded_ids` gets no
  "you"/Home-card highlight for that contest (`isMine`/`myComps` match
  team rows by `teamKeyFor`). Competitions `handleSave` surfaces a failed
  write as a toast instead of closing the modal. Entries carry `total`
  + `count` so the page renders "12 deals ÷ 4 reps" under the average, and
  `fmtScore(v, metric, perRep)` appends " / rep" (`perRepComp(comp)`).
  `excluded_ids` is saved only for this type, `[]` otherwise; `048` adds
  `field_activity` (door knocks per rep per Arizona day) + `field_knocks`
  (raw per-door events, rolled up by trigger) for the rebuilt Performance
  page — see "Field activity feed" below.
  Do not re-run `001`/`002` against a populated database.

## Leads / appointments (CRM feed, migration 041)

Replaces hand-collected estimates. `leads` = one row per APPOINTMENT fed in
from the field CRM (RepCard). Route `/leads`, all roles (reps see only
appointments they set or run; admins edit).
- **Ingest:** `POST /api/leads/ingest` on `server.js`. Auth = `LEADS_INGEST_SECRET`
  (a Railway var on the SITE service — a scoped token so the database master
  key never goes into a vendor's config); the service key also works for curl
  tests, and `X-API-Key` / `?secret=` are accepted for senders that can't set
  headers. Body = one object or `{ leads: [...] }`; upserts on
  `(source, external_id)` so a webhook firing twice is harmless (partial
  UNIQUE index, same backstop as `deals.project_id`).
- **A WEBHOOK EVENT IS A PARTIAL UPDATE, NOT A FULL RECORD — only write what
  you were actually given.** RepCard's event types carry different blocks, so
  writing every column unconditionally made any absent block land as NULL and
  silently erase good data. Three real bugs came from this one mistake
  (statusless events wiping a recorded Sold; whole events blanking
  setter/closer; an unresolvable name nulling a correct id). The standing
  rules in `ingestLeads`: a column is sent only when the payload supplied it;
  the status/disposition is written only when non-empty; and **the feed can
  SET a person but never UNSET one** (an id is written only on a positive
  roster match — an unmatched name still lands as `setter_name`/`closer_name`
  text, and clearing a person stays a deliberate admin action). Rows are
  batched by key signature because PostgREST requires identical keys across a
  bulk upsert.
- **People resolve by EMAIL, falling back to NAME.** A CRM stores the rep's
  own login, which is usually a PERSONAL address
  (`garrison.shaker@gmail.com`) — not the company email on our roster — so
  email alone matched nobody and every feed event arrived ownerless. Names
  ("Garrison Shaker") do match. A name shared by two profiles resolves to
  NEITHER: no owner beats the wrong owner. `csvToLeads` takes the same
  `profilesByName` fallback — keep the two paths in step. Unmatched people
  come back as `unmatched_people` in the response AND the row still lands
  with the name as text — never drop the appointment.
- **Field mapping is ADMIN-CONFIGURABLE, not hard-coded per CRM.** Admin →
  Settings → "Lead Feed" holds `app_settings.lead_field_map` (our field ←
  their field name, dot paths supported for nested payloads) and
  `lead_status_map` (their disposition wording → our lifecycle). The server
  applies both in `ingestLeads`; unmapped fields fall back to a same-named
  key. Every ingest also stores `lead_last_payload` (flattened field list +
  the sample), so the Settings mapper lists the REAL incoming field names as
  dropdown options instead of making anyone guess. Adding a new CRM = mapping
  clicks, not a code change.
- **Status** is a normalized lifecycle: `scheduled | completed | sold |
  no_show | canceled`. `completed`/`sold` = the appointment RAN = an estimate.
  The CRM's raw outcome is kept in `disposition`; `normalizeStatus` in
  server.js resolves it in four steps: the admin's `lead_status_map` wins
  first, then an already-normalized status, then `DISPOSITION_MAP` on the
  wording, then `CATEGORY_MAP`. **RepCard sends the outcome as
  `"<Disposition> (<Category>)"`** — `No Showed (Not Held)`, `Signed Up
  (Held)`, `Confirmed (Confirmation)` — so the trailing parenthetical is
  parsed off and the CATEGORY backs up the wording: `Held` → `completed`
  (it ran), `Not Held` → `canceled`, `Confirmation` → `scheduled`. That way a
  team inventing a new disposition still lands in the right lifecycle instead
  of falling through to `scheduled`. `Not Held` defaults to `canceled` rather
  than `no_show` deliberately — two of its three options are cancel-ish, and
  pinning an unrecognized outcome on the customer as a no-show is the worse
  guess. Anything with no category and no known wording lands `scheduled` for
  manual fixing (per Keaton: some reps use dispositions, some don't).
- **A human's correction beats the feed.** Closers get reassigned and
  dispositions are inconsistent, so admins fix status/setter/closer on the
  page — which sets `leads.pinned`. The `leads_keep_manual_fields()` trigger
  then preserves those five fields against SERVICE-KEY writes (`auth.uid()
  IS NULL` = the feed) while still letting it refresh timing/details; a
  signed-in admin can always edit; the row shows a quiet amber line under the
  customer name instead of a chip, and clicking the NAME opens the edit
  history (migration 043 `lead_history` + trigger, mirroring `deal_history`)
  where "Hand back to feed" unpins. This is the deliberate fix for the ScheduleSync "my setter keeps
  reverting" class of bug.
- **Estimates now COME FROM LEADS** (`src/utils/estimates.js`, the one shared
  rule — never count estimates inline). `app_settings.estimates_from_leads_date`
  (Admin → Settings, exposed as `estimatesFrom`) is the cutover: appointments
  on/after it supply estimate counts; weeks BEFORE it keep their hand-entered
  `weekly_stats` numbers, so June/July history survives. Blank = manual
  everywhere. Credit goes to whoever RAN the appointment — set it AND ran it
  = self-gen estimate, someone else set it = lead estimate. Consumers:
  `repProduction`/`estimateStreak`/`suggestFromRevenue` (Goals + Home, via
  `opts.leads`/`opts.estimatesFrom`) and Home's month tiles. The rebuilt
  Performance page shows appointment counts (Set / Ran / Sold) straight from
  the feed regardless of the cutover — it is the feed's page. There is NO
  UI left for hand-entering `weekly_stats` (it went with the old Performance
  page); the table stays for pre-cutover history.

## Bonus pods (`sales_teams`, migration 045 — route `/myteam`, nav "Bonus")

A monthly team-revenue BONUS program, deliberately SEPARATE from the org
chart (`utils/team.js` / `team_changes`): a "pod" has a `team_lead_user_id`
who earns a bonus off the pod's monthly baseline revenue, and its lead can be
a REP who heads nothing on the People chart (the seed is "Ricky's Team":
Ricky lead + Bryan + Joseph). `sales_teams` (name, lead, active),
`team_members` (date-effective `joined_at`/`left_at`), `bonus_tiers` (revenue
→ bonus schedule; `team_id NULL` = default; seeded $200k→$2k … $700k→$12k).
Revenue follows rule #1 (baseline, sale_date, canceled excluded, each deal
once — setter if a member, else closer). **Access is enforced SERVER-SIDE**:
RLS shows a pod only to its lead, admins, or the lead's manager/director/VP,
and the SECURITY DEFINER `team_month_summary(team_id, year, month)` RPC
re-checks the caller and raises 42501 before returning numbers.
`src/pages/MyTeam.jsx` renders it (`fetchMyTeams`/`fetchTeamMonthSummary` in
db.js); the Joseph Burgos row is a seeded PLACEHOLDER profile pending a real
email + login. `sales_teams.name` is the POD's name, not an org-chart team's
— see `teamLabel` for those.

## Records & big moments (`src/utils/records.js`)

All-time bests computed straight from deals — no storage, no manual entry.
`buildRecordBook(deals, { users, isAdmin, dataStartDate, todayISO })` →
company records (biggest revenue month/week/day + most deals month/week/day)
rep records (biggest rep month/week/day, most deals rep month/week/day,
biggest single deal — owner-credited via `saleOwnerId`, ghost holders
admin-only), and — when `teamCtx` ({usersById, heads, changesByProfile}) is
passed — TEAM records (same six, date-effective via `teamOfSale`, Unassigned
excluded). Rep/team records use `pickEntityRecord` (maps keyed
`entityId|periodKey`) so they carry best/prev/current + watch/new status like
company ones;
`personalBests(deals, repId, …)` → one rep's own bests. Records come from
COMPLETED periods only; the current period rides along as `status: 'watch'`
(≥85% of best) or `'new'` (beating it). Canceled excluded; sale dates before
`dataStartDate` excluded. Surfaces: **Competitions page** bottom = the
"📖 Record Book" card (company tiles gold, rep tiles teal, live watch/new
chips); **Home card** = "Personal bests" tile row + a flame nudge when the
current month is within 80% of (or beating) the rep's best; **Dashboard** =
gold record-moment banners for COMPANY, TEAM, and REP records (in-progress
records + records set in the last 7 days, `prev` required so a first-ever
period never banners; company → team → rep priority, max 3 shown; dismissals
stick per record+period in `tt_rec_dismissed` localStorage).

## Performance page (`src/pages/Performance.jsx`, manager+)

REBUILT (per Keaton, from an approved mockup) as ONE simplified page — the
single source for the numbers we collect: part from the RepCard webhooks
(appointments + door knocks), part from the site (deals/revenue). Route
`/performance`, guarded manager/director/vp/admin. **All math lives in
`src/utils/perfSummary.js` (`buildPerformance`) — the page only renders.**
The old engine (`utils/performance.js` — grains, zoom, bucketize,
targets, donuts, change-over-time table, weekly-estimates entry) is GONE;
the `targets` table + `rep_goals`/`weekly_stats` stores remain for Goals/
Home. (There is no longer any UI for hand-entering weekly estimates —
estimates come from the leads feed; set `estimates_from_leads_date`.)
- **Controls (sticky on desktop):** Dashboard-style date pills (This week
  … YTD, no All-time) + custom from/to, a "Compare to previous period"
  toggle (`getPreviousRange` — the equal-length prior window; MTD compares
  to the same day-count of last month), team jump chips, Collapse/Expand
  all. Prefs in `tt_perf2_prefs` localStorage. Admin buttons: **Import
  field CSV** (`csvToFieldActivity` → `upsertFieldActivity`) and **Floors**
  (red-flag thresholds → `app_settings.perf_floors`, exposed as `perfFloors`).
- **Org Scoreboard:** Revenue (baseline), Monthly goal (`monthly_goals`,
  only when the range sits inside one month), Deals, Avg deal size, Avg
  markup (DOLLAR-weighted: (Σjob − Σbaseline) ÷ Σbaseline), Rep commissions
  (admin/VP only). **By office** cards (deals/revenue/markup/avg deal/
  **commission** + share bar; "No office" last). Office commission is the
  deal's WHOLE rep commission (setter + closer shares, NEVER overrides), so
  the offices always sum to the org Rep-commissions tile — unlike the
  team/rep numbers, which split that same money by who earned which share.
  Admin/VP only, like every other commission figure here. **Appointments & field** strip from the
  RepCard feed: doors → set → ran (show rate) → sold (close rate), self-gen
  vs lead ran.
- **Teams:** one collapsible section per org-chart team (`headIdSet`,
  DATE-EFFECTIVE via `teamOfSale`, same as the Dashboard), sorted by
  revenue; former-lead teams marked "Former team"; **Unassigned last**
  (dashed amber — ownerless deals + reps with no team). Team tiles (revenue,
  deals, avg deal, avg markup, active reps = active members as of the range
  end) then a rep table split into **Field activity · RepCard** (Doors,
  Doors/day, then THREE appointment columns: **Set** = appointments this rep
  booked; **Self-gen ran** = how many of THOSE ran — **credited to the SETTER
  whoever sat it** (per Keaton), with the % of their sets that ran as its
  sub-line; **Leads ran** = appointments they SAT for another setter.
  This went four rounds (the math, the labelling, the count, then the
  definition): there is no "Ran" column (it was self-gen + leads ran) and no
  separate "Sets ran" (it IS self-gen ran under this rule).
  **`sgRan` and `leadRan` are per-person CREDIT columns, NOT a partition of
  `ran`** — one appointment set by A and sat by B gives A a self-gen ran AND
  B a leads ran, so at org/team level the two can sum past `ran`. That is
  why the org funnel strip shows only Doors → Set → Ran → Sold: `ran`
  (appointments a person SAT) stays a true count, and mixing credit columns
  into a funnel would double-count. A pure setter reads Set 20 · Self-gen
  ran 15 (75%) · Leads ran 0. A pure closer reads Set 0 · Self-gen ran 0 ·
  Leads ran 40. Bonus: SG close % finally compares like with like, since
  both sides now follow the setter (deals they own ÷ their appointments that
  ran). NOTE `estimates.js` still defines a self-gen estimate as one the rep
  set AND ran, so the Goals page's SG-estimate metric does not follow this
  rule — align it if that ever matters.
  **An appointment with NO SETTER recorded counts as a LEAD ran, never a
  self-gen** (per Keaton) — the old rule credited the runner, which showed a
  closer 10 self-gen ran against 3 set. Same rule in `estimates.js`
  (`leadEstimates`), so Goals/Home self-gen estimate counts follow. The
  engine tallies these as `gaps.noSetter` / `noSetterRan` /
  **`unmatchedSetter`** (the FIXABLE half: the feed DID send a setter name,
  it just matched no profile — spelling, a nickname, someone off the roster,
  or a name two profiles share, which resolves to NEITHER by design. The
  row keeps the name in `setter_name` text while `setter_id` stays null, so
  the Leads select read "— none —" and the name was invisible; it now shows
  under the select as "feed: <name>"). The page flags all this in the amber
  banner, and the link goes to `/leads?missing=info`.
  **The Leads page has ONE "Missing info" filter** (per Keaton — not one per
  field), backed by `hasGap`/`gapReasons` in `src/utils/leadGaps.js`: no
  setter, OR it RAN with no closer recorded, OR its time has passed and the
  status is still `scheduled` (the CRM never sent an outcome, so it counts
  as neither ran nor cancelled anywhere). Deliberately NOT "any empty
  field" — a FUTURE appointment with no closer yet is normal, and flagging
  it would bury the real gaps. Each row states which gap(s) it has under the
  customer name, naming an unmatched setter. Any `?missing=…` value turns
  the filter on, so older `?missing=setter` links still work.
  **Names that are NOT field reps (`app_settings.feed_non_reps`, Admin →
  Settings → "Feed: Not Field Reps", exposed as `feedNonReps`).** The CRM
  names people who will never match a profile — INSIDE SALES (Josh Hilton)
  and reps who have LEFT (Jack Darrah, Axcel Fragoso) — so without this
  every one of their appointments reads as a missing setter forever and the
  worklist never empties. `nonRepSet(names)` / `isNonRep(name, set)` in
  `leadGaps.js` are the one rule: whole trimmed name, case-insensitive,
  NEVER a substring (which would make "Jack" swallow "Jackson"). Consumers:
  `hasGap`/`gapReasons`/`needsAttention` (4th arg) and `buildPerformance`
  (`nonRepNames`, which stops the `gaps` tally counting them).
  **It changes NO count** (per Keaton: "keep the appointment, drop Josh") —
  inside sales books it, a field rep runs it, and the field rep keeps that
  Leads-ran credit; the name just stops being a fixable gap. That makes it
  a DIFFERENT decision from the two neighbours it is easily confused with:
  `leads.ignored` drops the row from every count, and `perf_excluded_ids`
  hides a real PROFILE from the Performance page. A non-rep name still shows
  as "feed: <name>" under the empty select, but muted grey instead of amber.
  A non-rep setter does NOT excuse the other gaps — a past-due row with no
  outcome is still flagged.
  **The Leads page carries no team/rep stat board** — those stats live on
  Performance now; this page is the appointments themselves.
  **Duplicates + `leads.ignored` (migration 049).** RepCard creates a NEW
  appointment record when one is REASSIGNED to another closer instead of
  updating the original, so the same doorstep arrives twice with two
  different `external_id`s — dedup can't help, both are genuine records to
  the feed (real case: "Eda", 6:30pm, 860132 → Jordan and 860191 → Stephen,
  52 minutes apart; six such pairs live). `duplicateIds` groups by
  source + lowercased customer + exact `appointment_at` (NOT address — a
  reassignment can reformat it), skips unnamed rows, and ignores... ignored
  ones, so ignoring one of a pair clears the flag on its survivor. The
  single **"Needs attention"** filter = `needsAttention` (a gap OR a
  duplicate, never an ignored row). An admin's **Ignore** button sets
  `ignored` — NOT `pinned`, which is a different decision (pinning freezes
  status/people against the feed). An ignored row stays visible but greyed
  and is skipped by `perfSummary`, `estimates.js` and the Leads KPIs/day
  counts. It is a FLAG, not a delete, because the feed is keyed on
  `(source, external_id)` and would recreate a deleted row on the next event;
  it survives because the feed only writes columns its payload supplied.
  NOTE the deliberate asymmetry with DEALS:
  `saleOwnerId` still falls back to the closer so no deal vanishes, so a
  setter-less deal is a self-gen DEAL while a setter-less appointment is a
  lead RAN) and **Results · Site** (**Self-gen deals** = the
  owner-credited deals, **SG close %** = self-gen deals ÷ self-gen ran,
  Lead closes, **Lead close %** = lead closes ÷ leads ran. **Both
  deal-over-appointment rates render BLANK when they would exceed 100%**
  (`rateOrNull`, per Keaton): DEALS come from the site (ArcSite sync) and
  APPOINTMENTS come from the CRM, and **a rep can close a sale without ever
  logging an appointment**, so some deals will always have no appointment
  behind them. A rate over 100% measures that gap, not performance — one row
  read "250% close". Never CAP it at 100% either: blank says "can't be read
  as a rate", a cap would lie. `showRate` needs no guard since `setRan`
  counts a subset of `set`. **Revenue** =
  self-gen (owner-credited) baseline, **Total revenue** = self-gen revenue +
  baseline of the deals the rep CLOSED for another setter (`leadRevenue`;
  a per-rep view — a team's Total revenue double-counts a deal whose setter
  and closer are both on it), Markup, Commission — admin/VP only). The
  three conversion rates come from the engine
  (`showRate`/`sgCloseRate`/`leadCloseRate` in `finish()`), muted in the
  table, and echo on the org funnel tiles. The "Field activity · RepCard" /
  "Results · Site" group labels were removed (per Keaton) — a thin divider
  still separates the two halves.
  **Default team + hidden people (per Keaton):** `buildPerformance` takes
  `defaultTeamId` (everything that would be Unassigned — no owner, owner on
  no team, reps with no team — is filed under that head; the section is
  tagged "includes unassigned" and never rendered as "Former team") and
  `excludedIds` (people who are not reps, e.g. Tanner Arnett: no row, AND
  their deals/appointments/knocks leave every total ON THIS PAGE, so org
  totals here can differ from the Dashboard by exactly their production;
  a lead close by an excluded closer is dropped but the setter keeps the
  deal). Stored as `app_settings.perf_default_team` (head id, '' = keep an
  Unassigned section) and `perf_excluded_ids` (ids), edited in the page's
  admin **Settings** panel (with the floors). Until saved, the page SEEDS
  them from the roster: default team = "Garrison Shaker" (else the active
  director), excluded = anyone named "Tanner Arnett". A saved value, even
  empty, always wins over the seed. The footer names both. First/last knock, field time and knock days were REMOVED
  from the table + mapper (per Keaton: RepCard's knock webhook carries only
  the knock; the engine still computes them and the DB keeps the columns).
  **Lead closes** = deals where the rep is the CLOSER and someone else set
  it — the setter keeps the deal (owner credit), the closer gets the lead
  close, like the Home card; never an extra deal. Head pinned first, then
  revenue desc; a Team total row.
  **Every rep row is attributed by date** — a rep who moved mid-range
  appears under EACH team with only that team's work ("Moved teams" note),
  so a team's total always equals the sum of its rows. Current members with
  nothing in range still get a zero row. Ghost rows hidden from non-admins.
- **Attribution rules** (engine header comment is canonical): deal count +
  revenue → owner (`saleOwnerId`) on the owner's team as of the sale date;
  **commission per rep = that rep's OWN share only** (`dealAmounts.setter` /
  `.closer`, never overrides), landing on each rep's own team — so team
  commission can differ from "commission on the team's deals". SET credits
  the setter on the appointment day (any status); RAN = `RAN_STATUSES`
  credited to whoever ran it (set-and-ran = self-gen, else lead); SOLD =
  status `sold`. Field activity credits `profile_id` on `activity_date`.
  Canceled deals never count. `apptDay` for appointment days (never a UTC
  slice).
- **Red flags** (`repFlags`): a figure below the admin floor turns red.
  Door floors (doors/day, knock days, field time) apply only once the TEAM
  has field activity in range — before the feed is wired every doors figure
  is 0 and flagging them all would be noise; set/ran floors always apply.
  Field columns show "—" for a rep with no activity rows while the feed is
  dark.
- **There is NO data-quality banner** (removed per Keaton — it said the same
  three things on every load and dominated the top of the page). The engine
  still returns `gaps` (noSetter/noSetterRan/unmatchedSetter) and `unmatched`
  (door knocks for names not on the roster — their doors count in the org
  total, on no team); nothing renders them. Do not re-add a standing banner:
  gaps belong where they can be acted on — the Leads page's "Needs attention"
  filter, and the `feed_non_reps` list for names that will never match.

## Field activity feed (door knocks, migration 048)

`field_activity` = ONE row per rep per ARIZONA day (`doors_knocked`,
`first_knock_at`/`last_knock_at`, `field_minutes` when the CRM reports time
in field, else derived last − first at display time; `rep_key` is a
GENERATED column = profile id else lowercased name so the day UNIQUE key
`(source, rep_key, activity_date)` works for unmatched reps too).
`field_knocks` = the raw per-door event log (UNIQUE `(source, external_id)`
so a re-fired webhook is a no-op) with an AFTER INSERT trigger
`field_knocks_rollup()` that upserts the rep's day row (doors +1, first/last
min/max; day = `knock_at AT TIME ZONE 'America/Phoenix'`).
- **ONE URL HANDLES BOTH FEEDS.** RepCard posts the SAME contact object for
  an appointment and for a door knock, and a vendor webhook usually points at
  one url — so a knock sent to `/api/leads/ingest` became a junk "Not Home"
  appointment and never reached Performance. `routeCrmEvents(rawBody,
  arrivedAt)` now CLASSIFIES every event and hands it to the right handler
  regardless of which endpoint it hit: an appointment time → leads, a knock
  flag / doors count / admin-mapped knock time → field activity, BOTH → both
  (a knock that booked an appointment is genuinely both), neither → the
  endpoint it arrived at. **A knock TIME alone is not a knock signal unless
  the admin explicitly mapped that field** — the default path reads RepCard's
  `createdAt`, which every contact carries, so trusting it would turn every
  appointment into a door knock. An explicit knock flag decides outright
  (truthy = knock, falsy = never a knock). The router records the payload +
  result under the feed(s) that actually handled the call, so the right
  Settings panel shows it.
- **Last result** (`lead_last_result` / `field_last_result` in app_settings,
  rendered under "Last received" in each feed panel): what the site DID with
  the last call — knocks recorded, appointments upserted, per-event lines
  (who, knock/day-summary/skipped + why, roster match), unmatched names, or
  the write error. The vendor's webhook screen never shows our response, so
  this is the only place to read it.
- **Ingest:** `POST /api/field/ingest` on `server.js`, same auth as the
  leads feed (`LEADS_INGEST_SECRET` / service key). Admin-mapped fields
  (`app_settings.field_activity_field_map`, Admin → Settings → "Field
  Activity Feed" — the same `FeedEditor` component as the lead feed; the
  last payload is stored as `field_last_payload`). People resolve by email
  then name via the shared `loadRosterResolver()`. A payload with a
  `doors_knocked` count is a DAILY SUMMARY (upserted on the day key, its
  numbers win); one with a `knock_at` is a PER-KNOCK EVENT (→ field_knocks →
  trigger). Partial-update rule as for leads: only columns the payload
  supplied are written. Unmatched people come back as `unmatched_people`.
- **CSV fallback:** `csvToFieldActivity(text, profiles)` in
  `utils/fieldActivity.js` (lenient headers: Rep/User, Date, Doors Knocked,
  First/Last Door Knock, Time Spent In Field; hours if the header says
  hours) → `upsertFieldActivity` with source `repcard`, so a report replaces
  the feed's day row rather than duplicating it.
- `summarizeActivity(rows)` is the one aggregation rule: doors, knockDays
  (days with ≥1 door), doorsPerDay, fieldMinutes, and first/last knock as
  AVERAGE local clock times across knock days (`fmtClock`/`fmtHours`).

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
- **Invite flow (preferred) vs manual passwords.** The Admin → Users key
  button offers two paths: EMAIL AN INVITE (server `invite` action → GoTrue
  `/auth/v1/invite` — creates+links the auth user, emails a link landing on
  `/set-password` where the user picks their own password; self-heals
  half-created logins by adopting + sending a recovery email) or the legacy
  manual temporary password. Password resets likewise: `send_reset` (GoTrue
  `/recover` email) or manual. The login page has "Forgot password?"
  (`sendPasswordReset` in db.js → same `/set-password` landing).
  `/set-password` (`src/pages/SetPassword.jsx`) reads the hash-token session
  and calls `supabase.auth.updateUser`. ALL email paths require SMTP
  configured on the GoTrue service (see SETUP.md "Email" section — Resend +
  `GOTRUE_SMTP_*` vars + `GOTRUE_URI_ALLOW_LIST` including `/set-password`);
  until then they return a clear error and manual passwords remain the
  fallback. The frontend passes `window.location.origin` so redirect links
  always target the calling site.
- **Email = login, always.** Changing a user's email (Edit modal or the
  password flow) goes through `userAdmin('change_email', { email, newEmail })`
  — the server updates the GoTrue login FIRST, then mirrors `profiles.email`,
  so the roster email and the sign-in email can never diverge. Never write
  `profiles.email` directly for a user who has an `auth_id`.
- **People tab (`src/components/PeopleChart.jsx`, replaced the Users list —
  per Keaton, approved from a mockup):** the roster as an ORG CHART.
  Leadership row (every admin/VP/director, ranked) across the top; then one
  COLUMN per team head (`headIdSet`, sorted by name; managers always get a
  column even when empty; a director/VP head's column is labeled "led by
  their <role>"), reps stacked beneath; **Unassigned is a real column**
  (dashed, amber) and a valid drag source. **Drag a rep onto another column
  to move them** — the chart only allows non-heads to drag (moving a head
  triggers the reports cascade, which stays in the Edit form via
  `saveUser`); the page's `moveUser` confirms ("logged today… past deals stay
  with <old team>") then writes through `patchUser` → `updateUser` so the
  `team_changes` trigger stamps the move, and refetches the log so the card's
  "since" updates. **Deactivated people appear ONLY in a collapsed drawer**
  at the bottom (never faded in place), each with the Reactivate button;
  toolbar has a "Deactivated · N" pill that opens it. Phones: columns stack,
  each collapsible (`tt_people_collapsed`; first open by default), row
  actions fold into a ⋯ menu that also offers a **"Move to…"** select since
  touch has no HTML5 drag. **A column's header is ONLY the team name** (the
  editable banner + count); **the head is a normal person card pinned to the
  top of the column's list**, role tag showing, with the same hover actions
  as every rep (per Keaton). Earlier versions put the head's name + actions
  in the header and the action overlay floated over the rename pencil. Row badges (role/admin/ghost/no login) are
  display-only; edits go through the Edit modal (`UserModal`), which shows a
  **Team History** panel (that user's dated reports-to moves from
  `team_changes`, newest first, plus current lead + since-date). The Team
  change log stays a collapsible below the chart.
- **Setter/Closer in the DealModal are type-to-search pickers**
  (`PersonPicker` in DealModal.jsx — the roster outgrew dropdowns); the
  small selects (manager/director/VP/status/office/payment) stay native.
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
  **Team NAMES go through `teamLabel(head)` / `teamShortLabel(head)` in
  `utils/team.js` — never build `"<name>'s Team"` inline.** The official name
  is `profiles.team_name` on the HEAD (migration 046; teams are keyed by head
  everywhere, so it rides along wherever `users` is loaded); empty = default
  "<Head>'s Team". Edited inline on Admin → People by clicking the column
  banner (`onRenameTeam` → `patchUser(head.id, { team_name })`). Consumers:
  Dashboard team filter + breakdown rows, Deals scope options, Performance
  (scope name, Teams-vs-Goal, chart series, target picker, rep-breakdown
  groups), Goals + Leads team groups, Competitions (team-type entrants,
  squad pickers), the Record Book's team records, and the People chart's
  columns / Move-to menu / drawer.
- **Deal manager auto-fill:** picking a setter/closer in the DealModal (and
  the sync's schedule pass) backfills a MISSING `manager_id` from that
  person's current reports-to — ONLY when that person's lead has the
  `manager` ROLE (a director/VP-managed rep gets none; stamping the director
  would double-pay). Never overwrites an assigned manager.
- **"Reports to" (`profiles.manager_id`) can be a manager, DIRECTOR, or VP** —
  some reps are managed directly by Garrison (director). It drives Team-page
  grouping (team heads = managers + anyone with direct reports), goal
  permissions, and Dashboard team breakdowns. BUT the deal-level
  manager-override default only applies when the reports-to person is an
  actual MANAGER — the sync (`profById` role guard) stamps `deal.manager_id`
  null otherwise, so a director never double-dips manager + director override.
- **Deactivation:** the **Deactivate** button (UserMinus) on a person's row in
  the People chart, beside Edit and Delete, flips `profiles.active`.
  **Deactivate is how someone LEAVES; Delete is only for a row created by
  mistake** — a real person's deals still reference them. The action lived
  only in the old Users list, so when `PeopleChart` replaced that list it was
  lost and Delete became the only exit on the row: `onToggleActive` was wired
  through but called ONLY by the drawer's Reactivate, and `UserModal` has no
  Active field. Keep both directions reachable. A deactivated
  user is signed out and blocked at login (`AuthContext.fetchProfile` checks
  `active`), but **all their deals/stats stay and still count** — never filter
  aggregates by `active`. When user admin is configured (SUPABASE_SERVICE_KEY
  on the site service), deactivating also
  bans their auth login so a live token can't keep them in. **Reactivation
  is the labeled "Reactivate" button on the deactivated row** (same
  `toggleActive` → `set_active true` lifts the ban); a "Deactivated · N"
  filter pill next to the roster search isolates them. The old grey toggle
  on a 50%-faded row read as a disabled control, so nobody could find it.
  Deactivated people stay listed in their team's section (dimmed) — never
  filtered out of `fetchUsers`, since their deals still count everywhere.

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
data): reps set their OWN goals, managers set their team's reps' goals, admins
set any. **The GOALS PAGE (`src/pages/Goals.jsx`, route `/goals`, all roles)
REPLACED the Team page** (`/team` redirects; `Team.jsx` + `WeeklyStats.jsx`
deleted; MVP/Recent Wins/coach notes retired). It's the commitment workspace:
roster grouped by current team, each rep card = Week + Month blocks with three
goals (SG Estimates — self-gen only, Deals, Revenue — owner-credited; leads
ran/closed display alongside, never goaled), progress bars with pace status
(done/ahead/behind vs elapsed fraction), an estimate-goal streak flame, a
"No goals set" amber flag, and a goal-math helper (monthly revenue target →
suggested weekly/monthly deals + estimates from the rep's own trailing
3-month avg deal + close rate, "Use as targets" writes both rows). Engine =
`src/utils/goals.js` (pure): `currentPeriods`/`resolveGoal` (a period with no
row INHERITS the latest earlier row of the same period type — "carried"; any
save materializes the full current-period row)/`repProduction`/
`periodElapsed`/`metricProgress`/`suggestFromRevenue`/`estimateStreak`. Store
= `personal_goals` (migration 040; `fetchPersonalGoals`/`upsertPersonalGoal`
in db.js); saving a MONTHLY revenue goal also mirrors into `rep_goals` so the
Performance page's rep-goal fallback stays in sync. The Home "My Card" shows
a read-only "My goals" mirror (same engine) + a "Set goals →" link. Legacy
`rep_goals` (024) remains for team-scope goals + Performance fallbacks. The
Dashboard's goal is the company-wide revenue goal (separate `monthly_goals`
table, admin-only).

**Visibility (view scoping, NOT edit) by sales title:**
- **Deals page SCOPE dropdown (per Keaton, mirrors the Dashboard's team
  filter):** `scope` state in `Deals.jsx`, options built by role in
  `scopeOptions` — **admins** pick any team (a head id, filtered via the same
  date-effective `teamOfSale` the Dashboard uses, so "X's Team" matches on
  both pages); **managers/directors/VPs** get All / **My team** (`teamOfSale
  === profile.id`); **reps** get **My deals** (setter or closer = them) / All.
  Reps DEFAULT to My deals — what the page always showed them — and opt into
  All; everyone else defaults to All. This is a UI filter: reps can now see
  every deal's rep commission, which the company-wide Dashboard leaderboard
  already exposed. The DealTable commission cell renders ONLY
  `repCommission`/setter/closer — never override $ — so widening the rep view
  leaks no management money. The bell deep-link resets scope to All so the
  target deal can't be hidden.
- **Rep:** NEVER any override amounts, anywhere. Reps DO have Goals-page
  access (to set their own goals and see the roster), consistent with the
  company-wide Dashboard.
- **Manager/Director/VP:** their OWN override on the Commissions page. The
  Commissions page is siloed by identity (`myParts(deal, id)` only emits roles
  the viewer personally holds), so nobody sees anyone else's
  commission/override there.
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
`useSettings()`, consumed in `NotesThread`). `weekly_goal` (number or null) —
the Dashboard's company weekly revenue goal (shown inside the Monthly Goal
card, always tracking the CURRENT Sun–Sat week regardless of the page's date
range; null/absent = auto: monthly goal ÷ weeks in the month; admin edits it
inline on the card via `save('weekly_goal', v)` from `useSettings()`).
`sync_excluded_reps` +
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

**Deals page filter bar (`FilterBar.jsx`) + pagination.** Laid out like the
Dashboard's filter row: date-range preset pills ALWAYS visible (one click, no
hidden sliders toggle), the which-date picker (`DATE_FIELDS`) and the scope
dropdown beside them, then search + rep/status/office/payment selects, then
active-filter chips. **The rep filter is MULTI-select and searchable**
(`repFilters` = array of profile ids, empty = everyone; a deal matches when
ANY selected rep set or closed it). `src/components/RepMultiSelect.jsx`
exports `RepMultiSelect` (trigger + popover, used by FilterBar) and
`RepPickList` (the search + checkbox body, used inside the Deals table's
column-header menu) so both surfaces share state. One chip per selected rep.
**Custom-chevron selects need `appearance-none`** — a native `<select>` draws
its own arrow under the overlaid `ChevronDown` and shows as a faint double
arrow (fixed in FilterBar's `Select` and DealTable's `DateFilterPanel`; apply
it to any new select that overlays an icon). The table is PAGINATED (`Pager` in `Deals.jsx`, 50/page
default, 25–200 remembered in `tt_deals_page_size`); KPIs and Export CSV
cover the WHOLE filtered set, never just the visible page. Page resets to 1
on any filter/sort/scope/tab change, clamps when the list shrinks, and the
bell deep-link jumps to the page holding the deal.

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
**Run deals are listed in INSTALL-DATE order** (`runDeals`), matching the
Google Calendar so a run can be checked against it top-to-bottom (per
Keaton); same-day ties fall back to sale date then name, no-install-date
deals sink to the bottom. The sheet carries no install TIME, so within a day
the calendar's order can't be reproduced. The per-payee statement copy
(`copyPayee`) keeps its ROLE grouping — that's a pay stub, not a job list.

**Payroll page layout (rebuilt from a design review Keaton approved).** The
page had drifted into FOURTEEN stacked blocks with the actual work at 13 and
14: three separate amber banners of identical construction (unassigned
commission / missing office / not gold-checked), plus the deductions tray, all
sat between the money and the payee list. Now:
1. **Run status card** — total payout + a **three-segment progress bar**
   (`runStage.segments`: verified ÷ total, approved ÷ total, paid ÷ finalized)
   plus a stage label `In review` → `Approved — ready to pay` → `Paid — ready
   to lock` → `Locked`. It replaced four flat tiles, one of which
   ("Deals 2/19") was a progress bar pretending to be a statistic. **One bar
   tied to paid ÷ finalized was wrong** — it read 0% on a run that was fully
   verified AND fully approved, which is where most of the work is; it only
   moved at the last step. One segment per stage, aligned with the three
   counts printed beneath it. The not-yet-finalized line lives inside it.
2. **"Before you pay"** — ONE amber card, one row per problem, each expanding
   to the same deal chips as before (`checks` = the three deal-level lists,
   filtered to non-empty; the deduction ledger is a fourth row). A CLEAN run
   renders a single green "Everything checks out" line instead of nothing,
   which reads as reassurance rather than absence. **Do not re-add a
   standalone banner here** — add a row to `checks` instead.
3. **"Who gets paid"** — the payee panel, which is the workspace (statement
   copy, adjustments, deduction takes). The rep filter and the bulk actions
   (Approve all / Mark all paid / Lock run) moved INTO its header rather than
   occupying two more strips above it.
4. **Deals in this run** — below, the audit trail, now a real COLUMN table
   (per Keaton, from a mockup drawn at 1100px = a 1280 laptop minus the
   sidebar, because he always runs payroll from a laptop): Deal · Install ·
   Office · Setter · Closer · Overrides · Baseline · Commission · Status ·
   actions, with a heading row. The row was previously a name and ~600px of
   nothing, and **the INSTALL DATE — the sort key, the whole reason the list
   matches the Google Calendar — was hidden inside the expander.**
   `rowFacts(d, a, userById)` feeds the people columns; it reads the deal's
   own ids rather than `dealPayouts`, which drops zero-dollar shares (a setter
   earning $0 must still show as the setter). A share with money and nobody to
   pay reads amber "Unassigned"; a solo deal's closer reads "self-gen"; the
   Overrides column is a COUNT + total (`3 · $389.36`) because at laptop width
   there is room for two people, not five. Columns drop as the window
   narrows: below `xl` office/overrides/baseline, below `lg` the people,
   below `md` everything but name/commission/actions (phones get install +
   setter as a second line under the name).
   **Clicking anywhere on the row still expands it** (per Keaton) — only the
   NAME (opens the editor) and the action buttons stop propagation. The
   expanded card carries what the row can't: sale date, job price, rep pool,
   pay date, payment method, every payee with their role and — for
   manager/director/VP — the EFFECTIVE override rate (amount ÷ baseline, so
   exclusions read 2.7% not 3%), the deduction breakdown, and Edit deal.
   A "Show amounts" density toggle was mocked and NOT built: Keaton picked the
   single-line table plus the existing expander instead.
The rep filter is now `RepMultiSelect` (searchable, MULTI-select — `repFilters`
is an array pruned to people on the run, `effFilters`/`effSet`/`filtered`),
matching the Deals page instead of a bare `<select>`.
**`markAll` names the outstanding problems in its confirm** — "Mark 19 deals as
Paid? Of those, 3 not gold-checked, 2 missing an office. $810 in logged
deductions has not been taken off this run yet." The warnings are a scroll away
and this is money going out, so the confirm repeats them.
Deliberately KEPT (all judged right in the review): the DB-guarded lock system,
install-date ordering of run deals, inline deal expansion, and the role-grouped
pay statement.

**Deductions owed — the ledger (migration 050, `src/utils/deductions.js`).**
The case: the office emails a deduction for a job that ALREADY PAID OUT. A
payroll adjustment forces a pay date on the spot, and when the rep has no pay
that week there is no right answer, so it fell back on Keaton's memory. The
missing concept is a **balance owed**, not another adjustment. It all lives in
`payroll_adjustments`:
- **`pay_date` NULL = the DEBT.** What is owed, no run attached. It shows on
  every run until recovered or written off.
- **`pay_date` set + `parent_id` = a RECOVERY** of that debt. A recovery is an
  ordinary dated adjustment, which is exactly what Payroll already sums — so
  run totals, payee rows, pay statements, the CSV export and the lock guard
  needed NO changes. Migration 034's guard already tests `pay_date IS NOT
  NULL`, so a debt row passes through it and **no trigger changed**.
- **`pay_date` set, no parent** = the plain +/− that existed before. Untouched.
- **NEVER write to `deals.deduction_amount` for this.** That column feeds
  `dealAmounts()`, so editing it on a paid job silently rewrites that deal's
  commission on every page and in the backup spreadsheet — and the lock trigger
  rejects it anyway. A debt REFERENCES its deal (`deal_id`, nullable: a tool or
  an advance has no job).
- `buildLedger(adjustments)` is the ONE rule — returns each debt with `owed` /
  `recovered` / `remaining` / `recoveries` / `status` (`open` | `partial` |
  `settled` | `written_off`), in POSITIVE dollars though the rows stay signed.
  Over-collection clamps to settled, never to "we owe them" (that needs a
  human, not arithmetic). Sorted as a worklist: anything owed above anything
  closed.
- **Nothing is ever taken automatically and KEATON TYPES THE AMOUNT** (both
  per Keaton). The Payroll tray's Apply opens a number box prefilled with
  `suggestedTake` = min(remaining, their pay this run) — a starting point, not
  a cap; typing more warns (`wouldGoNegative`) and still allows it. A part
  payment leaves the rest outstanding and it carries to the next run by itself.
- **A partial take shows BOTH numbers on the cheque** (per Keaton):
  `recoveryLine(recovery, debt)` renders "partial — $310.00 of $640.00,
  $330.00 still owed" on the payee row, the pay statement (plain text AND the
  HTML email copy) and the rep's Commissions page. Statement items are tagged
  `grp: 'deal' | 'adj'` at push time — never inferred from the deal name, which
  would misfile a recovery whose job the rep is also being paid for that run.
- **Write-off** (`written_off_at`) closes a debt that will never be collected —
  a rep who left never has another run, so it would nag on every run forever.
  Stamped, never deleted. A debt with recoveries can't be deleted at all (it
  would erase money already paid); the UI says to write it off instead.
- Surfaces: a **"Log a deduction" button in the Payroll page header**, always
  there on the Pay run tab for admins (per Keaton) — the tray's copy was
  removed because the tray only renders once something is owed, so logging the
  FIRST one meant switching tabs; a **row of the run's "Before you pay" card**
  (see the Payroll layout note below) that expands to the per-rep take boxes;
  the **Deductions tab**'s "Logged after payout" list (Outstanding/All,
  with per-instalment history) — which sits ABOVE the older read-only report of
  deductions already priced into deals, a different thing; and the rep's own
  **Commissions page** card ("$X in deductions still to come out"), because a
  rep seeing it beats being surprised by a short cheque (per Keaton). Admins
  write; a rep only ever sees their own.

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

**Database backups are Railway volume snapshots** (Postgres service → Volume →
Backups → daily schedule; restore from the same list — see SETUP.md). The old
`scripts/Backup.gs` Drive export was retired; the Watchdog no longer checks a
backup heartbeat.

**`scripts/Watchdog.gs` (`watchdogRun`, hourly trigger).** A SITE/BACKEND
sentry only: pings the site, checks the sync heartbeat (incl. the DRY_RUN
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

## Timestamps vs calendar days — a recurring bug class

**Never `.slice(0, 10)` a timestamptz to get its calendar day.** Arizona is
UTC−7, so anything after 5pm local is stored as the NEXT day in UTC, and the
slice puts it on tomorrow. This bit three times in one session: appointments
after 5pm vanished from "today" (`apptDay` in `utils/estimates.js`),
competition rounds ending today read as over, and a rep moved after 5pm had
same-day sales attributed to their OLD team (`localDay` in `utils/team.js`,
used by `managerAsOf`). Derive the local day from `new Date(ts)` with
`getFullYear/getMonth/getDate`; only plain `date` columns (`sale_date`,
`pay_date`, `period_start`) are safe to compare as strings.

## Known low-severity items (not yet addressed)

- `getMonths` / `monthRange` slice dates in UTC, which can be off-by-one at
  month boundaries for users in negative-offset timezones. Left as-is.

## Build / verify

- `npm install && npm run build` should pass with zero warnings (prebuild
  runs ESLint with `no-undef` AND **`no-use-before-define` (variables)** as
  errors). The second rule exists because a `const` read ABOVE its own
  declaration builds fine and only throws when that line runs: a `useMemo`
  in `Leads.jsx` read `scoped` two hooks before `scoped` was declared, which
  white-screened the page in production while every node-level unit test
  passed. Hoisted `function` declarations are exempt — the codebase relies
  on those. If the rule fires, MOVE the declaration above its use (or the
  handler below it); never silence it.
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
