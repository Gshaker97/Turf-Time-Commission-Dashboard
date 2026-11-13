# Redesign Inventory — every visible element, by route and component

## How to use this checklist

Each section lists what a user can see or act on, with the exact on-screen label and the role gate as written in the code (file:line). After the UI-only redesign, walk every route per role (rep, manager, director, vp, admin, plus the Keaton and team-lead special cases) and tick off that each element is still present, still labelled the same, and still gated the same. Anything listed as "from useSettings()" is data-driven and should be checked with the live settings, not hard-coded.

## Role model (verified in code)

| Concept | Where defined | Meaning |
|---|---|---|
| `profile.role` | `profiles.role`; values `rep`, `manager`, `director`, `vp`, `admin` (src/components/UserModal.jsx:5 `ROLES`) | Sales title. |
| `isAdmin` | src/contexts/AuthContext.jsx:174 `effectiveProfile?.role === 'admin' \|\| effectiveProfile?.is_admin === true` | Site access. Most edit/mutate controls key on this, not on role. |
| `Guard roles=[…]` | src/App.jsx:56-65; `effectiveRoles = isAdmin ? [profile.role, 'admin'] : [profile.role]` (line 62) | An admin-flag user satisfies any `'admin'` requirement. Fails → `<Navigate to="/dashboard">`. |
| `isKeaton` | src/components/Layout.jsx:35, src/pages/RequiresAudit.jsx:11-12, src/pages/Deals.jsx:272: `email === 'keaton@turftime.com' \|\| name === 'Keaton Shaker'` | Identity gate for Requires Audit + the live deal audit. |
| `canSeeTeam` | src/components/Layout.jsx:45-50: `fetchMyTeams(profile)` returns > 0 teams | Data-driven (team lead or someone a lead reports to). Shows the "Bonus" nav item. |
| `isPreviewMode` / role clamp | src/contexts/AuthContext.jsx:175-177; NavBar.jsx:163-168 | Admin previews as `rep`/`manager` with `is_admin:false`. Amber banner. |
| `isViewingAs` (impersonation) | src/contexts/AuthContext.jsx:127-163 | Session swap; all writes blocked (`setReadOnly`). Red banner. |
| ghost users (`u.ghost`) | hidden from non-admins in pickers/leaderboards; see Gating summary | Deals still count; name hidden. |
| `demoMode` | src/contexts/AuthContext.jsx:184 | Hides "Change Password" (NavBar) and shows demo credentials (Login). |

## Table of Contents

Routes (App.jsx order)
- [/login](#route-login)
- [/set-password](#route-set-password)
- [/ (Layout shell)](#route--layout-shell)
- [/deals](#route-deals)
- [/dashboard](#route-dashboard)
- [/commissions](#route-commissions)
- [/leads](#route-leads)
- [/myteam](#route-myteam)
- [/competitions](#route-competitions)
- [/home](#route-home)
- [/payroll](#route-payroll)
- [/import](#route-import)
- [/audit](#route-audit)
- [/goals](#route-goals)
- [/admin](#route-admin)
- [Redirects: /team, /performance, *](#redirects)

Components (src/components)
- [AuditStrip](#component-auditstrip)
- [CompetitionModal](#component-competitionmodal)
- [DateRangeFilter](#component-daterangefilter)
- [DealModal](#component-dealmodal)
- [DealTable](#component-dealtable)
- [DeductionModal](#component-deductionmodal)
- [DialogHost](#component-dialoghost)
- [ErrorBoundary](#component-errorboundary)
- [FilterBar](#component-filterbar)
- [KpiCard](#component-kpicard)
- [Layout](#component-layout)
- [Logo](#component-logo)
- [ManagerBackfillModal](#component-managerbackfillmodal)
- [NavBar](#component-navbar)
- [Notices](#component-notices)
- [PeopleChart](#component-peoplechart)
- [RepActivityTable](#component-repactivitytable)
- [RepMultiSelect](#component-repmultiselect)
- [SettingsPanel](#component-settingspanel)
- [TeamMoveModal](#component-teammovemodal)
- [UserModal](#component-usermodal)
- [useAudit (hook)](#hook-useaudit)

- [Gating summary](#gating-summary)
- [Undetermined items](#undetermined-items)

---

# Routes

## Route: /login

File: src/pages/Login.jsx. App.jsx:72 — signed-in users are redirected to `/dashboard`.

### Who can see it
Anyone signed out.

### Fields shown
| Element | Label / text | File:line |
|---|---|---|
| Logo | `<Logo size={48} />` | Login.jsx:51 |
| Brand line | `TURF TIME` | Login.jsx:52 |
| Title | `Commission Dashboard` (sign-in) / `Reset your password` (forgot) | Login.jsx:54-55 |
| Error box | `error.message` or `This account has been deactivated. Contact an administrator.` (when `deactivated`) | Login.jsx:58-63 |
| Info box | `If {email} has an account, a reset link is on its way. Check your inbox (and spam) — the link works once.` | Login.jsx:33, 65-69 |
| Forgot copy | `Enter your work email and we'll send a link to choose a new password.` | Login.jsx:106-108 |
| Demo credentials block (demoMode only) | `Demo credentials`, `keaton@turftime.com (VP) · garrison@turftime.com (Director)`, `jared@turftime.com (Manager) · stephen@turftime.com (Rep)`, `admin@turftime.com (Admin)`, `Password: TurfTime2026!` | Login.jsx:127-136 |
| Footer | `Access is invite-only — new here? Your invite email has your link.` | Login.jsx:138-140 |

### Action buttons & controls
| Element | Label | Notes | File:line |
|---|---|---|---|
| Email input | label `Email`, placeholder `you@turftimeaz.com` | required, autoFocus | 74-78 (signin), 110-113 (forgot) |
| Password input | label `Password`, placeholder `••••••••` | required | 82-92 |
| Show/hide password | Eye / EyeOff icon button | toggles `showPwd` | 93-96 |
| Forgot link | `Forgot password?` | switches to forgot mode | 84-87 |
| Submit | `Sign in` / `Signing in…` | disabled while loading | 100-103 |
| Forgot submit | `Email me a reset link` / `Sending…` | | 116-118 |
| Back | `Back to sign in` (ArrowLeft icon) | | 119-123 |

### Tabs / sub-views
Two modes: `signin` and `forgot` (Login.jsx:9, 71).

### Role differences
None (pre-auth). `demoMode` shows demo credential block (Login.jsx:127).

---

## Route: /set-password

File: src/pages/SetPassword.jsx. No Guard (App.jsx:75) — invite/reset links land here.

### Who can see it
Anyone with a token in the URL hash (Supabase session). Without a session, shows an invalid-link state.

### Fields shown
| Element | Text | File:line |
|---|---|---|
| Logo, `TURF TIME` | | 61-62 |
| Title | `Create your password` (hasSession) / `Set password` | 63-65 |
| Checking state | `Checking your link…` | 69 |
| Invalid state | `This link is invalid or has expired. Invite and reset links only work once and for a limited time.` + `Use "Forgot password?" on the sign-in page to get a fresh link, or ask an admin to resend your invite.` (link to `/login`) | 71-80 |
| Form copy | `Choose the password you'll use to sign in from now on.` | 83-85 |
| Error box | `Use at least 8 characters.` / `The passwords don't match.` / server error | 41-42, 86-91 |

### Action buttons & controls
| Element | Label | File:line |
|---|---|---|
| New password input | label `New password`, placeholder `At least 8 characters` | 93-97 |
| Show/hide toggle | Eye/EyeOff | 98-101 |
| Confirm input | label `Confirm password`, placeholder `Type it again` | 105-108 |
| Submit | `Set password & sign in` / `Saving…` (Lock icon) | 110-113 |

### Tabs / sub-views
Three states: `!ready`, `!hasSession`, form (SetPassword.jsx:68-115).

### Role differences
None.

---

## Route: / (Layout shell)

File: src/components/Layout.jsx, wrapped by `<Guard>` (App.jsx:76 — any signed-in user with a profile). Index redirects to `/dashboard` (App.jsx:77). Renders NavBar, sidebar, bottom tab bar, Notices, DialogHost, ErrorBoundary.

### Who can see it
Any signed-in user with a profile. Not signed in → `/login` (App.jsx:59).

### Fields shown
| Element | Text | Gate | File:line |
|---|---|---|---|
| Impersonation banner (red) | `Viewing as {viewingAs.name} — you are seeing exactly what they see`, pill `read-only`, button `Back to me` | `isViewingAs` | Layout.jsx:68-85 |
| Preview banner (amber) | `Viewing as {profile.name} · {profile.role} permissions`, pill `{role}`, X close button | `isPreviewMode` | Layout.jsx:88-101 |
| Sidebar (desktop `md:`) | icon rail, expands on hover to labels | always | Layout.jsx:110-152 |
| Role badge in sidebar | `{role}` text (hover) / dot (collapsed); amber when preview | always | Layout.jsx:142-150 |
| Bottom tab bar (mobile) | icon + `short` label per nav item | always, `md:hidden` | Layout.jsx:171-197 |

### Navigation items (sidebar + bottom bar share `items`)
| Order | to | label | short | Gate (Layout.jsx) |
|---|---|---|---|---|
| 1 | /home | Home | Home | roles rep,manager,director,vp,admin (line 16) |
| 2 | /dashboard | Dashboard | Stats | all roles (17) |
| 2b (inserted after Dashboard) | /myteam | Bonus | Bonus | `isAdmin \|\| canSeeTeam` (56-59) |
| 3 | /deals | Deals | Deals | all roles (18) |
| 4 | /leads | Leads | Leads | all roles (19) |
| 5 | /commissions | Commissions | Pay | all roles (20) |
| 6 | /competitions | Competitions | Comps | all roles (21) |
| 7 | /goals | Goals | Goals | all roles (22) |
| 8 | /payroll | Payroll | Payroll | roles vp,admin (23) |
| 9 | /import | Import | Import | roles vp,admin (24) |
| 10 | /admin | Admin | Admin | roles admin (25) — admin-flag users qualify via `effectiveRoles` (53) |
| last | /audit | Requires Audit | Audit | `isAdmin \|\| isKeaton(profile)` (60) |

### Role differences
- `effectiveRoles = isAdmin ? [role,'admin'] : [role]` (Layout.jsx:53) — an `is_admin` rep sees Payroll/Import/Admin.
- Bonus nav appears only for admins or users returned by `fetchMyTeams` (Layout.jsx:45-59).
- Requires Audit nav appears only for admin or Keaton (Layout.jsx:60).

---

## Route: /deals

File: src/pages/Deals.jsx. Renders FilterBar, KpiCard ×5, DealTable, Pager, DealModal. No route Guard beyond Layout.

### Who can see it
All signed-in users. Data is RLS-scoped (`fetchDeals()`).

### Fields shown
| Element | Label | Detail | File:line |
|---|---|---|---|
| KpiCard | `Revenue` | value `{baseline}` labelled `Baseline`, value2 `{totalJobPrice}` labelled `Job Price` | Deals.jsx:524-526 |
| KpiCard | `Commissions` | `fmt(totalComm)` | 527 |
| KpiCard | `Deals` | `{total}`; sub `{canceled} canceled · {pct}%` when canceled > 0 | 528-529 |
| KpiCard | `Avg Comm` | sub `{avgMarkupPct}% markup` | 530 |
| KpiCard | `Avg Deal` | value `Baseline`, value2 `Job Price` | 532-534 |
| Review tab helper text | `Every deal needing anything — unverified, flagged ❗, or missing info. Search & filters don't apply here.` / `🎉 Nothing to review — every deal is verified and complete.` | canStage, reviewTab==='review' | 559-565 |
| Showing line | `Showing {from}–{to} of {total}` | | 570-572 |

### Table columns
See [DealTable](#component-dealtable). Columns: `Deal`, `Office`, `Payment`, `Status`, `People`, `Dates`, `Revenue`, `Commission`, plus `Actions` when `canEdit` (DealTable.jsx:89-98, 953-957).

### Filters / sort / search
- FilterBar (hidden when `onReview`, Deals.jsx:508): date presets (DateRangeFilter), `Which date` select (`Closing date`/`Install date`/`Pay date` from DealTable.jsx:15-19 `DATE_FIELDS`), scope select, search `Search deal, address, ID…`, RepMultiSelect, `All Statuses`, `All Offices`, `All Payments`, chips row.
- Scope options (Deals.jsx:212-219):
  - isAdmin: `All Teams` + one per team head `teamLabel(h)`.
  - role rep: `My deals` (default), `All deals`.
  - other roles: `All deals`, `My team`.
- Default date range: MTD (Deals.jsx:114-116). Default sort `sale_date` desc (118-119).
- Column header menus (DealTable HeaderMenu): `Sort` → `Ascending` / `Descending`; `Filter` per column.
- Pager (Deals.jsx:41-77): `Showing {from}–{to} of {total}`, page number buttons with `…`, `Previous page` / `Next page` aria-labels, `Per page` select options `25`, `50`, `100`, `200` (PAGE_SIZES line 38; default 50, persisted `tt_deals_page_size`).

### Action buttons & controls
| Element | Label | Gate | File:line |
|---|---|---|---|
| Staging tabs | `Needs review` (with count badge) / `All deals` | `canStage = isAdmin \|\| profile.role === 'vp'` (136, 541) | 541-557 |
| AuditControls | `Refresh` + `updated {ago}` / `Running audit…` / `The audit runs on the live site (disabled in demo mode).` / `Audit failed: … retry` | shown when reviewTab==='review'; Refresh button needs `canAudit` | 558; AuditStrip.jsx:24-50 |
| Export | `Export CSV` (title `Export all N deals in view to a CSV — every page, not just this one`) | all; disabled when empty | 573-578 |
| FAB | `+` (Plus icon, round teal) — opens New Deal | `isAdmin` | 611-618 |
| Row edit / hide / delete / inline edits / verify / change-alert actions | see DealTable | `canEdit` (admin) via DealTable; `onToggleHidden` only passed when `isAdmin` (599); `onSplit` only when `isAdmin` (601) | |

### Exports / copy
CSV `deals-YYYY-MM-DD.csv` columns: `Deal, Status, Office, Closing Date, Install Date, Pay Date, Payment, Setter, Closer, Baseline, Job Price, Rep Pool, Rep Commission, Comm % (baseline), Deduction, Verified, Project ID` (Deals.jsx:486-488).

### Modals & dialogs opened from here
- DealModal (new or edit) — Deals.jsx:620-628.
- confirmDialog: split alert `Create the sheet's new figures as a separate deal?` (confirm `Create the new deal`) — 384-395.
- confirmDialog: `Delete "{name}"?` / `Delete deal` — 410-419.
- promptDialog: `Hide "{name}"?`, label `Reason (optional)`, placeholder `e.g. Tanner's job, came in under Keaton's ArcSite login`, confirm `Hide deal` — 447-459.
- Lock-override dialog via `saveDealFields` (lib/dealWrite) when the deal's pay run is locked (171-189, 349-353).
- Toasts (Notices).

### Dropdown / select options
- Scope: see above (hard-coded labels + `teamLabel`).
- Which date: `Closing date`, `Install date`, `Pay date` (DealTable.jsx:15-19).
- Status / Office / Payment: from `useSettings().statusLabels`, `.offices`, `.paymentMethods`.
- Per page: 25/50/100/200.

### Tabs / sub-views
`reviewTab`: `review` | `all` (default `all`) — only when `canStage`.

### Role differences
- `canStage` (VP or admin) sees the Needs review / All deals tabs and the review worklist (Deals.jsx:136, 541).
- `canAudit = isAdmin || isKeaton` gets live audit + Refresh + fix buttons; plain VP gets read-only stored checklist (272-273, 295).
- `pickUsers = isAdmin ? users : users.filter(u => !u.ghost)` (200) — ghost reps hidden from rep filters for non-admins.
- Reps default scope `mine` (220).
- FAB + hide + split only for `isAdmin` (599, 601, 611).
- Deep link `/deals?note=<dealId>` opens the note thread (132-148). Note: Dashboard links `/deals?scope=all&rep=…` are not read by Deals.jsx (only `note` is).

---

## Route: /dashboard

File: src/pages/Dashboard.jsx. Default landing route.

### Who can see it
All signed-in users. Uses `fetchCompanyDeals()` (company-wide on purpose, line 227).

### Fields shown
| Block | Elements | File:line |
|---|---|---|
| Filter row | DateRangeFilter (count label `deals`), scope breadcrumb `Company › … › {node.title}`, `Copy`/`Copied` button | 662-690 |
| Records card (collapsible, default collapsed, `tt_records_open`) | header `🔥 {n} record(s) falling right now`, sub `{n} company · {n} team · {n} rep`; group labels `Company`/`Team`/`Rep`; rows `{who} — {kind}` / `· just set`, value, `was … · holder, label` | 694-738 |
| StatCard | `Revenue` (value `Baseline`, value2 `Job Price`, sub `Baseline = company's cost basis`, trend `baseline vs prev`) | 742-746 |
| StatCard | `Commissions` sub `Setter + closer, after deductions` | 754-755 |
| StatCard | `Avg Comm %` sub `Of baseline, after deductions` | 756-757 |
| StatCard | `Total Deals` | 758-759 |
| StatCard | `Avg Deal Size` (`Baseline` / `Job Price`) | 761-764 |
| Trend chip | `{pct}% vs prev` / `unchanged` | 28-42 |
| Monthly goal card | `{Month YYYY} Revenue Goal — {scope}`, `Custom goal` / `Auto: 3-month avg ×1.1`, big `{pct}%`, `Month Revenue`, `Goal`, `Remaining` (`Goal Hit! 🎉`), progress bar, `Saved` / `Save failed` | 769-837 |
| Weekly goal sub-card | `This Week ({Mon d – Mon d})`, `Custom weekly goal` / `Auto: monthly goal ÷ weeks`, `Week Revenue`, `Goal`, `Remaining` | only `isCompany(scope)` (844) | 845-914 |
| Appointments card | `Appointments` / `{rep}'s appointments`; `Appointment counts, never deals`; tiles `Set` (`{n}% have run`), `Ran` (`{n}% closed`), `Sold` (`{n}% of set`); or `node.funnelNote` text; link `{n} appointment(s) past their date with no outcome logged — they count as neither ran nor cancelled. Fix in Leads →` (href `/leads?missing=info`) | 922-955 |
| Rep-scope extra tiles | `Self-gen ran`, `Leads ran`, `Self-gen deals` (`{n}% close`), `Lead closes` (`{n}% close`) | 956-971 |
| Drill table card | see below | 979-1270 |
| Weekly Performance card | `Weekly Performance`, `Sun–Sat · last {n} full weeks + this week · avg {$} & {n} deals / week`; rows `This wk`/`Week` + `{MMM d}`, bar, `{$}`, `{n} deal(s)`; `No data` | 1278-1309 |
| Annual Trend card | `Annual Trend`, `Trailing 12 months`, recharts AreaChart; tooltip `Revenue: $…`, `Deals: n` | 1312-1347 |

### Table columns
- Breakdown table (company/office/team level): `{node.childKind}`, [`Set`, `Ran` when showActivity], `Revenue`, `Deals`, `Avg deal`, `Markup`, `Commission`, `Goal`; footer row `{node.title}` totals (1097-1229). Expanded team rows (company level) show reps; expanded rep rows show `RepDealsInline` (`Deal`, `Sold`, `Revenue`, `Status`, link `Open in Deals →`) (81-112, 1165-1197).
- Rep leaderboard (grouping `rep` at company/office): `#`, `Rep`, `Revenue`, `Total Revenue`, `Set Deals`, `Self-Gen`, `Leads Closed`, `Commission` — sortable via SortTh (1047-1089). Caption `{n} reps with activity · tap a column to rank by it · Set Deals + Self-Gen are the deals they own · Leads Closed is what Total Revenue adds on top`.
- Rep scope: `Deal`, `Sold`, `Revenue`, `Status`; `No deals in this range.`; link `Open in Deals for filtering and edits →` (1240-1264).

### Filters / sort / search
- DateRangeFilter presets (default MTD).
- Scope breadcrumb (clickable steps) + URL `?scope=` param (254-261).
- `Break down by` pills: company → `Teams`, `Offices`, `Reps`; office → `Teams`, `Reps` (990-1001); `in {office}` hint.
- `Back to {label}` button at team/rep level (1008-1015).
- `+ Appointments` / `✓ Appointments` toggle adds Set/Ran columns (1031-1036).
- Leaderboard sort by column (398-402).
- Captions: `Click a team to drop its reps in below; click a rep to see their deals.` / `Click a row to scope the whole page to it.` (1232-1236).

### Action buttons & controls
| Element | Label | Gate | File:line |
|---|---|---|---|
| Copy table (filter row) | `Copy` / `Copied` (title `Copy this table for a text or a slide`) | all | 684-689 |
| Copy leaderboard | `Copy table` / `Copied` (title `Copy as a table — pastes formatted into Canva, Sheets or Docs`) | all, when grouping rep | 1023-1029 |
| Edit monthly goal | goal amount is a button; input, ✓ save, ✕ cancel, `reset` (when custom) | `canEditThisGoal = canEditGoal && (company \|\| office level)`; `canEditGoal = isAdmin` (167, 364) | 793-824 |
| Edit weekly goal | same pattern | `canEditGoal` (889) | 869-900 |
| Records toggle | header button | all | 699-711 |

### Exports / copy
- `copyTable`: columns `Name`, [`Set`,`Ran`], `Revenue`, `Deals`, `Avg deal`, `Markup`, `Commission`; section header `{title} · {from} to {to}`; `TOTAL` row (431-449).
- `copyLeaderboard`: `#`, `Rep`, `Revenue`, `Total Revenue`, `Set Deals`, `Self-Gen`, `Leads Closed`, `Commission`; ghosts always dropped (420-427).

### Modals & dialogs opened from here
None (inline goal editing only).

### Dropdown / select options
None (pills and breadcrumb only).

### Tabs / sub-views
Scope levels: company, office, team, office-team, rep. Grouping `team`/`office`/`rep` (company) and `team`/`rep` (office).

### Role differences
- Goal editing: `isAdmin` only (167, 813-819, 889-895).
- Ghosts: `leaderboard(perf, scope, { isAdmin })` (397); `teamRepRows` filters `isAdmin || !r.ghost` (410); names render `Hidden` for ghosts to non-admins (1072, 1127, 1177); record book `isAdmin` (479).
- Weekly goal block only at company scope (844).

---

## Route: /commissions

File: src/pages/Commissions.jsx.

### Who can see it
All signed-in users; shows own commissions (`id = viewId || profile.id`, line 257).

### Fields shown
| Element | Label / text | File:line |
|---|---|---|
| Title | `My Commissions` / `{name}'s Commissions`; sub `{viewUser.name}` | 521-524 |
| Payday hero | `Next payday` / `Upcoming payday`, `{i} / {n}` pill, `{EEE, MMM d} · {n} deal(s)`, `No scheduled paydays coming up.`, `{$} pending from past pay dates`, big total | 541-594 |
| Paycheck breakdown (expanded) | `Paycheck · {date}`, `{n} deal(s) · tap a deal for the breakdown`, `Nothing on this paycheck.`, adjustment rows (`Manual adjustment` / deal name / `Deduction`, note, `line.detail`), `Total this paycheck` | 597-634 |
| DealRow (expandable) | name, roles joined ` · `, status pill, take; expanded: `Job price`, `Baseline`, `Rep pool`, `Override base (−… excluded)`, per-part `detail · with {partner}`, `− Deduction ({label})`, `This deal has a {$} deduction — …`, `Paid`/`Expected · {day}`/`· pay date TBD`, `Your take {$}` | 96-163 |
| Debts card | `{$} in deductions still to come out`, `{n} item(s)`, rows deal name / `No job`, note, `{recovered} of {owed} already taken`, remaining; footer `It comes off a future paycheck — the run it lands on is set by leadership, not automatically.` | 640-665 |
| Card | `Owed to you` sub `{n} unpaid deal(s) · {$} overdue` | 669-670 |
| Card | `Paid out` sub `all time · {$} this month` | 671-672 |
| Tab hint | `grouped by pay week · tap a week` / `grouped by pay date · tap a deal` / `by {basis} · {preset}` | 692-698 |
| Owed tab | PipelineWeekGroup `{MMM d – MMM d}` / `Pay date TBD`, `⚠`, `{n} deal(s)`, total; PipelineRow `Closer: …`, `Setter: …`, `Install: …`, `Pay: … ⚠ overdue` / `Pay date TBD`, status, take; empty `No unpaid deals — you're all caught up!` | 166-251, 705-712 |
| Paid tab | group header `Paid {day}` / `No pay date`, `{n} deal(s)`, total; DealRows; empty `Nothing paid out yet.` | 713-731 |
| Earned tab | DateRangeFilter; basis pills; Cards `Rep Commission` (`setter + closer · by {basis}`), `Override` (`mgr · dir · VP · by …`), `Total Earned — by {basis}` or `Commission Earned — by {basis}`, `Deal Count`; strip `Already Paid`, `Not Yet Paid`, `of {$} earned`; `Detail — by {basis}`, `newest first · {preset}`; empty `Nothing earned in this range by {basis}.`; note `{n} deal(s) excluded (no {basis})` | 734-882 |
| Loading / error | `Loading…`, `Couldn't load deals: {msg}` | 701-704 |

### Table columns
Earned detail table: `Customer`, `Sale Date`, `Install Date`, `Pay Date` (active one suffixed ` ▾`), `Setter`, `Closer`, then `Rep $`, `Override $`, `Total $` (when showOverride) or `Commission $`, `Status`; tfoot `{n} deal(s) · by {basis}` + totals (798-872).

### Filters / sort / search
- Earned basis pills: `Sale Date`, `Install Date`, `Pay Date` (EARNED_BASES 40-44).
- Earned DateRangeFilter (default MTD).
- Payday prev/next arrows (`Earlier payday`, `Later payday`).

### Action buttons & controls
| Element | Label | Gate | File:line |
|---|---|---|---|
| View-as select | `My commissions` + users (rep/manager/director/vp) sorted by name, `(ghost)` suffix | `isAdmin` | 526-535 |
| Payday hero click | toggles breakdown | all | 541 |
| Tabs | `To be paid ({n})`, `Paid ({n})`, `Earned` | all | 679-690 |

### Exports / copy
None.

### Modals & dialogs
None.

### Dropdown / select options
View-as: `My commissions` + names (admin only).

### Tabs / sub-views
`owed` | `paid` | `earned` (default `owed`).

### Role differences
- Admin-only view-as select (526).
- Override column/cards only appear when the viewed person has override $ (`showOverride`, 488-490).
- Permission tripwire logs if a rep would see foreign override money (498-513).

---

## Route: /leads

File: src/pages/Leads.jsx. Renders RepActivityTable.

### Who can see it
All signed-in users. Reps see only appointments they set or run (`scoped`, 145-149).

### Fields shown
| Element | Text | File:line |
|---|---|---|
| Title | `Leads` + copy `Appointments fed in from the field CRM, in calendar order. An appointment that RAN counts as an estimate — marking one Sold records the outcome only; deal counts and revenue always come from the Deals page.` | 377-384 |
| Feed health strip | `CRM feed · {feed.text}`, `{n} in the last 7 days` | 528-539 |
| Count | `{n} appointments` | 557 |
| KPIs (list view) | `Appointments Set`, `Ran (Estimates)` (`{n}% show rate`), `Sold at Appt` (`outcome, not a deal record`), `Appt Close %` (`sold ÷ ran`), `No Shows` | 598-606 |
| Empty list | `No appointments in this range.` | 613-617 |
| Day group header | `{EEEE · MMM d}`, pill `Today`/`Tomorrow`/`Yesterday`, `{n} appt(s) · {n} ran · {n} sold`; `No date set` | 619-637, 62-73 |
| Row | time `h:mmaaa`, customer name button (Link2 icon when `deal_id`), `{address \|\| 'No address'} · {office}`, `Edited here — the CRM feed won't change its status or people`, `Missing info — {gaps}`, `Possible duplicate — same customer and time as another appointment`, `Ignored — counts nowhere` | 643-676 |
| Non-admin people cell | `SET {name}` / `RUN {name}` | 713-720 |
| Non-admin status pill | status label | 735-738 |

### Table columns
RepActivityTable (by-rep view) — see component.

### Filters / sort / search
| Control | Options | File:line |
|---|---|---|
| Range pills | `Today`, `This Week`, `Next Week`, `Last Week`, `This Month`, `All` (APPT_RANGES 48-51); default `week` | 542-549 |
| Custom date inputs | from `to` to | 550-556 |
| Search | placeholder `Customer, address, rep…` | 558-562 |
| Status select | `All statuses`, `Scheduled`, `Ran`, `Sold`, `No Show`, `Canceled` (STATUSES 21-27) | 563-566 |
| Rep select | `All reps` + pickUsers | `role !== 'rep' \|\| isAdmin` (567) | 567-572 |
| Team select | `All teams` + team heads (`teamLabel`) | `(role !== 'rep' \|\| isAdmin) && teamOptions.length > 0` (573) | 573-580 |
| Attention select | `All appointments`, `Needs attention` (`?missing=` URL param pre-sets) | 581-585 |
| View toggle | `List`, `By rep` (default `byrep`, persisted `tt_leads_view`) | 587-594 |

### Action buttons & controls
| Element | Label | Gate | File:line |
|---|---|---|---|
| Import CSV | `Import CSV` (title `Backfill appointments from a CRM export`) | `isAdmin` | 386-393 |
| Customer name → history modal | button | all | 648-652 |
| Setter/closer selects | `SET`/`RUN` tags, options `— none —` + pickUsers; `feed: {name}` hint | `isAdmin` | 677-712 |
| Status select | STATUSES | `isAdmin` | 723-727 |
| Ignore/Restore | `Ignore` / `Restore` | `isAdmin` | 728-733 |
| Hand back to feed | `Hand back to feed` (in history modal) | `isAdmin` | 417-422 |

### Exports / copy
None (import only).

### Modals & dialogs opened from here
- History modal (inline, 397-463): title customer name, datetime, pinned notice `Corrected here, so the CRM feed can no longer change its status, setter or closer. It still refreshes timing and customer details.`, rows `Added by {who}` / `Refreshed by {who}` / `{who} updated {field} to {value}`, `No changes recorded yet. History starts once migration 043 is in place.`, `Loading history…`.
- Import modal (466-524): title `Import appointments`, copy, file input (`.csv`), textarea placeholder `…or paste the CSV contents here`, preview `⚠ Missing expected column(s): …`, `{n} appointment(s) ready`, per-status counts, `{n} rep(s) not matched to the roster — those appointments still import, with the name as text:`, buttons `Import {n}` / `Import` / `Importing…`, `Cancel`.
- confirmDialog `Ignore this appointment?` (confirm `Ignore it`) — 309-318.

### Dropdown / select options
Listed above; status options are hard-coded in Leads.jsx:21-27.

### Tabs / sub-views
`view`: `list` | `byrep`.

### Role differences
- Reps (non-admin) see only their own appointments (148) and only themselves in by-rep view (357-358); no rep/team selects (567, 573).
- Admin-only: Import CSV, inline setter/closer/status edits, Ignore/Restore, Hand back to feed.
- `pickUsers` hides ghosts for non-admins (330-332); by-rep roster `visible = isAdmin ? users : users.filter(u => !u.ghost)` (362).

---

## Route: /myteam

File: src/pages/MyTeam.jsx. Self-guards.

### Who can see it
`if (!isAdmin && teams.length === 0) return <Navigate to="/dashboard" replace />` (MyTeam.jsx:127). Team leads (via `fetchMyTeams`) or admins.

### Fields shown
| Element | Text | File:line |
|---|---|---|
| Header | `{team_name \|\| 'My Team'}`, `Team revenue bonus tracker` | 157-158 |
| Admin empty state | `No sales teams have been set up yet.` (admin with 0 teams) | 128-135 |
| Error box | error message | 200-204 |
| Bonus card | `{Month YYYY} team revenue`, big `$`, `Bonus earned`, BonusBar (tier ticks `200k` etc.), `Top tier reached — max bonus of {$} locked in for {month}.` / `{$} more in revenue to reach the {$} bonus (at {$}).` / `No bonus tiers configured.` | 213-245 |
| Member breakdown | `Member breakdown`; `No active team members this month.`; footer `Each deal counts once at full revenue, credited to its setter (or the closer when no team member set it).` | 248-287 |

### Table columns
`Member`, `Role` (`Lead`/`Closer`/`Setter`), `Deals`, `Revenue`; tfoot `Team total` (256-281).

### Filters / sort / search
- Team select (only when `teams.length > 1`, 164-173).
- Month picker: `Previous month` / `Next month` arrows + select of last 12 months `{Month YYYY}` (175-196).

### Action buttons & controls
Only the selectors above.

### Exports / copy / Modals
None.

### Dropdown / select options
Team names from `fetchMyTeams`; months generated (`recentMonths`).

### Role differences
Admins see all teams and the `No sales teams have been set up yet.` state; non-admin non-leads are redirected (127).

---

## Route: /competitions

File: src/pages/Competitions.jsx. Renders CompetitionModal.

### Who can see it
All signed-in users. `canManage = isAdmin` (784).

### Fields shown
| Element | Text | File:line |
|---|---|---|
| Header | `Competitions`, `See how you stack up in the contests we're running.` | 967-968 |
| Empty states | `No competitions yet. Click "New" to start one.` / `Check back soon!`; `No active competitions right now.` | 990-999 |
| CompetitionCard | name, status pill `Active`/`Upcoming`/`Ended`, `{typeLabel} · {metricLabel} · {range}`, `{creditLabel} · Goal {n} · {n} rep(s) excluded`, description | 213-233 |
| Rounds strip | `Overall` pill + round pills `{name} ·` / `🏆 {first name}`; selected round box: name, range, status, `🎁 {prize}`, `🏆 {winner} (set by admin)` | 246-293 |
| StandRow | rank (🥇🥈🥉 or n), name `· you`, `manual`, `🎉 Earned`, score, `· {total} ÷ {n} rep(s)` or `· {$}`, progress bar `of {target}`; drill-down: `{n} deal(s) counted`, `Counts toward score`, deal lines with `canceled`/`hidden`/`excluded` badges, `{credit}%`, `Set: … · Closed: … · Sold {d} · Install {d} · excluded: {note}`, footer `Average`/`Total` | 38-162 |
| Standings empty | `No participants yet.` | 300 |
| Show toggle | `Show top 5 only` / `Show all {n}` / `Hide details` / `Details` | 313-321 |
| Rules box | `Rules` + text | 323-328 |
| Past section | `Past competitions ({n})` toggle; PastCompRow `{name}`, `{type} · {range}`, `🏆 {winner} · {score}` | 1014-1034, 749-778 |
| Record Book | `📖 Record Book`, `All-time bests · completed periods only · since {Month YYYY}`; `Company records` tiles `Biggest Month — Revenue`, `Biggest Week — Revenue`, `Biggest Day — Revenue`, `Most Deals — Month`, `Most Deals — Week`, `Most Deals — Day`; `Rep records` tiles `Biggest Rep Month`, `Biggest Rep Week`, `Biggest Single Deal`, `Most Deals — Rep Month`, `Most Deals — Rep Week`, `Biggest Rep Day`; `Team records` tiles `Biggest Team Month`, `Biggest Team Week`, `Biggest Team Day`, `Most Deals — Team Month`, `Most Deals — Team Week`, `Most Deals — Team Day`; chips `🔥 NEW RECORD — …` / `🔥 RECORD WATCH — …`; `Personal bests in play` with period pills `Week`/`Month`/`Quarter` (PB_PERIODS), `‹`/`›` stepper, `{label}`, `each rep against their own history · {n} set, {n} closing in`, `Nobody reached 85% of their own best in {label}.` | 631-743 |

### Table columns
None (card lists).

### Filters / sort / search
Round pills per card; PB period pills + stepper.

### Action buttons & controls
| Element | Label | Gate | File:line |
|---|---|---|---|
| Export all | `Export all` / `Exporting…` (title `Download a PNG of every competition's standings (one per slide)`) | `canManage` | 972-978 |
| New | `New` (Plus) | `canManage` | 980-983 |
| Card icons | Copy (`Copy standings image to clipboard (paste into Canva)`), Download (`Download standings as an image (PNG)`), Pencil `Edit`, Trash `Delete` | `canManage` | 235-242 |
| Round winner select | `Winner: auto`, `Winner: {name}` … | `canManage && round ended` | 282-291 |
| Entry drill-down | click row | `canManage && !e.manual` | 47, 59-61 |
| Exclude from contests | Ban icon (title `Exclude this deal from every competition (it still pays commission)` / `Put this deal back into every competition`) | `canManage && onToggleComp` | 125-136 |
| Record Book | `Copy image` / `Copy table` (`Copied`) | all | 639-652 |

### Exports / copy
- PNG per competition (`{slug}_standings.png`) via CompetitionExportCard (off-screen, ghosts hidden) — 338-407, 810-835.
- Record Book copy table: columns `Record`, `Value`, `Who`, `When`, [`Right now`]; sections `Company records`, `Rep records`, `Team records`, `Personal bests in play · {label}` — 532-602.
- Record Book copy image (`record-book.png` fallback) — 608-628.

### Modals & dialogs opened from here
- CompetitionModal (1050-1053).
- promptDialog `Exclude "{deal}" from competitions?` label `Reason (optional)` placeholder `e.g. finance docs not signed` confirm `Exclude from contests` (899-910).
- confirmDialog `Delete the competition "{name}"?` confirm `Delete competition` (952-957).

### Dropdown / select options
Round winner override (admin). Others in CompetitionModal.

### Tabs / sub-views
Live cards vs `Past competitions` collapsed list.

### Role differences
- `canManage = isAdmin` for all mutations/exports on cards (784).
- Ghosts: `hiddenIds: isAdmin ? null : ghostIds` (175, 264 in Home, 754); export always hides ghosts (340, 490-495).
- `· you` highlight uses `profileId` (65).

---

## Route: /home

File: src/pages/Home.jsx.

### Who can see it
All signed-in users (own card; admin may view another's).

### Fields shown
| Element | Text | File:line |
|---|---|---|
| Header | initials avatar, `{name}` + `· viewing` (viewingOther), `{role} · {Month YYYY}` | 407-417 |
| Rank hero | `Company Rank`, `#{rank} / {total}`, `{$} to pass {name}` / `🏆 You're #1 — leading {name} by {$}`; `Not ranked yet`, `Log a sale this month to hit the board, {first}.`; badge `🔥 Personal best` | 444-475 |
| Momentum | `{n} weeks` `win streak`; `{Today/Yesterday/n days ago/No sales yet}` `last sale` | 478-493 |
| `Self-gen` tiles | `Revenue` (`baseline you set · tap`), `Closes` (`deals you set · tap`), `Estimates` (`self-gen · tap`), `Closing %` (`▲/▼ n pts vs last mo`) | 496-507 |
| `Leads` tiles (when `stats.hasLeads`) | `Lead Rev`, `Leads Closed`, `Lead Est`, `Closing %` | 510-518 |
| Earnings tiles | `Commission` (`your total earnings · tap`), `Avg Deal` (`per self-gen deal · tap`) | 521-524 |
| `Field activity · RepCard` (hidden when `repCard.configured === false`) | pills `This week`, `This month`, `Last month`, `90 days`, `Custom`; custom date inputs; tiles `Doors`, `Appts set`, `Closes` (`your sales`); `Averages · {label}`: `Avg doors / day`, `Doors / appt`, `Appts / close` | 529-562 |
| `Personal bests` | tiles `Best Month`, `Best Week`, `Most Deals / Mo`, `Biggest Deal`; banner `{$} this month — a new personal best, and the month isn't over.` / `… — {$} away from your best month ever.` | 565-599 |
| Drill-down panel | title (`Self-gen — deals you set`, `Leads — deals you closed for another setter`, `Self-gen estimates`, `Lead estimates`, `Commission — your earnings`), `{month} · {total}`, rows, `Nothing here for {month}.`, X close | 602-625 |
| `Monthly pace` | `{$} of {$} target`, bar, `Target = your trailing 3-month average +10%. · Best month: …` | 628-646 |
| `Your competitions` | link `View all`; `You're not in any active competitions right now.`; rows `{name}`, `🎉 Earned` / `#{rank} of {n}`, `You:`/`Your team:` score, `· target …` / `· {gap} to pass {name}` / `· 🏆 leading`, bar | 649-690 |

### Filters / sort / search
- Month select (last 12 months) — 436-439.
- Field-activity preset pills + custom from/to.

### Action buttons & controls
| Element | Label | Gate | File:line |
|---|---|---|---|
| View-as select | `My card` + sellers (`(ghost)` suffix) | `isAdmin` | 419-428 |
| Share | `Share` / `Copied` / `Saved` (title `Copy a shareable card image`) | all | 429-435 |
| StatTiles | tap to drill | all | |

### Exports / copy
Share card PNG 1080×1080 drawn on canvas (clipboard or download `{name}-{YYYY-MM}.png`) — 325-396.

### Modals & dialogs
None (inline drill panel).

### Dropdown / select options
Month list; view-as (admin).

### Role differences
- Admin view-as (419).
- Rank board excludes ghosts for non-admins (`isAdmin || !u.ghost`, 214); competitions `hiddenIds = isAdmin ? null : ghostIds` (264).

---

## Route: /payroll

File: src/pages/Payroll.jsx. Guard roles `['vp','admin']` (App.jsx:87). Renders DealModal, DeductionModal, RepMultiSelect.

### Who can see it
VP or admin (admin-flag qualifies). Within the page, mutations are `isAdmin`-gated; a VP gets a read-only run (660-664).

### Fields shown
| Element | Text | File:line |
|---|---|---|
| Header | `Payroll`, `Review deals due for pay, approve them, and track deductions.` | 1073-1076 |
| Empty | `No deals have a pay date yet. Set install dates (which auto-fill pay dates) or run the pay-date backfill.` | 1139-1141 |
| Lock banner | `This pay run is locked`, `Auto-locked (pay date passed with every deal Paid)` / `Locked` `{date} by {name} · locked total {$} — deals and adjustments on this run are frozen.`; `{n} admin override(s) on this run ▾/▴` list (`deal · who · when · changed {keys}`, `"reason"`) | 1145-1188 |
| Run status card | `Total payout` / `Rep payout`, `{$}`, `incl. ±{$} adjustments · {n} payee(s)`; `Run progress` label `Locked` / `Nothing on this run` / `Paid — ready to lock` / `Approved — ready to pay` / `Paying` / `In review`; three segment bars; `{v}/{t} verified`, `{f}/{t} approved`, `{p}/{f} paid`, `{$} remaining` / `locked` / `nothing outstanding`; `+ {$} across {n} deal(s) not yet finalized — excluded from the total until they reach "Pay Finalized".` | 1195-1255 |
| Before you pay card | `Before you pay — {n} thing(s) to look at`, `none of these block payment`; rows `{n} deal(s)` + `aren't gold-checked yet` / `have no office — override rates may be wrong` / `have commission with nobody assigned to pay it to`, hints, deal chips; deductions row `{$} in deductions owed — {n} of {m} is a rep/are reps getting paid on this run`; debt rows (name, `on this run · {$}` / `no pay on this run`, `−{$}` `of {$}`, job + note, `logged {date} · {$} already recovered`) | 1265-1400 |
| All clear | `Everything checks out — all deals verified, offices set, every share assigned, nothing owed.` | 1401-1409 |
| Who gets paid card | header `Who gets paid · {n} person/people` + total; column headings `Person`, `Deals`, `Deal pay`, `Adjustments`, `Net pay`; payee rows; expanded `{n} deal(s)` lines `{deal} · {role}` `$`, `− {note} · {$}`; `Adjustments` lines; `Nothing on this run.`; `Run total` row; warning `{$} of this run's total reaches nobody — …` | 1416-1704 |
| Add pay form | labels `Who`, `Amount`, `What for`; copy `Paid on {date} and listed with everyone else. …` | 1475-1522 |
| Deals in this run | `Deals in this run`, `{n} deal(s)`, headings `Deal`, `Install`, `Office`, `Setter`, `Closer`, `Overrides`, `Baseline`, `Commission`, `Status`; rows (install `TBD`, office `—`, `Unassigned`, `self-gen`, overrides `{n} · {$}`, commission `−{$}` deduction, BadgeCheck verified, status); expanded: `{office · payment}` / `No office / payment set`, `Sold`, `Baseline`, `Job price`, `Rep pool`, `Install`, `Pay date`, payouts (`{name} · {role} · {pct}`, `Unassigned · {role} — set the {role} on the deal`), `No payouts on this deal.`, `{$} deduction — {label}`; empty `No deals in this run.` / `No deals for the selected rep(s) in this run.` | 1709-1906 |
| Deductions tab | `Logged after payout`, `{$} owed across {n} person/people`; ledger rows (name, `logged {date}`, remaining `of {owed}`, job · note, recoveries `{$} came out {day}`, `{$} rolls to their next run`, `written off — {note}`, status pill `Outstanding`/`Partly recovered`/`Recovered`/`Written off`); empty `Nothing owed — every logged deduction has been recovered or written off.` / `No deductions logged yet.`; Cards `Total deductions` (`{n} total`), `Pending` (`{n} not yet paid`), `Applied` (`on paid deals`); `All deductions · present & past` list (name, `From {who} · {office} · pays {day}` / `· pay date TBD`, `Dealer fee −{$} · other −{$}`, note, `−{$}`, `Applied`/`Pending`, `Edit`); `No deductions on any deal.` | 1911-2056 |

### Table columns
See above (flex-row "tables": payees `Person/Deals/Deal pay/Adjustments/Net pay`; deals `Deal/Install/Office/Setter/Closer/Overrides/Baseline/Commission/Status/[actions]`).

### Filters / sort / search
- Pay-date navigator: `‹` / `›` buttons, select of pay dates (`EEE, MMM d, yyyy`), `Overdue (unpaid)` option, `No pay dates yet` (1111-1126).
- `{n} overdue` button → overdue view (1127-1133).
- RepMultiSelect over payees (when > 1) (1428-1430).
- `Expand all` / `Collapse all` (1713-1719).
- Deductions tab filter pills `Outstanding` / `All` (1925-1930).
- Checklist `Show` / `Hide` per row (1286-1290, 1321-1325).

### Action buttons & controls
| Element | Label | Gate | File:line |
|---|---|---|---|
| Log a deduction (header) | `Log a deduction` | `isAdmin` (tab run) | 1083-1089 |
| Export CSV | `Export CSV` | all; disabled when no deals | 1090-1094 |
| Tabs | `Pay run`, `Deductions ({n})` | all | 1100-1106 |
| Unlock | `Unlock` | `isAdmin` + runLock | 1180-1186 |
| Overrides toggle | `{n} admin override(s) on this run` | all | 1160-1163 |
| Take from this run / Edit / Write off / Delete (debt row) | `Take from this run`, Pencil, Ban, Trash | `isAdmin && !runLock && !open`; Delete only if no recoveries | 1355-1371 |
| Take editor | `Take` input, `Take it`, `Cancel`, hints `leaves {$} owed — carries to the next run`, `more than the {$} they earn this run — their cheque would go negative` | | 1375-1394 |
| Approve all | `Approve all` | `canApprove = isAdmin && !runLock && statusLabels.includes('Pay Finalized')` (661) | 1433-1439 |
| Mark all paid | `Mark all paid` | `canPay = isAdmin && statusLabels.includes('Paid')` (664) | 1440-1446 |
| Add pay | `Add pay` toggle; form `Pick a person…` select (`— already on this run` suffix), amount `$`, note placeholder `e.g. Door-knock contest — 2nd place`, `Add to this run` / `Adding…`, X | `isAdmin && !runLock` | 1447-1456, 1475-1522 |
| Lock run | `Lock run` | `isAdmin && !runLock` | 1457-1463 |
| Payee `+` adjustment | Plus (title `Add a payroll adjustment (+/−)`); inline inputs `± $`, `note (e.g. missed deduction)`, ✓, ✕ | `isAdmin && view !== 'overdue' && !runLock` | 1568-1572, 1648-1661 |
| Copy pay statement | Copy/Check (title `Copy this rep's pay statement to email`) | `isAdmin` | 1573-1578 |
| Remove adjustment | Trash (title `Undo this recovery — …` / `Remove adjustment`) | `isAdmin && !runLock` | 1627-1631 |
| Deal name → edit | button (title `… — click the name to edit this deal`) | `openEdit` no-ops unless `isAdmin` (665-675) | 1767-1771 |
| Approve | `Approve` (title `Move to Pay Finalized`) | `canApprove && !dealLocked && !isPaid && status !== 'Pay Finalized'` | 1811-1817 |
| Paid | `Paid` button / check icon (title `Paid`) | `canPay` (locked only if status is Pay Finalized) | 1818-1825 |
| Edit deal (expanded) | `Edit deal` | `openEdit` (admin) | 1891-1894 |
| Deductions tab: `+ Log a deduction` | | `isAdmin` | 1932-1935 |
| Ledger row actions | Reopen (CheckCircle2, `Reopen — it starts showing on runs again`) / Pencil `Edit` / Ban `Write it off` / Trash `Delete` | `isAdmin && status !== 'settled'` | 1984-1998 |
| All-deductions `Edit` | `Edit` | `openEdit` (admin) | 2048-2051 |

### Exports / copy
- CSV `payroll-{date}[-who].csv`: `Deal, Baseline, Paid to, Role, %, Commission $, Note`; sections `Manual adjustments`, `Net totals per rep`, `TOTAL` (911-951).
- Pay statement (text/html + text/plain) per payee: header `TURF TIME` / `Pay Statement` / `Paid to` / `Pay date`; table `Deal, Baseline, Role, %, Commission`; `Adjustments`; `Net total`; footer `Deductions are already reflected in each line. Questions? Reply to this email.` (955-1066).

### Modals & dialogs opened from here
- DealModal (2066-2069).
- DeductionModal (2059-2064).
- confirmDialog: `Take {$} against a balance of only {$}?` (`Take it anyway`) 598-603; `Delete this deduction?` (`Delete it`) 639-644; `Lock the {run} run?` (`Lock the run`) 791-799; `Unlock the {run} run?` (`Unlock the run`) 811-817; `Mark {n} deal(s) as "{status}"?` (`Mark as {status}`) 870-878.
- promptDialog: `Write off {$} still owed by {name}?` label `Reason (optional)` placeholder `e.g. left the company, never another run to take it from` confirm `Write it off` (616-623).
- Lock-override dialog via `saveDealFields` (893-897).
- Toasts incl. `The {date} pay run is locked — unlock it first to change this deal.` (837).

### Dropdown / select options
- Pay date select: from data; `Overdue (unpaid)`, `No pay dates yet`.
- Add pay `Who`: `Pick a person…` + active users (ghosts hidden for non-admins, 283-286).
- Deductions filter: `Outstanding`, `All`.

### Tabs / sub-views
`tab`: `run` | `deductions`. `view`: a pay_date | `'overdue'`.

### Role differences
- Route: vp/admin. In-page: every write is `isAdmin`; VP sees everything read-only (660-664).
- `canApprove`/`canPay` also depend on `statusLabels` including `Pay Finalized` / `Paid` (661, 664).
- Locked run disables Approve, adjustments, Add pay, Lock; `Paid` still allowed for Pay Finalized deals (1818-1825).
- `payUsers` hides ghosts for non-admins (284).

---

## Route: /import

File: src/pages/ImportDeals.jsx. Guard roles `['vp','admin']` (App.jsx:88).

### Who can see it
VP or admin. No in-page gates (all controls visible to whoever reaches it).

### Fields shown
| Element | Text | File:line |
|---|---|---|
| Header | `Import Deals`, `Bring deals in from any spreadsheet or CRM — export a CSV, drop it here, map the columns, import.` | 161-162 |
| Step 1 | `1 · Paste or upload`, `Upload CSV` file label, textarea placeholder `Paste rows from a spreadsheet (with a header row) or CSV…` | 168-176 |
| Step 2 | `2 · Map columns`; field labels `Deal name *`, `External ID (dedupe)`, `Baseline revenue`, `Job price`, `Sale date`, `Setter (rep)`, `Closer`, `Office`, `Payment method` (FIELDS 8-18) | 183-195 |
| Step 3 | `3 · Preview`, `{n} new`, `{n} duplicate`, `{n} missing name`, `{n} rows`; `Unmatched rep names (will import with no rep): …` | 201-212 |
| Step 4 | `Import {n} deal(s)` / `Importing…`; `Map a "Deal name" column to continue.`; `No ID column mapped — deduping by deal name.` | 242-248 |
| Result | `Import complete`, `Created {n} · Skipped {n} · Errors {n}`, error lines | 250-260 |

### Table columns
Preview (first 8 rows): status dot, `Deal`, `Baseline`, `Job`, `Sale date`, `Setter`, `Closer`, `Ext ID` (216).

### Filters / sort / search
None.

### Dropdown / select options
Per-field mapping select: `—` + CSV header names (188-192).

### Role differences
None beyond the route Guard.

---

## Route: /audit

File: src/pages/RequiresAudit.jsx. No route Guard; self-guards.

### Who can see it
`allowed = isAdmin || isKeaton(profile)`; otherwise `<Navigate to="/dashboard" replace />` (RequiresAudit.jsx:31, 55).

### Fields shown
| Element | Text | File:line |
|---|---|---|
| Header | `Requires Audit`, `Deals where the stored sheet amounts disagree with the commission rules (by more than $1).` | 70-73 |
| Needs review section | `Needs review` + count badge; empty `Everything reconciles. No deals need review.`; per deal: name, `Tucson` badge (isTucson), `{project_id} · Sale {date} · Baseline {$}` | 78-125 |
| Correction history | `Correction history` + count; `No corrections logged yet.` | 128-169 |

### Table columns
- MismatchTable: `Field`, `Sheet value`, `Calculated`, `Difference`; badge `billed at 5%, should be 3.75%` for `tucson-rate` (183-217).
- History: `Deal`, `Field`, `Sheet → Corrected`, `Note`, `Corrected by`, `When` (144).

### Action buttons & controls
| Element | Label | Gate | File:line |
|---|---|---|---|
| Override & Correct | `Override & Correct` | all allowed users | 114-117 |

### Modals & dialogs opened from here
CorrectionModal (219-319): title `Override & Correct`, deal name, per-field `{label}` `sheet {$}` `$` input `calc {$}`, `Correction note (required)` textarea placeholder `Why is this being corrected? (e.g. sheet applied 5% to a Tucson deal)`, errors `Add a note explaining the correction.` / `Enter a valid number for {label}.`, buttons `Save correction` / `Saving…`, `Cancel`.

### Role differences
Keaton (a VP) and admins only; everyone else redirected.

---

## Route: /goals

File: src/pages/Goals.jsx. Guard roles `['rep','manager','director','vp','admin']` (App.jsx:95-97) — effectively any signed-in profile role.

### Who can see it
All roles.

### Fields shown
| Element | Text | File:line |
|---|---|---|
| Header | `Goals`, `Weekly + monthly commitments per rep — click any goal number to type it. Estimate goals are self-gen; leads count toward overall production. Goals carry forward until changed. Reps edit their own; managers edit their team's.` | 253-259 |
| Team header rows | color dot, `{team name}` (`No Team` / `Former Team`), `{$} / {$goal} · {n}/{goal} deals this month` | 292-303 |
| Rep row | name, streak `🔥{n}` (title `{n} straight weeks hitting the estimate goal`), `no goals set` / `Leads: {n} ran · {n} closed` | 206-221 |
| MetricCell | `{value} / {goal}` (`set` dotted when editable & empty, `—` otherwise), pace bar; titles `Click to set a goal`, `No goal set`, `Goal hit`, `On pace`, `Behind pace by …` | 22-62 |
| Suggestion row | `{$}/mo ≈ {n} deals · {n} est ({pct}% close · {$} avg) → {n} est / wk` + button `Use as targets` | 225-241 |

### Table columns
Header row 1: `Rep`, `This Week {sub}` (colspan 3), `This Month {sub}` (colspan 3); row 2: `SG Est`, `Deals`, `Revenue`, `SG Est`, `Deals`, `Revenue` (265-286).

### Action buttons & controls
| Element | Gate | File:line |
|---|---|---|
| Click goal number to edit (inline number input; Enter/blur save, Escape cancel) | `canEditRep(rep) = isAdmin \|\| rep.id === profile.id \|\| rep.manager_id === profile.id` | 109, 174 |
| `Use as targets` | editable && suggestion exists | 185-186, 234-237 |

### Role differences
- Roster hides ghosts for non-admins (`isAdmin || !u.ghost`, 94).
- Editing per `canEditRep` (109).

---

## Route: /admin

File: src/pages/Admin.jsx. Guard roles `['admin']` (App.jsx:102-104; admin-flag qualifies). Renders PeopleChart, UserModal, ManagerBackfillModal, TeamMoveModal, SettingsPanel.

### Who can see it
Admins (title or flag). No further in-page gating.

### Fields shown
| Element | Text | File:line |
|---|---|---|
| SystemHealth card | `System health`; rows `Scheduler sync`, `Lead feed`, `Watchdog` with status text (e.g. `no heartbeat yet — paste the latest ScheduleSync.gs`, `PREVIEW MODE — running but writing nothing (SCH_DRY_RUN=true) · …`, `stalled — last ran …`, `SHEET FORMAT PROBLEM · ran …`, `ran … with n error(s)`, `ran …`; `not running yet — set up Watchdog.gs`, `{n} issue(s) found · …`, `all clear · …`); issue lines | 49-126 |
| Tab bar | `People`, `Settings`; refresh icon button | 23, 625-630 |
| Scheduled moves card | `Scheduled moves`, `nothing changes until the date — the roster is live as-is`, `{n} upcoming`; overdue banner `One of these was / {n} of these were due on or before today ({date}) and has/have not been applied.` + `The site could not run them: {err}` / `Usually the database's own clock has not reached the date yet — Apply now will say which.`; rows date, `due — not applied`, `{who} — {from} → {to} · {note}` | 652-709 |
| Team change log | `Team change log`, `sales & overrides attribute to teams by these dates`, `{n} change(s) · show/hide`; LogRow: effective date, `recorded {date}`, `{who} — {from} → {to} · by {name} · {note} · re-dated from {date}` | 717-739, 132-191 |

### Action buttons & controls
| Element | Label | File:line |
|---|---|---|
| Refresh | RefreshCw icon | 627-629 |
| Apply now | `Apply now` | 677-680 |
| Cancel scheduled move | `Cancel` | 700-703 |
| Log row: re-date | Pencil (title `Change the date this move counts from`) → inline date input | 181-182, 152-158 |
| Log row: undo/remove | Undo2 (`Undo this move, or remove the entry`) / Trash (`Remove this entry from the log`) | 183-187 |
| PeopleChart toolbar/actions | see component | 635-647 |

### Modals & dialogs opened from here
- UserModal (755), ManagerBackfillModal (756-757), TeamMoveModal (746-754).
- confirmDialog: `{name} has {n} direct report(s)` (`Move the reports too` / `Leave them`) 298-307; `Delete this user?` (`Delete`) 329-337; `Deactivate {name}?` (`Deactivate`) 417-426; `Move {name} to {team}?` (`Move them`) 463-471; `Cancel this scheduled move?` (`Cancel the move` / `Keep it`) 541-548; `Change this move to {date}?` (`Change the date`) 570-576; `Remove this log entry?` (`Remove it`) 601-611.
- choiceDialog: `Create {name}'s login?` options `Email an invite` / `Set a temporary password` 355-361; `Reset {name}'s password?` options `Email a reset link` / `Set a temporary password` 386-392; `{who}: {from} → {to}` options `Undo the move` / `Remove the entry only` 593-600.
- revealDialog: `Login created for {name}` / `New temporary password for {name}` with Copy 376-380, 405-409.
- Toasts incl. `Profile created. To give them a login, open Edit on their row …` (319-322).

### Tabs / sub-views
`People` | `Settings` (TABS, line 23).

### Role differences
Admin-only route. `hasUserAdmin = userAdminConfigured()` (349) gates login/reset buttons in PeopleChart and password box in UserModal.

---

## Redirects

| Path | Target | File:line |
|---|---|---|
| `/` (index) | `/dashboard` | App.jsx:77 |
| `/team` | `/goals` | App.jsx:94 |
| `/performance` | `/dashboard` | App.jsx:101 |
| `*` | `/dashboard` | App.jsx:106 |
| `/login` when signed in | `/dashboard` | App.jsx:72 |

NavBar page titles (NavBar.jsx:10-20): `/deals` → `Deals Pipeline`, `/dashboard` → `Dashboard`, `/commissions` → `Commissions`, `/leads` → `Leads`, `/myteam` → `Bonus`, `/goals` → `Goals`, `/performance` → `Performance`, `/admin` → `Admin Panel`, `/audit` → `Requires Audit`; any other path (incl. `/home`, `/competitions`, `/payroll`, `/import`) → `Turf Time`.

---

# Components

## Component: AuditStrip

File: src/components/AuditStrip.jsx. Exports `AuditBadge`, `AuditControls`, default `AuditStrip`. Used by: DealTable (badge + strip), Deals page (AuditControls).

### Fields shown
| Element | Text | File:line |
|---|---|---|
| AuditBadge | `{done}/{total}` + ` · Reviewed` | 3-12 |
| AuditControls | `Refresh` button (title `Re-check every deal against the install sheet + GHL now (otherwise cached for an hour)`), `updated {ago}`, `Running audit…`, `The audit runs on the live site (disabled in demo mode).`, `Audit failed: {err} retry` | 24-50 |
| AuditStrip header | `{deal_name}` + AuditBadge | 190-193 |
| AuditRow | icon (Check / Circle / Lock / X) + `{label}` + `(manual)`; detail lines (`Matched a non-cancelled install booking on the calendar.`, `Site install date: …`, `Payment method: …`, `Setter: …`, `Closer: …`, `Name: …`, `Phone: …`, `Address: …`, `Manager: …`, GHL parts coloured) | 59-168 |
| FixButton | `Use calendar date` / `Use calendar setter/closer` / `Assign team` / `Fill blanks in GHL` | 110-124 |

Checklist items (utils/dealAudit7.js:17-26): `On calendar`, `Install date`, `Financing` (manual), `Setter / closer`, `Customer info`, `Manager & override`, `Drawing & commission` (manual), `GHL information`.

### Role differences
- `canAudit` (admin or Keaton): Refresh button (30), clickable manual items (131, 145-147), fix buttons (161).
- Others: read-only; manual items show a Lock icon.

---

## Component: CompetitionModal

File: src/components/CompetitionModal.jsx. Used by: Competitions page (admin only).

### Fields / controls
| Element | Label | Options / notes | File:line |
|---|---|---|---|
| Title | `New Competition` / `Edit Competition` | | 192 |
| `Name *` | input placeholder `e.g. Top Closer — March` | | 197-199 |
| `Type` | select | `Individual`, `Team`, `Grouped Teams`, `Team Average (per rep)`, `Company-wide`, `Head-to-head` (utils/competition.js:19-26) | 202-206 |
| `Metric` | select | `Revenue (baseline)`, `Deals closed` (competition.js:29-32) | 207-211 |
| `Start date` / `End date` | date inputs | | 212-217 |
| `Goal` | select | `Race — highest score wins`, `Target — reach a number to earn it` (competition.js:33-36) | 222-226 |
| Target input | label `Target (deals)` / `Target ($ baseline)` / `Target (avg deals per rep)` / `Target (avg $ baseline per rep)` | placeholders `e.g. 20` / `e.g. 100000` / `e.g. 4` / `e.g. 25000` | 227-235 |
| `Who gets credit` | select | `Setter & closer — both get full credit`, `Setter only — the rep who generated the lead`, `Closer only — the rep who closed it`, `Solo only — one rep both set AND closed it`, `Split between setter & closer`, `Setter full credit + closer part on a lead` (competition.js:37-44) | 239-243 |
| lead_bonus slider | `Setter 100%` / `Closer {n}%` range 0-100 step 5 + explanatory text | | 244-263 |
| split slider | `Setter {n}%` / `Closer {n}%` | | 264-276 |
| `Description` | placeholder `Short summary shown on the card` | | 278-280 |
| `Rules` | textarea placeholder `How it's scored, the prize, fine print…` | | 281-285 |
| Squads: `Sides — group teams & reps` | `Add side`; per side name input `Side name`, Trash `Remove side`, `Whole teams` chips (teamLabel), `Individual reps ({n} added)` details list, `Manual score overrides (optional)` details (`auto` placeholder) | | 287-369 |
| Company note | `Company-wide automatically includes every rep and manager — no need to pick participants.` | | 371-374 |
| Participants list | label `Participants` / `Teams (pick managers)` / `Teams competing`, `{n} selected`, checkbox rows, `No people available.` | | 376-399 |
| Team Average roster | `Who counts toward the average`, `{n} left out`, per team `{counted} of {n} count`, chips (`· {role}`, `· deactivated`), `Also left out (not on a picked team)` `dropped on save` | | 404-464 |
| `Manual score overrides (optional)` | details with per-participant number input placeholder `auto` | | 467-482 |
| `Rounds (optional)` | `Auto-split into weeks` (when both dates), `Add round`; empty text; per round inputs `Round name`, start, end, `Prize (e.g. $250)`, Trash `Remove round` | | 487-530 |
| Submit / Cancel | `Create competition` / `Save changes` / `Saving…`, `Cancel` | | 532-541 |

### Role differences
`visible = (u) => isAdmin || !u.ghost` (57) — ghosts selectable only by admins (modal itself is admin-only).

---

## Component: DateRangeFilter

File: src/components/DateRangeFilter.jsx. Used by: Dashboard, FilterBar (Deals), DealTable DateFilterPanel, Commissions (Earned tab).

| Element | Text | File:line |
|---|---|---|
| Preset pills | `This Week`, `Last Week`, `MTD`, `Last Month`, `This Quarter`, `Last Quarter`, `YTD`, `All Time` (utils/dateRanges.js:24-33) | 37-52 |
| Count | `{count} {countLabel}` (default `records`) | 55-59 |
| `Custom` badge | when range matches no preset | 61-66 |
| Custom inputs | from date (Calendar icon) `→` to date; `Clear` link | 70-98 (`showCustom`) |

No role gates.

---

## Component: DealModal

File: src/components/DealModal.jsx. Used by: Deals (admin FAB / edit), Payroll (edit).

### Fields / controls
| Section | Element | Options / notes | File:line |
|---|---|---|---|
| Header | `New Deal` / `Edit Deal`, X | | 526-529 |
| Row 1 | `Deal Name *` (placeholder `Smith Residence`; duplicate warning `A deal named "{x}" already exists ({date}).`) | | 537-544 |
| | `Status` select | from `useSettings().statusLabels` | 545-549 |
| | `Sale Date *`, `Install Date`, `Pay Date` | date inputs; install auto-fills pay | 550-558 |
| | `Office` select | `Select office…` + `useSettings().offices` | 559-564 |
| | `Payment Method` select | `Select method…` + `useSettings().paymentMethods` | 565-570 |
| | `Project ID` placeholder `SPX-1234` | | 571-573 |
| People | `Setter *` / `Closer *` PersonPicker (placeholders `Type to search setter…` / `Type to search closer…`, `No one matches "{q}".`) | | 578-585, 27-70 |
| `Commission Split` (split deals) | `Setter {n}%` range slider `Closer {n}%`, number input, `Setter $` / `Closer $` inputs, hint `Type either $ amount — the other rep gets the rest of the {$} rep pool and the split % updates.` | | 589-627 |
| Revenue | `Baseline Revenue ($) *` (placeholder `5000`), `Job Price ($) *` (placeholder `9000`) | | 631-638 |
| `Commission Preview` | `Gross Comm`, `Setter ({n}%)`, `Closer ({n}%)`, `Rep Comm %`; `Overrides` `Gross {$}`, `Mgr Override`, `Dir Override`, `VP Override` | | 642-675 |
| `Deduction` | `Amount ($)`, `Description` (placeholder `What is this deduction for?`); `Dealer Fee`: `Financed amount ($)`, `Dealer fee %`, `Dealer fee` (computed); `Who pays the deduction?` segmented `{closer}` / `{setter}` / `Split` + split slider; summary text | | 678-745 |
| `Override Chain` | rows `Manager`, `Director`, `VP`: select `None` + users by role (plus currently assigned), `Override %` input; `−{$} bonus → nets {$} ({pct}%)` | | 748-782 |
| `Override Exclusions · subcontracted items, no override on these` | rows select `Select item…` + `useSettings().overrideExclusionItems`, `Price $` input, X `Remove item`; `+ Add excluded item`; `Override base: … (baseline … − … excluded) · effective: …` | | 787-825 |
| `Rep Bonus · optional, chip in from anyone` | `Enter as` select `$ amount` / `% of baseline`; `Bonus to` select `{setter}` / `{closer}` / `Split between both` (split deals); rows `Company`, `Manager`, `Director`, `VP` with inputs and hints (`an extra on top, from nobody`, `no one assigned`, `override {$} → {$} ({pct}%)`, `· only has {$}; capped`); split slider; totals `Total bonus …`, `Total mgmt override: … → … (−…)` | | 829-906 |
| `Edit history` (edit only) | collapsible; `Loading…`, `No history yet. (Changes are recorded once migration 019 is run.)`, `Deal created`, `{label}: {from} → {to}` | | 908, 119-179 |
| Footer | `Create Deal` / `Save Changes` / `Saving…`, `Cancel` | | 912-920 |

### Dialogs
confirmDialog `A deal named "{x}" already exists` (`Create it anyway`) — 412-418.

### Role differences
None inside the modal; opened only by admins (Deals FAB `isAdmin`, DealTable `canEdit`, Payroll `openEdit`).

---

## Component: DealTable

File: src/components/DealTable.jsx. Used by: Deals page.

### Gates
`canEdit = profile?.role === 'admin' || profile?.is_admin === true` (884); `canVerify = canEdit` (886).

### Table columns (desktop `lg:`)
| Column | Header menu filter | Cell | File:line |
|---|---|---|---|
| `Deal` | sort only | name button (opens Notes thread; title `Notes`), ChangeAlertTag (❗), AuditBadge, 💬 `{count}`, CanceledMark (✕, title `Canceled`), HiddenMark (title `Hidden — counts toward nothing (revenue, payroll, leaderboards, competitions)`), DupeMark `2x` (title `Possible duplicate — …`); `{project_id}` subline | 971-990 |
| `Office` | OptionFilter `All offices` + offices | InlineSelectCell badge (Phoenix orange, Tucson violet), missing `+ office` | 991-995 |
| `Payment` | `All payments` + paymentMethods | InlineSelectCell, missing `+ payment` | 996-999 |
| `Status` | `All statuses` + statusLabels | StatusCell badge; select overlay (title `Change status`) | 1000-1003 |
| `People` | RepPickList | `Set {name}` / `Cls {name}` | 1004, 267-274 |
| `Dates` | DateFilterPanel (date field select + DateRangeFilter) | `Sale`, `Inst`, `Pay` DateField (date inputs when canEdit, `×` clear with title `Clear {label} date`; `— missing` text otherwise; amber when missing) | 1005-1012, 234-265 |
| `Revenue` | sort | `{job price}` / `base {baseline}` | 1013, 276-283 |
| `Commission` | sort | VerifySeal (BadgeCheck; titles `Commission checked`, `Commission checked — click to unmark`, `Mark commission as checked`), rep commission + `%`, split setter/closer amounts, DeductionTag `−{$}` (title `View deduction reason`; popover `Deduction · {$}`, itemized or `No description provided.`) | 1014, 471-519, 285-336 |
| `Actions` (canEdit) | — | audit re-run (title `Re-run audit`, when audit && canAudit), ActionButtons: Pencil edit, EyeOff hide/un-hide (titles `Hide — keep the record but count it toward nothing` / `Un-hide — this job counts again everywhere`; only when `onToggleHidden` passed), Trash delete | 1015-1028, 598-625 |

Header menu: `Sort` → `Ascending` / `Descending`; `Filter` section (112-189). Active-filter dot on header.

### Rows below a deal
- AuditStrip row (when audit present) + dark divider (1030-1041).
- Notes row: `Notes — {deal_name}` + NotesThread (1042-1051).

### NotesThread (631-788)
`Original note` legacy block; `Loading…`; `No notes yet — start the thread below.`; note cards (author, time, `· edited ×n` toggle → `Edit history` `… — previously: {old}`), Edit (Pencil, title `Edit`, own notes only `mine`), Delete (Trash, title `Delete (admin)`, `isAdmin`), inline edit textarea with `Save`/`Cancel`; composer textarea placeholder `Write a reply… (everyone on this deal gets notified)`, `Post` / `Posting…` (Cmd/Ctrl+Enter). confirmDialog `Delete this comment?` (`Delete`).

### ChangeAlertTag popover (342-466)
Title `New agreement on the sheet · {date}`; `Baseline {old} → {new}`, `Sale price {old} → {new}`, `Nothing on the deal was changed yet.`; when `canEdit`: `Apply new numbers to the deal` (confirm `Apply the sheet's new figures to this deal?` / `Apply new numbers`), `Dismiss — deal is already right` (confirm `Dismiss this change alert?` / `Dismiss alert`), and when `onSplit`: `Create as a separate deal` + `For a second job sold under the same project ID — this deal is left untouched.`

### Mobile cards (`lg:hidden`, DealCard 793-866)
Name button toggles notes; same badges; StatusCell; PeopleCell; RevenueCell; `Sale`/`Inst`/`Pay` DateFields; CommissionCell; audit `Re-run` button (canAudit) + AuditStrip; `Notes` panel; ActionButtons (canEdit).

### Empty / loading
`Loading deals…`, `No deals match your filters.` (921-933).

### Role differences
- Non-admins: read-only cells (badges/text), no Actions column, no FAB, VerifySeal visible only when verified (473), notes still readable/postable, own notes editable, delete only admin (736).

---

## Component: DeductionModal

File: src/components/DeductionModal.jsx. Used by: Payroll (`Log a deduction`, edit debt).

| Element | Label / text | File:line |
|---|---|---|
| Title | `Log a deduction` / `Edit deduction`; `Records what is owed. It never changes the deal's own numbers or a run that has already gone out.` | 200-203 |
| `Which job?` | selected deal card (`{$} baseline · sold {d} · installed {d} · {status}`, `Change`), or search input placeholder `Search every deal by customer name…` with up to 6 matches; hint `Leave blank if it isn't tied to a job — a tool, an advance, a uniform.` | 211-251 |
| `Amount owed` | number input placeholder `0.00` | 256-258 |
| `Who absorbs it` | person buttons `{Role} · {first}` + `earned {$}` + PayLine `{MMM d} pay {$} · {$} pending`; `Split` button (create only, two people); or select `Pick a person…` + active users | 261-299 |
| Split slider | `{setter} {n}%` / `{closer} {n}%`; `{a} owes {$} · {b} owes {$} — two separate balances, each coming off that rep's own next cheque.` | 301-317 |
| Hint | `Pre-picked from how this deal already splits deductions.` | 318-320 |
| Overshoot | `{name} is {$} short … on {date} — it waits, then comes out across however many runs it takes.` / `— "Hold until they have pay" takes what fits and carries the rest.` | 322-331 |
| `What was it` | input placeholder `e.g. turf seam repair — office email 9/18`; `This is what the rep reads on their pay statement, so write it for them.` | 337-341 |
| `When does it come out` | radios `Hold until they have pay` (`Waits in the Payroll tray and follows them run to run. Nothing to remember.`), `Take it on this run — {date}` (`Comes out now, in full.`), `A run I pick` (`When you already know which cheque it belongs on.`) + pay-date select (`No pay runs yet`) | 344-364 |
| Footer | `Cancel`, `Log deduction` / `Save changes` / `Saving…` | 367-373 |

No internal role gates (opened by admins only from Payroll).

---

## Component: DialogHost

File: src/components/DialogHost.jsx. Mounted once in Layout. Driven by `src/lib/dialog.js` (`confirmDialog`, `promptDialog`, `choiceDialog`, `revealDialog`, alert).

| Element | Text | File:line |
|---|---|---|
| Tone stripe + icon | default/danger/warn/info | 17-22, 100-107 |
| Title / message / bullets | from caller | 109-127 |
| Prompt input | label, placeholder, multiline textarea; `Required.` | 129-151 |
| Reveal | code value + `Copy` / `Copied` | 153-164 |
| Choice | stacked option buttons; first suffixed ` · recommended` | 168-184 |
| Buttons | `{cancelLabel \|\| 'Cancel'}` (not for reveal/alert); `{confirmLabel \|\| 'Done' \| 'Save' \| 'Confirm'}` | 186-198 |

Keyboard: Esc cancels, Enter confirms (Cmd/Ctrl+Enter in textarea). No role gates.

---

## Component: ErrorBoundary

File: src/components/ErrorBoundary.jsx. Used by: Layout (keyed by pathname).

Fallback: `Something broke on this page`, `The error has been reported automatically. Reloading usually clears it.`, button `Reload` (34-41). No role gates.

---

## Component: FilterBar

File: src/components/FilterBar.jsx. Used by: Deals page (hidden on Needs review).

| Row | Element | Options | File:line |
|---|---|---|---|
| 1 | DateRangeFilter (count `deals`) | presets | 64-71 |
| 1 | Date-field select (title `Which date the range applies to`) | `Closing date`, `Install date`, `Pay date` | 73-75 |
| 1 | Scope select (title `Whose deals to show`), only when `scopeOptions.length > 1` | from page | 76-80 |
| 2 | Search input placeholder `Search deal, address, ID…`, clear X (title `Clear search`) | | 86-100 |
| 2 | RepMultiSelect (`All Reps`) | reps = roles rep/manager/director/vp (36) | 101 |
| 2 | Status select | `All Statuses` + `useSettings().statusLabels` | 102-105 |
| 2 | Office select | `All Offices` + `useSettings().offices` | 106-109 |
| 2 | Payment select | `All Payments` + `useSettings().paymentMethods` | 110-113 |
| 3 | Chips `Filtered by`: `Rep: {name}`, `Status: {x}`, `Office: {x}`, `Payment: {x}`, `{Date field}: {from} → {to}`; `Clear all` | | 117-130 |

No internal role gates (page passes ghost-filtered users).

---

## Component: KpiCard

File: src/components/KpiCard.jsx. Used by: Deals page.

Props: `label` (uppercase), `value` (teal when `accent`), optional `value2` with `valueLabel`/`value2Label` side by side, optional `sub`. No gates.

---

## Component: Layout

See [Route: / (Layout shell)](#route--layout-shell). Used by: App.jsx route `/`.

---

## Component: Logo

File: src/components/Logo.jsx. Used by: NavBar, Login, SetPassword.

Renders `settings.site_logo` data URL, else `/logo.png`, else `TT` monogram (alt `Turf Time`). No gates.

---

## Component: ManagerBackfillModal

File: src/components/ManagerBackfillModal.jsx. Used by: Admin (after assigning a rep to a manager).

| Element | Text | File:line |
|---|---|---|
| Title | `Backfill manager on past deals`; `{rep} → {manager}. Tick the deals that should get {manager} as manager. Nothing changes unless ticked.`; X | 44-49 |
| Body | `Loading…`; `No past deals without a manager — nothing to backfill.`; checkbox rows `{deal_name}`, `{sale_date}`, `+{$}` / `$0` | 53-77 |
| Footer | `{n} selected · {$} in overrides`; `Skip`; `Backfill {n}` / `Saving…` | 80-90 |

No internal gates (admin page).

---

## Component: NavBar

File: src/components/NavBar.jsx. Used by: Layout.

| Element | Text | Gate | File:line |
|---|---|---|---|
| Logo + `{siteName}` | | all | 204-207 |
| Page title | `TITLES[pathname] ?? 'Turf Time'` | all | 210-212 |
| NotificationBell | Bell (title `Notifications`), badge `{n}` / `9+`; panel `Notifications`, `Nothing yet — you'll see deal-note replies here.`, items `{body}` + `{ago} ago · tap to open the thread` → `/deals?note={deal_id}` | all | 34-109 |
| User button | `{name}`, `{company_name}`, initials avatar (amber in preview), chevron | all | 217-240 |
| Menu: profile | name, email, `{role}` pill | all | 248-257 |
| Menu: `View site as` | `Rep view`, `Manager view` (Glasses icon; Check when active) | `isAdmin` (real profile) | 261-277 |
| Menu: `Preview as User` | expands grouped user list (vp, director, manager, rep, admin; `{name}` + role pill) → real impersonation + reload | `isAdmin` | 280-329 |
| Menu: `Change Password` | inputs `New password`, `Confirm new password`; `Update password` / `Saving…`; messages `At least 8 characters.`, `Passwords don't match.`, `Password updated.` | `!demoMode` | 332-362 |
| Menu: `Sign Out` | | all | 365-371 |

---

## Component: Notices

File: src/components/Notices.jsx. Mounted in Layout.

- Session-expired banner: `Your session expired — data may not load or save until you sign in again.` + `Sign in again` (40-53).
- Toasts (error/success/info, bottom-right, up to 5) with X dismiss (55-69).

No gates.

---

## Component: PeopleChart

File: src/components/PeopleChart.jsx. Used by: Admin → People.

| Element | Text | Gate | File:line |
|---|---|---|---|
| Toolbar | search placeholder `Search name or email…`; `{n} people · {n} team(s)`; `Deactivated · {n}` toggle; `Move people`; `Add person` | admin page; `Deactivated` only when inactive exist | 342-367 |
| `Leadership` section | Person cards for admin/vp/director (+ stray non-reps) | | 370-378 |
| `Teams` grid | Column per head (title = `teamLabel(head)` editable inline: placeholder `{head}'s Team`, titles `Rename team` / `Name this team`), member count pill, collapse chevron (`Expand`/`Collapse`); `Unassigned` column (`no team lead — drag them to a team`), empty texts `Everyone has a team.` / `No reps yet — drag someone here.`; drop hint `Drop to move to {name}` | | 266-334, 382-388 |
| Help text | `Drag a rep onto another team for a quick one-off move — effective today, … For a reorg use Move people: …` | | 389-393 |
| Person card | initials, name, role tag, `admin` badge (is_admin & role≠admin), `ghost`, `no login`; email or `since {date}`; `→ {team} on {date}` upcoming move; hover Actions (desktop) / `⋯` menu (mobile) with `Move to…` select (`Unassigned`) | | 171-242 |
| Actions | KeyRound `Reset their password` (auth_id && hasUserAdmin) / UserPlus `No login yet — create one` (!auth_id && hasUserAdmin); Pencil `Edit`; UserMinus `Deactivate — cuts their login, keeps all their deals and stats`; Trash `Delete from the roster — only for a row created by mistake` | `hasUserAdmin` for login buttons | 244-263 |
| Deactivated drawer | `Deactivated · {n}`, `Their deals and stats still count everywhere. Reactivate restores login + site access.`; rows with `deactivated` badge, `was on {team}` / `no team` · email, `Reactivate`, Edit, Delete | | 396-431 |

Drag-and-drop: non-heads only (`draggable`, 147).

---

## Component: RepActivityTable

File: src/components/RepActivityTable.jsx. Used by: Leads (By rep view).

| Element | Text | File:line |
|---|---|---|
| Empty | `Nobody has appointments or deals in this range.` | 134-142 |
| Columns | `Rep`, `Set` (`they booked it`), `Ran` (`of those`), `Closed` (`of those`), `Leads Ran` (`another rep's`), `Leads Closed` (`of those`) | 155-164 |
| Row | chevron, name, `ghost` (admin only), `inactive`, team label; stats with rate sublines | 166-204 |
| Expanded appointments | columns `Date`, `Customer`, `Role` (`Self-Gen`/`Set`/`Closer`), `Setter`, `Closer`, `RepCard outcome`; `not recorded`; other-team badge; `No appointments in this range.` | 71-128 |
| Footer | `Column totals` row; distinct strip `{n} appointments`, `{n} deals`, `{pct} close rate`, `Counted once each. …` | 205-236 |

Role: `r.ghost && isAdmin` shows `ghost` tag (178).

---

## Component: RepMultiSelect

File: src/components/RepMultiSelect.jsx. Exports `RepPickList`, default `RepMultiSelect`. Used by: FilterBar, DealTable (People header), Payroll (payee filter).

- Trigger: `All Reps` / `{a}, {b}` / `{a} +{n}`; X `Clear reps` (84-98).
- RepPickList: search `Search reps…`, `All reps` row, checkbox rows `{name}` `{role}`, `No one matches "{q}".`, footer `{n} selected` + `Clear` (14-54).

No gates (callers pass ghost-filtered lists).

---

## Component: SettingsPanel

File: src/components/SettingsPanel.jsx. Used by: Admin → Settings. Intro: `Changes here apply across the site immediately for everyone — no redeploy needed.`

| Section (order) | Controls | File:line |
|---|---|---|
| `Logo` | preview (`default mark`), `Upload logo` / `Replace logo` file, `Remove`, checkbox `Make white background transparent (applied on upload — re-upload to change)`; `Saving…`, `Saved — live everywhere now`, errors | 175-265 |
| `Site Name` | text input placeholder `Turf Time Dashboard` | 898-900 |
| `Deal Statuses` | rows color picker + label (`Status name`) + Trash; `Add status` | 41-88 |
| `Payment Methods` | ListEditor (placeholder `e.g. Self-Pay + Goodleap`); `Add option`; `None yet — add one below.` | 902-904 |
| `Offices` | ListEditor (`e.g. Phoenix`) | 905-907 |
| `Override Rates` | eras: `Effective from` date, `Manager %`, `Dir/VP % · {office}` per office, `Dir/VP % · other`, Trash `Remove this rate era`; `Add a rate change` | 409-503 |
| `Pay Date Rule` | `Pay day` select `Monday`…`Sunday`; `Weeks after install week` number 0-8; `Rule: {day} of …` | 508-557 |
| `Deal Note Notifications` | toggles `Closer` (`the deal's closer`), `Setter`, `Manager`, `Admins` (`every admin`) | 560-606 |
| `Lead Feed (CRM Webhook)` | `Webhook URL · POST` + `Copy`; `Last received` + `Copy payload`; `Last result`; `Field mapping` rows (`Appointment ID`, `Customer Name`, `Appointment Date/Time`, `Status / Disposition`, `Setter Email`, `Closer Email`, `Setter Name`, `Closer Name`, `Address`, `Phone`, `Customer Email`, `Office`, `Notes`) with datalist; `Their dispositions → our lifecycle` selects (`— auto-detect —`, `Scheduled — on the calendar`, `Ran — counts as an estimate`, `Sold — ran and closed`, `No Show`, `Canceled`); `Add a disposition you use…` + `Add` | 612-866 |
| `Field Activity Feed (Door Knocks — recorded, not shown)` | same FeedEditor with fields `Rep Email`, `Rep Name`, `Date`, `Doors Knocked`, `Knock Time`, `Is a Knock?`, `Event / Row ID`, `Office`; footnote | 638-647, 868-874 |
| `Feed: Not Field Reps` | ListEditor (`e.g. Josh Hilton`) | 913-915 |
| `Override Exclusion Items` | ListEditor (`e.g. Electrical`; fallback Electrical/Gas/Pergolas) | 916-918 |
| `Sync: Excluded Reps` | ListEditor (`e.g. Rhett`; fallback rhett/ronnie) | 919-921 |
| `Sync: Skip Deal Names` | ListEditor (`e.g. test`; fallback test/cute) | 922-924 |
| `Estimates From Leads — Start Date` | date | 925-926 |
| `Dashboard: Red-Flag Floors` | `Appointments set` number; `Default team for unassigned` select (`Keep a separate "Unassigned" row` + team heads) | 302-369, 927 |
| `Data Start Date` | date (fallback `2026-06-01`) | 928-929 |

Each editor has SaveBar: `Save changes` / `Saving…`, `Saved`, `Unsaved changes`, error box (18-38). Admin-only by route.

---

## Component: TeamMoveModal

File: src/components/TeamMoveModal.jsx. Used by: Admin (`Move people`).

| Step | Element | Text / options | File:line |
|---|---|---|---|
| Header | `Move people`, `Past sales stay with the old team — you choose the day it changes over.`, X | | 204-209 |
| 1 `Who's moving · {n} selected` | chips with X; search `Search the roster…`; checkbox list (initials, name, `lead` tag, team); `Nobody matches.` | | 215-259 |
| Lead warning | `{names} lead(s) {teams}` + `Moving a lead here makes them a rep on {dest}, so that team is dissolved. … use Edit instead.`; `Its rep goes to` / `Its {n} reps go to` select: `{dest} — same as their lead` / `The same team as their lead`, other teams, `Unassigned — no team lead` | | 262-298 |
| Non-lead with reports | `Their report goes to` / `Their {n} reports go to` select (same options; `The same team as whoever is moving`) | | 301-318 |
| 2 `Moving to` | select `Choose a team…`, team labels, `Unassigned — no team lead` | | 324-332 |
| 3 `Effective from` | date input; pills `Today`, `Tomorrow`, `1st of this month`, `1st of next month`; hint about date granularity; future notice `This is in the future, so it gets scheduled. …` | | 335-356 |
| `What this changes` | placeholder `Pick who's moving and where, and this will say exactly how many deals change hands.`; future text; `Checking the deals…`; rows `Deals moving to {dest}`, `Deals staying where they are`, `Closing on {date} itself`, `{lead} stops leading a team` → `{n} rep(s) → {dest}` / `no reps to reassign`; boundary warning `On the boundary — these go to {dest}. Push the date to {d+1} and they stay put.` + list `+{n} more`; per-person `{n} moving · {n} staying` | | 361-432 |
| `Why (optional)` | input placeholder `e.g. Q4 reorg — Jared's team split` (max 120); `Shows on the change log beside the dates.` | | 435-442 |
| Notice | `{n} of the {m} selected is/are already on {dest} — they will be left alone …` | | 446-451 |
| Blocked reason | `Pick who's moving.` / `Choose a team to move them to.` / `Pick the day it takes effect.` / `They are already on {dest}, so there is nothing to move.` (+ hint, `Open the change log`) | | 159-173, 456-477 |
| Footer | `Cancel`; `Move {n} person/people` / `Schedule {n} for {date}` | | 479-493 |

Esc closes (77-81). Admin-only by route.

---

## Component: UserModal

File: src/components/UserModal.jsx. Used by: Admin (`Add person` / Edit).

| Element | Label | Options / notes | File:line |
|---|---|---|---|
| Title | `Add User` / `Edit User` | | 109-111 |
| `Full Name *` | placeholder `Jane Smith` | | 122-124 |
| `Email *` | placeholder `jane@company.com` | | 125-127 |
| `Password *` (create only) | placeholder `••••••••`, minLength 8 | | 128-132 |
| `Role *` | select | `rep`, `manager`, `director`, `vp`, `admin` (ROLES line 5) | 133-137 |
| `Company` | placeholder `Turf Time` | | 138-140 |
| `Site Access` | toggle `Admin access — on/off`; `Full site/admin powers, independent of sales title.` | | 141-152 |
| `Visibility` | toggle `Ghost — on/off`; `Deals still count in all totals, but the name is hidden from non-admins on leaderboards, competitions, stats & filters.` | | 153-164 |
| `Reports To` | select `None` + managers/directors/vps `{name} ({role})`; hint | | 168-174 |
| `Assigned Director` | `None` + directors | | 175-180 |
| `Assigned VP` | `None` + vps | | 181-186 |
| `Login Password` (edit only) | input placeholder `Type a password (min 8 chars)`, button `Set password` / `Create login` / `Saving…`; hints; or `Set SUPABASE_SERVICE_KEY on the site service to manage passwords here, or use Supabase Studio → Authentication → Users.` | `pwConfigured = userAdminConfigured()` | 189-218 |
| `Team History` (edit only) | `No team moves recorded — reporting to {x} since before the change log began.` / `Now: reports to {x} · since {date}` + dated moves; footer | | 220-254 |
| Footer | `Create User` / `Save Changes` / `Saving…`, `Cancel` | | 256-272 |

---

## Hook: useAudit

File: src/components/useAudit.js. Not a visual component. Drives the Needs-review audit: for `canAudit` users runs the live `auditQueue` (cached 1h in `localStorage` `tt_audit_queue_cache_v2`), otherwise loads the stored checklist read-only (`fetchDealChecklists`). Exposes `rerunAll`, `rerun`, `toggleManual`, `applyFix` (fix types `assign_team` → navigate `/admin`, `ghl_fill`, `use_calendar_date`, `use_calendar_people`). Used by Deals page; consumed by AuditStrip/DealTable.

---

# Gating summary

| Element | Gate expression (as written) | File:line |
|---|---|---|
| Route `/` (Layout) | `Guard` → `!user` → `/login`; `!profile` → spinner | src/App.jsx:56-65 |
| Route `/payroll` | `Guard roles={['vp','admin']}` | src/App.jsx:87 |
| Route `/import` | `Guard roles={['vp','admin']}` | src/App.jsx:88 |
| Route `/goals` | `Guard roles={['rep','manager','director','vp','admin']}` | src/App.jsx:95-97 |
| Route `/admin` | `Guard roles={['admin']}` | src/App.jsx:102-104 |
| Guard admin-flag rule | `effectiveRoles = isAdmin ? [profile.role, 'admin'] : [profile.role]` | src/App.jsx:62 |
| `isAdmin` definition | `effectiveProfile?.role === 'admin' \|\| effectiveProfile?.is_admin === true` | src/contexts/AuthContext.jsx:174 |
| Nav items by role | `NAV.filter(n => n.roles.some(r => effectiveRoles.includes(r)))` | src/components/Layout.jsx:53-54 |
| Nav `Bonus` | `if (isAdmin \|\| canSeeTeam)` | src/components/Layout.jsx:56 |
| Nav `Requires Audit` | `if (isAdmin \|\| isKeaton(profile))` | src/components/Layout.jsx:60 |
| `isKeaton` | `p?.email?.toLowerCase() === 'keaton@turftime.com' \|\| p?.name === 'Keaton Shaker'` | src/components/Layout.jsx:35 |
| Impersonation banner | `isViewingAs` | src/components/Layout.jsx:68 |
| Preview banner | `isPreviewMode` | src/components/Layout.jsx:88 |
| NavBar `View site as` / `Preview as User` | `isAdmin` (`profile?.role === 'admin' \|\| profile?.is_admin === true` on real profile) | src/components/NavBar.jsx:159, 261, 280 |
| NavBar `Change Password` | `!demoMode` | src/components/NavBar.jsx:332 |
| Login demo credentials | `demoMode` | src/pages/Login.jsx:127 |
| Deals staging tabs | `canStage = isAdmin \|\| profile?.role === 'vp'` | src/pages/Deals.jsx:136, 541 |
| Deals live audit / fixes | `canAudit = isAdmin \|\| isKeaton` | src/pages/Deals.jsx:272-273 |
| Deals rep pickers hide ghosts | `pickUsers = isAdmin ? users : users.filter(u => !u.ghost)` | src/pages/Deals.jsx:200 |
| Deals scope options | `if (isAdmin) … if (role === 'rep') … else …` | src/pages/Deals.jsx:212-219 |
| Deals FAB (new deal) | `{isAdmin && (<button …)}` | src/pages/Deals.jsx:611 |
| Deals hide/un-hide | `onToggleHidden={isAdmin ? handleToggleHidden : undefined}` | src/pages/Deals.jsx:599 |
| Deals split alert | `onSplit={isAdmin ? handleSplitAlert : null}` | src/pages/Deals.jsx:601 |
| DealTable edit | `canEdit = profile?.role === 'admin' \|\| profile?.is_admin === true` | src/components/DealTable.jsx:884 |
| DealTable verify (gold check) | `canVerify = canEdit` | src/components/DealTable.jsx:886 |
| DealTable `Actions` column | `{canEdit && (<th …>Actions</th>)}` | src/components/DealTable.jsx:953 |
| DealTable re-run audit button | `audit?.byId[deal.id] && canAudit` | src/components/DealTable.jsx:1018 |
| VerifySeal visibility | `if (!verified && !canVerify) return null` | src/components/DealTable.jsx:472 |
| ChangeAlertTag actions | `{canEdit && (…)}`; split `{onSplit && (…)}` | src/components/DealTable.jsx:387, 445 |
| Notes: edit own | `mine = n.author_id === profile?.id` | src/components/DealTable.jsx:712, 732 |
| Notes: delete | `isAdmin = profile?.role === 'admin' \|\| profile?.is_admin === true` | src/components/DealTable.jsx:639, 736 |
| AuditStrip Refresh | `{canAudit && (<button …>Refresh)}` | src/components/AuditStrip.jsx:30 |
| AuditStrip manual toggle | `clickable = item.manual && canAudit` | src/components/AuditStrip.jsx:131 |
| AuditStrip fix button | `canAudit && item.fix` | src/components/AuditStrip.jsx:161 |
| Dashboard goal edit | `canEditGoal = isAdmin`; `canEditThisGoal = canEditGoal && (node?.level === 'company' \|\| node?.level === 'office')` | src/pages/Dashboard.jsx:167, 364, 813, 889 |
| Dashboard weekly goal block | `isCompany(scope)` | src/pages/Dashboard.jsx:844 |
| Dashboard leaderboard ghosts | `leaderboard(perf, scope, { isAdmin })`; `.filter(r => isAdmin \|\| !r.ghost)` | src/pages/Dashboard.jsx:397, 410; src/utils/scorecard.js:354 |
| Dashboard ghost name | `r.ghost && !isAdmin ? 'Hidden' : r.name` | src/pages/Dashboard.jsx:1072, 1127, 1177 |
| Commissions view-as | `{isAdmin && (<select …)}` | src/pages/Commissions.jsx:526 |
| Commissions override column | `showOverride = earnedRows.some(r => Math.abs(r.override) > 0.005)` | src/pages/Commissions.jsx:488-490 |
| Leads rep scoping | `(role === 'rep' && !isAdmin) ? leads.filter(mine) : leads` | src/pages/Leads.jsx:148 |
| Leads Import CSV | `{isAdmin && (<button …>Import CSV)}` | src/pages/Leads.jsx:386 |
| Leads rep select | `(role !== 'rep' \|\| isAdmin)` | src/pages/Leads.jsx:567 |
| Leads team select | `(role !== 'rep' \|\| isAdmin) && teamOptions.length > 0` | src/pages/Leads.jsx:573 |
| Leads inline setter/closer/status/ignore | `isAdmin ? (…) : (…)` | src/pages/Leads.jsx:677, 721 |
| Leads `Hand back to feed` | `{isAdmin && (…)}` | src/pages/Leads.jsx:417 |
| Leads pickUsers ghosts | `users.filter(u => u.active !== false && (isAdmin \|\| !u.ghost))` | src/pages/Leads.jsx:331 |
| Leads by-rep roster | `(role === 'rep' && !isAdmin) ? [profile?.id] : teamFilter ? … : null`; `visible = isAdmin ? users : users.filter(u => !u.ghost)` | src/pages/Leads.jsx:357-362 |
| RepActivityTable ghost tag | `r.ghost && isAdmin` | src/components/RepActivityTable.jsx:178 |
| MyTeam access | `if (!isAdmin && teams.length === 0) return <Navigate to="/dashboard" replace />` | src/pages/MyTeam.jsx:127 |
| MyTeam team select | `teams.length > 1` | src/pages/MyTeam.jsx:164 |
| Competitions manage | `canManage = isAdmin` | src/pages/Competitions.jsx:784 |
| Competitions header buttons | `{canManage && (… Export all … New)}` | src/pages/Competitions.jsx:970 |
| Competition card icons | `{canManage && (…)}` | src/pages/Competitions.jsx:235 |
| Competition drill-down | `clickable = canManage && !e.manual` | src/pages/Competitions.jsx:47 |
| Competition exclude toggle | `canManage && onToggleComp && !canceled && !hidden` | src/pages/Competitions.jsx:125 |
| Round winner override | `canManage && selRound && roundStatus(...) === 'ended'` | src/pages/Competitions.jsx:282 |
| Competition ghosts | `hiddenIds: isAdmin ? null : ghostIds` | src/pages/Competitions.jsx:175, 754 |
| CompetitionModal ghosts | `visible = (u) => isAdmin \|\| !u.ghost` | src/components/CompetitionModal.jsx:57 |
| Home view-as | `{isAdmin && (<select …)}` | src/pages/Home.jsx:419 |
| Home rank ghosts | `.filter(u => SELLER(u) && (isAdmin \|\| !u.ghost))` | src/pages/Home.jsx:214 |
| Home competitions ghosts | `hiddenIds = isAdmin ? null : ghostIds` | src/pages/Home.jsx:264 |
| Home RepCard section | `repCard.configured !== false` | src/pages/Home.jsx:529 |
| Payroll approve | `canApprove = isAdmin && !runLock && statusLabels?.includes(APPROVED)` | src/pages/Payroll.jsx:661 |
| Payroll pay | `canPay = isAdmin && statusLabels?.includes(PAID)` | src/pages/Payroll.jsx:664 |
| Payroll open edit | `if (!isAdmin) return` | src/pages/Payroll.jsx:666 |
| Payroll Log a deduction | `{isAdmin && (…)}` | src/pages/Payroll.jsx:1083, 1932 |
| Payroll Unlock | `{isAdmin && (<button onClick={unlockRun}>Unlock)}` | src/pages/Payroll.jsx:1180 |
| Payroll debt row actions | `isAdmin && !runLock && !open` | src/pages/Payroll.jsx:1355 |
| Payroll Add pay / Lock run | `isAdmin && !runLock` | src/pages/Payroll.jsx:1447, 1457 |
| Payroll payee `+` | `isAdmin && view !== 'overdue' && !runLock` | src/pages/Payroll.jsx:1568 |
| Payroll copy statement | `{isAdmin && (…)}` | src/pages/Payroll.jsx:1573 |
| Payroll remove adjustment | `isAdmin && !runLock` | src/pages/Payroll.jsx:1627 |
| Payroll Approve button | `canApprove && !dealLocked && !isPaid && d.status !== APPROVED` | src/pages/Payroll.jsx:1811 |
| Payroll Paid button | `canPay && (isPaid ? … : (!dealLocked \|\| d.status === APPROVED) && …)` | src/pages/Payroll.jsx:1818-1820 |
| Payroll ledger actions | `isAdmin && d.status !== 'settled'` | src/pages/Payroll.jsx:1984 |
| Payroll pay users ghosts | `users.filter(u => u.active !== false && (isAdmin \|\| !u.ghost))` | src/pages/Payroll.jsx:284 |
| RequiresAudit access | `allowed = isAdmin \|\| isKeaton(profile)`; `if (!allowed) return <Navigate to="/dashboard" replace />` | src/pages/RequiresAudit.jsx:31, 55 |
| Goals edit | `canEditRep = (rep) => isAdmin \|\| rep.id === profile?.id \|\| rep.manager_id === profile?.id` | src/pages/Goals.jsx:109 |
| Goals roster ghosts | `(isAdmin \|\| !u.ghost)` | src/pages/Goals.jsx:94 |
| Admin login buttons | `hasUserAdmin = userAdminConfigured()` → `hasUserAdmin && <button …>` | src/pages/Admin.jsx:349; src/components/PeopleChart.jsx:249-250 |
| UserModal password box | `pwConfigured = userAdminConfigured()` | src/components/UserModal.jsx:38, 194 |
| PeopleChart draggable | `draggable = (u) => !heads.has(u.id) && u.active !== false` | src/components/PeopleChart.jsx:147 |

# Undetermined items

- **`canSeeTeam` membership rule** (src/components/Layout.jsx:45-50 and src/pages/MyTeam.jsx:90-99): depends on `fetchMyTeams(profile)` in src/lib/db.js / RLS, not on any role in the JSX. The checklist can only verify "Bonus appears iff the server returns ≥1 team (or isAdmin)".
- **Team head rule (`headIdSet`, `teamLabel`)** used for scope/team options across Deals, Leads, Dashboard, CompetitionModal, TeamMoveModal, Goals, SettingsPanel: defined in src/utils/team.js (not read for this inventory); the option *labels* come from `teamLabel(head)` (profile `team_name` or `"{Name}'s Team"` per PeopleChart.jsx placeholder at line 295).
- **Dashboard scope/funnel node fields** (`node.childKind`, `node.funnelNote`, `node.showFunnel`, `drillable`) come from src/utils/perfSummary.js and src/utils/scorecard.js; the exact caption strings for `funnelNote` were not read.
- **Deal-audit detail wording** beyond the item labels (reasons/fix payloads) is generated in src/utils/dealAudit7.js:105-259 and server-side; listed by shape only.
- **`/deals?scope=all&rep=…` links** from Dashboard (Dashboard.jsx:108, 1263): Deals.jsx reads only the `note` search param (Deals.jsx:132-133); the `scope`/`rep` params are currently ignored. Flagged so the redesign doesn't assume they work.
- **Status-dependent Payroll buttons**: `canApprove`/`canPay` also require the admin-editable status list to contain `Pay Finalized` / `Paid` (Payroll.jsx:661, 664); with renamed statuses those buttons disappear for everyone.
