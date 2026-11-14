# Redesign inventory check (step 9)

Every backticked item in `docs/redesign-inventory.md`, checked against the finished `redesign/private-bank` branch.
`Present`: **yes** = exact text in the file the inventory names; **yes (elsewhere)** = exact text in another source file (shared component or util); **yes (fuzzy)** = template text whose words are all present; **gate** = a permission/code expression, verified by identifier; **CHECK** = resolved by hand (see Totals).

## What moved, by section

| Section | Moved to |
|---|---|
| Route: /deals | Office + payment sit under the deal name; their filters/sorts live in the Deal header menu; phones show compact rows that expand. |
| Route: /dashboard | KPI tiles use the shared KpiFigure; everything else in place. |
| Route: /commissions | Payday card → standing list → detail order; phone rows expand. |
| Route: /leads | Day rows become compact rows on phones; admin SET/RUN/status controls sit inside the expanded row. |
| Route: /myteam | Member table becomes expandable rows on phones. |
| Route: /competitions | Card icons sit under the title on phones; record-book pills use the shared Pill. |
| Route: /goals | Rep rows become cards on phones with the same inline editors. |
| Route: /payroll | Payee rows hide Deals / Deal pay / Adjustments on phones until expanded; deal rows show install · setter · status under the name on phones. |
| Route: /import | Preview table becomes stacked cards on phones. |
| Route: /audit | Mismatch and history tables become stacked cards on phones; the modal is a full-height sheet on phones. |
| Route: /admin | People columns collapse on phones; row actions stay behind the ⋯ menu; modals are full-height sheets on phones. |
| Component: CompetitionModal | Full-height phone sheet with sticky footer. |
| Component: DealModal | Full-height phone sheet with sticky Save/Cancel. |
| Component: DeductionModal | Full-height phone sheet with sticky footer. |
| Component: UserModal | Full-height phone sheet with sticky footer. |
| Component: TeamMoveModal | Full-height phone sheet with sticky footer. |
| Component: ManagerBackfillModal | Full-height phone sheet. |
| Component: RepActivityTable | Expandable rows on phones. |
| Component: DealTable | Grouped columns; filters/sorts in header menus; phone DealCard rows. |

## Every item

| Section | Item | Present | Where / note |
|---|---|---|---|
| Route: /login | <Logo size={48} /> | yes |  |
| Route: /login | TURF TIME | yes |  |
| Route: /login | Commission Dashboard | yes |  |
| Route: /login | Reset your password | yes |  |
| Route: /login | This account has been deactivated. Contact an administrator. | yes |  |
| Route: /login | If {email} has an account, a reset link is on its way. Check your inbox (and spam) — the l | yes |  |
| Route: /login | Enter your work email and we'll send a link to choose a new password. | yes |  |
| Route: /login | Demo credentials | yes |  |
| Route: /login | keaton@turftime.com (VP) · garrison@turftime.com (Director) | yes |  |
| Route: /login | jared@turftime.com (Manager) · stephen@turftime.com (Rep) | yes |  |
| Route: /login | admin@turftime.com (Admin) | yes |  |
| Route: /login | Password: TurfTime2026! | yes |  |
| Route: /login | Access is invite-only — new here? Your invite email has your link. | yes |  |
| Route: /login | Email | yes |  |
| Route: /login | you@turftimeaz.com | yes |  |
| Route: /login | Password | yes |  |
| Route: /login | •••••••• | yes |  |
| Route: /login | showPwd | yes |  |
| Route: /login | Forgot password? | yes |  |
| Route: /login | Sign in | yes |  |
| Route: /login | Signing in… | yes |  |
| Route: /login | Email me a reset link | yes |  |
| Route: /login | Sending… | yes |  |
| Route: /login | Back to sign in | yes |  |
| Route: /set-password | TURF TIME | yes |  |
| Route: /set-password | Create your password | yes |  |
| Route: /set-password | Set password | yes |  |
| Route: /set-password | Checking your link… | yes |  |
| Route: /set-password | This link is invalid or has expired. Invite and reset links only work once and for a limit | yes |  |
| Route: /set-password | Use "Forgot password?" on the sign-in page to get a fresh link, or ask an admin to resend  | yes (fuzzy) |  |
| Route: /set-password | Choose the password you'll use to sign in from now on. | yes |  |
| Route: /set-password | Use at least 8 characters. | yes |  |
| Route: /set-password | The passwords don't match. | yes |  |
| Route: /set-password | New password | yes |  |
| Route: /set-password | At least 8 characters | yes |  |
| Route: /set-password | Confirm password | yes |  |
| Route: /set-password | Type it again | yes |  |
| Route: /set-password | Set password & sign in | yes |  |
| Route: /set-password | Saving… | yes |  |
| Route: / (Layout shell) | Viewing as {viewingAs.name} — you are seeing exactly what they see | yes |  |
| Route: / (Layout shell) | read-only | yes |  |
| Route: / (Layout shell) | Back to me | yes |  |
| Route: / (Layout shell) | isViewingAs | yes |  |
| Route: / (Layout shell) | Viewing as {profile.name} · {profile.role} permissions | yes |  |
| Route: / (Layout shell) | isPreviewMode | yes |  |
| Route: / (Layout shell) | md: | yes |  |
| Route: / (Layout shell) | md:hidden | yes |  |
| Route: / (Layout shell) | isAdmin \\|\\| canSeeTeam | yes |  |
| Route: / (Layout shell) | effectiveRoles | yes |  |
| Route: / (Layout shell) | isAdmin \\|\\| isKeaton(profile) | yes |  |
| Route: / (Layout shell) | effectiveRoles = isAdmin ? [role,'admin'] : [role] | gate | src/App.jsx |
| Route: / (Layout shell) | fetchMyTeams | yes |  |
| Route: /deals | Revenue | yes |  |
| Route: /deals | Baseline | yes |  |
| Route: /deals | Job Price | yes |  |
| Route: /deals | Commissions | yes |  |
| Route: /deals | Deals | yes |  |
| Route: /deals | {canceled} canceled · {pct}% | yes |  |
| Route: /deals | Avg Comm | yes |  |
| Route: /deals | {avgMarkupPct}% markup | yes |  |
| Route: /deals | Avg Deal | yes |  |
| Route: /deals | Every deal needing anything — unverified, flagged ❗, or missing info. Search & filters don | yes (fuzzy) |  |
| Route: /deals | 🎉 Nothing to review — every deal is verified and complete. | yes |  |
| Route: /deals | Showing {from}–{to} of {total} | yes |  |
| Route: /deals | onReview | yes |  |
| Route: /deals | Which date | yes (elsewhere) | src/components/DealTable.jsx,src/components/FilterBar.jsx,src/pages/Commissions.jsx |
| Route: /deals | Closing date | yes (elsewhere) | src/components/DealTable.jsx,src/pages/Commissions.jsx |
| Route: /deals | Install date | yes (elsewhere) | src/components/DealModal.jsx,src/components/DealTable.jsx,src/utils/dealAudit7.js |
| Route: /deals | Pay date | yes (elsewhere) | src/components/DealModal.jsx,src/components/DealTable.jsx,src/components/SettingsPanel.jsx,src/pages/Commissions.jsx,src/pages/Payroll.jsx |
| Route: /deals | DATE_FIELDS | yes (elsewhere) | src/components/DealTable.jsx,src/components/FilterBar.jsx |
| Route: /deals | Search deal, address, ID… | yes (elsewhere) | src/components/FilterBar.jsx |
| Route: /deals | All Statuses | yes (elsewhere) | src/components/FilterBar.jsx |
| Route: /deals | All Offices | yes (elsewhere) | src/components/FilterBar.jsx |
| Route: /deals | All Payments | yes (elsewhere) | src/components/FilterBar.jsx |
| Route: /deals | All Teams | yes |  |
| Route: /deals | My deals | yes |  |
| Route: /deals | All deals | yes |  |
| Route: /deals | My team | yes |  |
| Route: /deals | Sort | yes |  |
| Route: /deals | Ascending | yes (elsewhere) | src/components/DealTable.jsx |
| Route: /deals | Descending | yes (elsewhere) | src/components/DealTable.jsx |
| Route: /deals | Filter | yes |  |
| Route: /deals | Previous page | yes |  |
| Route: /deals | Next page | yes |  |
| Route: /deals | Per page | yes |  |
| Route: /deals | 100 | yes |  |
| Route: /deals | 200 | yes |  |
| Route: /deals | Needs review | yes |  |
| Route: /deals | canStage = isAdmin \\|\\| profile.role === 'vp' | gate | src/pages/Deals.jsx |
| Route: /deals | Refresh | yes (elsewhere) | src/components/AuditStrip.jsx,src/components/DealTable.jsx,src/components/ErrorBoundary.jsx,src/hooks/useRefreshOnFocus.js,src/lib/db.js,src/pages/Admin.jsx,src/pages/Commissions.jsx,src/pages/Dashboard.jsx,src/pages/Leads.jsx |
| Route: /deals | updated {ago} | yes |  |
| Route: /deals | Running audit… | yes (elsewhere) | src/components/AuditStrip.jsx |
| Route: /deals | The audit runs on the live site (disabled in demo mode). | yes (elsewhere) | src/components/AuditStrip.jsx |
| Route: /deals | Audit failed: … retry | yes (fuzzy) | src/components/AuditStrip.jsx |
| Route: /deals | canAudit | yes |  |
| Route: /deals | Export CSV | yes |  |
| Route: /deals | Export all N deals in view to a CSV — every page, not just this one | yes (fuzzy) | src/pages/Competitions.jsx |
| Route: /deals | isAdmin | yes |  |
| Route: /deals | Create the sheet's new figures as a separate deal? | yes (fuzzy) | src/components/DealTable.jsx |
| Route: /deals | Create the new deal | yes |  |
| Route: /deals | Delete "{name}"? | yes (fuzzy) | src/components/PeopleChart.jsx |
| Route: /deals | Delete deal | yes |  |
| Route: /deals | Hide "{name}"? | yes |  |
| Route: /deals | Reason (optional) | yes |  |
| Route: /deals | e.g. Tanner's job, came in under Keaton's ArcSite login | CHECK | 4/6 words in src/utils/commission.js |
| Route: /deals | Hide deal | yes |  |
| Route: /deals | saveDealFields | yes |  |
| Route: /deals | teamLabel | yes |  |
| Route: /deals | .offices | yes (elsewhere) | src/components/DealModal.jsx,src/components/DealTable.jsx,src/components/FilterBar.jsx,src/components/SettingsPanel.jsx,src/contexts/SettingsContext.jsx,src/lib/demoData.js,src/pages/Dashboard.jsx,src/pages/Payroll.jsx,src/utils/perfSummary.js,src/utils/scorecard.js |
| Route: /deals | .paymentMethods | yes (elsewhere) | src/components/DealModal.jsx,src/components/DealTable.jsx,src/components/FilterBar.jsx,src/contexts/SettingsContext.jsx |
| Route: /deals | canStage | yes |  |
| Route: /deals | canAudit = isAdmin \|\| isKeaton | yes |  |
| Route: /deals | pickUsers = isAdmin ? users : users.filter(u => !u.ghost) | yes |  |
| Route: /dashboard | Company › … › {node.title} | yes (fuzzy) | src/utils/competition.js |
| Route: /dashboard | Copy | yes |  |
| Route: /dashboard | Copied | yes |  |
| Route: /dashboard | 🔥 {n} record(s) falling right now | yes (fuzzy) | src/pages/Competitions.jsx |
| Route: /dashboard | {n} company · {n} team · {n} rep | yes |  |
| Route: /dashboard | Company | yes |  |
| Route: /dashboard | Team | yes |  |
| Route: /dashboard | Rep | yes |  |
| Route: /dashboard | · just set | yes |  |
| Route: /dashboard | was … · holder, label | yes (fuzzy) | src/utils/records.js |
| Route: /dashboard | Revenue | yes |  |
| Route: /dashboard | Baseline | yes |  |
| Route: /dashboard | Job Price | yes |  |
| Route: /dashboard | Baseline = company's cost basis | yes |  |
| Route: /dashboard | baseline vs prev | yes |  |
| Route: /dashboard | Commissions | yes |  |
| Route: /dashboard | Setter + closer, after deductions | yes |  |
| Route: /dashboard | Avg Comm % | yes |  |
| Route: /dashboard | Of baseline, after deductions | yes |  |
| Route: /dashboard | Total Deals | yes |  |
| Route: /dashboard | Avg Deal Size | yes |  |
| Route: /dashboard | {pct}% vs prev | yes (fuzzy) | src/contexts/AuthContext.jsx |
| Route: /dashboard | {Month YYYY} Revenue Goal — {scope} | yes (fuzzy) | src/utils/goals.js |
| Route: /dashboard | Custom goal | yes |  |
| Route: /dashboard | Auto: 3-month avg ×1.1 | yes |  |
| Route: /dashboard | Month Revenue | yes |  |
| Route: /dashboard | Goal | yes |  |
| Route: /dashboard | Remaining | yes |  |
| Route: /dashboard | Goal Hit! 🎉 | yes |  |
| Route: /dashboard | Saved | yes |  |
| Route: /dashboard | Save failed | yes |  |
| Route: /dashboard | This Week ({Mon d – Mon d}) | yes |  |
| Route: /dashboard | Custom weekly goal | yes |  |
| Route: /dashboard | Auto: monthly goal ÷ weeks | yes |  |
| Route: /dashboard | Week Revenue | yes |  |
| Route: /dashboard | Appointments | yes |  |
| Route: /dashboard | {rep}'s appointments | yes |  |
| Route: /dashboard | Appointment counts, never deals | yes |  |
| Route: /dashboard | Set | yes |  |
| Route: /dashboard | {n}% have run | yes |  |
| Route: /dashboard | Ran | yes |  |
| Route: /dashboard | {n}% closed | yes |  |
| Route: /dashboard | Sold | yes |  |
| Route: /dashboard | {n}% of set | yes |  |
| Route: /dashboard | {n} appointment(s) past their date with no outcome logged — they count as neither ran nor  | yes (fuzzy) | src/utils/perfSummary.js |
| Route: /dashboard | Self-gen ran | yes |  |
| Route: /dashboard | Leads ran | yes |  |
| Route: /dashboard | Self-gen deals | yes |  |
| Route: /dashboard | {n}% close | yes |  |
| Route: /dashboard | Lead closes | yes |  |
| Route: /dashboard | Weekly Performance | yes |  |
| Route: /dashboard | Sun–Sat · last {n} full weeks + this week · avg {$} & {n} deals / week | yes (fuzzy) | src/utils/scorecard.js |
| Route: /dashboard | This wk | yes |  |
| Route: /dashboard | Week | yes |  |
| Route: /dashboard | {n} deal(s) | yes (elsewhere) | src/pages/Payroll.jsx |
| Route: /dashboard | No data | yes |  |
| Route: /dashboard | Annual Trend | yes |  |
| Route: /dashboard | Trailing 12 months | yes |  |
| Route: /dashboard | Revenue: $… | yes |  |
| Route: /dashboard | Deals: n | yes (fuzzy) | src/App.jsx |
| Route: /dashboard | Deals | yes |  |
| Route: /dashboard | Avg deal | yes |  |
| Route: /dashboard | Markup | yes |  |
| Route: /dashboard | Commission | yes |  |
| Route: /dashboard | RepDealsInline | yes |  |
| Route: /dashboard | Deal | yes |  |
| Route: /dashboard | Status | yes |  |
| Route: /dashboard | Open in Deals → | yes |  |
| Route: /dashboard | Total Revenue | yes |  |
| Route: /dashboard | Set Deals | yes |  |
| Route: /dashboard | Self-Gen | yes |  |
| Route: /dashboard | Leads Closed | yes |  |
| Route: /dashboard | {n} reps with activity · tap a column to rank by it · Set Deals + Self-Gen are the deals t | yes (fuzzy) |  |
| Route: /dashboard | No deals in this range. | yes |  |
| Route: /dashboard | Open in Deals for filtering and edits → | yes |  |
| Route: /dashboard | Break down by | yes |  |
| Route: /dashboard | Teams | yes |  |
| Route: /dashboard | Offices | yes |  |
| Route: /dashboard | Reps | yes |  |
| Route: /dashboard | Back to {label} | yes |  |
| Route: /dashboard | + Appointments | yes (fuzzy) | src/utils/perfSummary.js |
| Route: /dashboard | ✓ Appointments | yes (fuzzy) | src/utils/perfSummary.js |
| Route: /dashboard | Click a team to drop its reps in below; click a rep to see their deals. | yes |  |
| Route: /dashboard | Click a row to scope the whole page to it. | yes |  |
| Route: /dashboard | Copy this table for a text or a slide | yes |  |
| Route: /dashboard | Copy table | yes |  |
| Route: /dashboard | Copy as a table — pastes formatted into Canva, Sheets or Docs | yes |  |
| Route: /dashboard | canEditThisGoal = canEditGoal && (company \\|\\| office level) | gate | src/pages/Dashboard.jsx |
| Route: /dashboard | canEditGoal = isAdmin | yes |  |
| Route: /dashboard | canEditGoal | yes |  |
| Route: /dashboard | copyTable | yes |  |
| Route: /dashboard | Name | yes |  |
| Route: /dashboard | TOTAL | yes |  |
| Route: /dashboard | copyLeaderboard | yes |  |
| Route: /dashboard | isAdmin | yes |  |
| Route: /dashboard | leaderboard(perf, scope, { isAdmin }) | yes |  |
| Route: /dashboard | teamRepRows | yes |  |
| Route: /dashboard | isAdmin \|\| !r.ghost | yes |  |
| Route: /dashboard | Hidden | yes |  |
| Route: /commissions | My Commissions | yes |  |
| Route: /commissions | {name}'s Commissions | yes |  |
| Route: /commissions | Next payday | yes |  |
| Route: /commissions | Upcoming payday | yes |  |
| Route: /commissions | {EEE, MMM d} · {n} deal(s) | yes (elsewhere) | src/pages/Payroll.jsx |
| Route: /commissions | No scheduled paydays coming up. | yes |  |
| Route: /commissions | {$} pending from past pay dates | yes |  |
| Route: /commissions | Paycheck · {date} | yes |  |
| Route: /commissions | {n} deal(s) · tap a deal for the breakdown | yes (fuzzy) | src/utils/records.js |
| Route: /commissions | Nothing on this paycheck. | yes |  |
| Route: /commissions | Manual adjustment | yes |  |
| Route: /commissions | Deduction | yes |  |
| Route: /commissions | Total this paycheck | yes |  |
| Route: /commissions | Job price | yes |  |
| Route: /commissions | Baseline | yes |  |
| Route: /commissions | Rep pool | yes |  |
| Route: /commissions | Override base (−… excluded) | yes (fuzzy) | src/contexts/SettingsContext.jsx |
| Route: /commissions | detail · with {partner} | yes (fuzzy) | src/utils/deductions.js |
| Route: /commissions | − Deduction ({label}) | yes |  |
| Route: /commissions | This deal has a {$} deduction — … | yes |  |
| Route: /commissions | Paid | yes |  |
| Route: /commissions | Expected · {day} | yes |  |
| Route: /commissions | · pay date TBD | yes |  |
| Route: /commissions | Your take {$} | yes |  |
| Route: /commissions | {$} in deductions still to come out | yes |  |
| Route: /commissions | {n} item(s) | yes (fuzzy) | src/App.jsx |
| Route: /commissions | No job | yes |  |
| Route: /commissions | {recovered} of {owed} already taken | yes |  |
| Route: /commissions | It comes off a future paycheck — the run it lands on is set by leadership, not automatical | yes |  |
| Route: /commissions | Owed to you | yes |  |
| Route: /commissions | {n} unpaid deal(s) · {$} overdue | yes (fuzzy) |  |
| Route: /commissions | Paid out | yes |  |
| Route: /commissions | all time · {$} this month | yes |  |
| Route: /commissions | grouped by pay week · tap a week | yes |  |
| Route: /commissions | grouped by pay date · tap a deal | yes |  |
| Route: /commissions | Pay date TBD | yes |  |
| Route: /commissions | {n} deal(s) | yes (elsewhere) | src/pages/Payroll.jsx |
| Route: /commissions | Closer: … | yes |  |
| Route: /commissions | Setter: … | yes |  |
| Route: /commissions | Install: … | yes |  |
| Route: /commissions | Pay: … ⚠ overdue | yes (fuzzy) | src/components/SettingsPanel.jsx |
| Route: /commissions | No unpaid deals — you're all caught up! | yes |  |
| Route: /commissions | Paid {day} | yes |  |
| Route: /commissions | No pay date | yes |  |
| Route: /commissions | Nothing paid out yet. | yes |  |
| Route: /commissions | Rep Commission | yes |  |
| Route: /commissions | setter + closer · by {basis} | yes |  |
| Route: /commissions | Override | yes |  |
| Route: /commissions | mgr · dir · VP · by … | yes |  |
| Route: /commissions | Total Earned — by {basis} | yes |  |
| Route: /commissions | Commission Earned — by {basis} | yes |  |
| Route: /commissions | Deal Count | yes |  |
| Route: /commissions | Already Paid | yes |  |
| Route: /commissions | Not Yet Paid | yes |  |
| Route: /commissions | of {$} earned | yes |  |
| Route: /commissions | Detail — by {basis} | yes |  |
| Route: /commissions | newest first · {preset} | yes |  |
| Route: /commissions | Nothing earned in this range by {basis}. | yes |  |
| Route: /commissions | {n} deal(s) excluded (no {basis}) | yes (fuzzy) | src/contexts/SettingsContext.jsx |
| Route: /commissions | Loading… | yes |  |
| Route: /commissions | Couldn't load deals: {msg} | yes |  |
| Route: /commissions | Sale Date | yes |  |
| Route: /commissions | Install Date | yes |  |
| Route: /commissions | Pay Date | yes |  |
| Route: /commissions | Earlier payday | yes |  |
| Route: /commissions | Later payday | yes |  |
| Route: /commissions | My commissions | yes |  |
| Route: /commissions | isAdmin | yes |  |
| Route: /commissions | To be paid ({n}) | yes |  |
| Route: /commissions | Paid ({n}) | yes |  |
| Route: /commissions | Earned | yes |  |
| Route: /commissions | showOverride | yes |  |
| Route: /leads | Leads | yes |  |
| Route: /leads | Appointments fed in from the field CRM, in calendar order. An appointment that RAN counts  | yes (fuzzy) | src/components/SettingsPanel.jsx |
| Route: /leads | CRM feed · {feed.text} | yes |  |
| Route: /leads | {n} in the last 7 days | yes |  |
| Route: /leads | {n} appointments | yes |  |
| Route: /leads | Appointments Set | yes |  |
| Route: /leads | Ran (Estimates) | yes |  |
| Route: /leads | {n}% show rate | yes |  |
| Route: /leads | Sold at Appt | yes |  |
| Route: /leads | outcome, not a deal record | yes |  |
| Route: /leads | Appt Close % | yes |  |
| Route: /leads | sold ÷ ran | yes |  |
| Route: /leads | No Shows | yes |  |
| Route: /leads | No appointments in this range. | yes |  |
| Route: /leads | Today | yes |  |
| Route: /leads | Tomorrow | yes |  |
| Route: /leads | Yesterday | yes |  |
| Route: /leads | {n} appt(s) · {n} ran · {n} sold | yes (fuzzy) | src/utils/estimates.js |
| Route: /leads | No date set | yes |  |
| Route: /leads | SET {name} | yes |  |
| Route: /leads | RUN {name} | yes |  |
| Route: /leads | This Week | yes |  |
| Route: /leads | Next Week | yes |  |
| Route: /leads | Last Week | yes |  |
| Route: /leads | This Month | yes |  |
| Route: /leads | All | yes |  |
| Route: /leads | Customer, address, rep… | yes |  |
| Route: /leads | All statuses | yes |  |
| Route: /leads | Scheduled | yes |  |
| Route: /leads | Ran | yes |  |
| Route: /leads | Sold | yes |  |
| Route: /leads | No Show | yes |  |
| Route: /leads | Canceled | yes |  |
| Route: /leads | All reps | yes |  |
| Route: /leads | role !== 'rep' \\|\\| isAdmin | yes |  |
| Route: /leads | All teams | yes |  |
| Route: /leads | teamLabel | yes |  |
| Route: /leads | (role !== 'rep' \\|\\| isAdmin) && teamOptions.length > 0 | yes |  |
| Route: /leads | All appointments | yes |  |
| Route: /leads | Needs attention | yes |  |
| Route: /leads | List | yes |  |
| Route: /leads | By rep | yes |  |
| Route: /leads | Import CSV | yes |  |
| Route: /leads | Backfill appointments from a CRM export | yes |  |
| Route: /leads | isAdmin | yes |  |
| Route: /leads | SET | yes |  |
| Route: /leads | RUN | yes |  |
| Route: /leads | — none — | yes |  |
| Route: /leads | feed: {name} | yes |  |
| Route: /leads | Ignore | yes |  |
| Route: /leads | Restore | yes |  |
| Route: /leads | Hand back to feed | yes |  |
| Route: /leads | Corrected here, so the CRM feed can no longer change its status, setter or closer. It stil | yes (fuzzy) |  |
| Route: /leads | Added by {who} | yes |  |
| Route: /leads | Refreshed by {who} | yes |  |
| Route: /leads | {who} updated {field} to {value} | yes |  |
| Route: /leads | No changes recorded yet. History starts once migration 043 is in place. | yes |  |
| Route: /leads | Loading history… | yes |  |
| Route: /leads | Import appointments | yes |  |
| Route: /leads | .csv | yes |  |
| Route: /leads | …or paste the CSV contents here | yes |  |
| Route: /leads | ⚠ Missing expected column(s): … | yes (fuzzy) |  |
| Route: /leads | {n} appointment(s) ready | yes (fuzzy) | src/utils/repActivity.js |
| Route: /leads | {n} rep(s) not matched to the roster — those appointments still import, with the name as t | yes (fuzzy) | src/components/SettingsPanel.jsx |
| Route: /leads | Import {n} | yes |  |
| Route: /leads | Import | yes |  |
| Route: /leads | Importing… | yes |  |
| Route: /leads | Cancel | yes |  |
| Route: /leads | Ignore this appointment? | yes |  |
| Route: /leads | Ignore it | yes |  |
| Route: /leads | pickUsers | yes |  |
| Route: /leads | visible = isAdmin ? users : users.filter(u => !u.ghost) | yes |  |
| Route: /myteam | Team revenue bonus tracker | yes |  |
| Route: /myteam | No sales teams have been set up yet. | yes |  |
| Route: /myteam | {Month YYYY} team revenue | yes |  |
| Route: /myteam | Bonus earned | yes |  |
| Route: /myteam | 200k | yes |  |
| Route: /myteam | Top tier reached — max bonus of {$} locked in for {month}. | yes |  |
| Route: /myteam | {$} more in revenue to reach the {$} bonus (at {$}). | yes (fuzzy) |  |
| Route: /myteam | No bonus tiers configured. | yes |  |
| Route: /myteam | Member breakdown | yes |  |
| Route: /myteam | No active team members this month. | yes |  |
| Route: /myteam | Each deal counts once at full revenue, credited to its setter (or the closer when no team  | yes |  |
| Route: /myteam | teams.length > 1 | yes |  |
| Route: /myteam | Previous month | yes |  |
| Route: /myteam | Next month | yes |  |
| Route: /competitions | Competitions | yes |  |
| Route: /competitions | See how you stack up in the contests we're running. | yes |  |
| Route: /competitions | No competitions yet. Click "New" to start one. | yes (fuzzy) | src/components/Layout.jsx |
| Route: /competitions | Check back soon! | yes |  |
| Route: /competitions | No active competitions right now. | yes |  |
| Route: /competitions | Active | yes |  |
| Route: /competitions | Upcoming | yes |  |
| Route: /competitions | Ended | yes |  |
| Route: /competitions | {creditLabel} · Goal {n} · {n} rep(s) excluded | yes (fuzzy) | src/components/CompetitionModal.jsx |
| Route: /competitions | Overall | yes |  |
| Route: /competitions | 🏆 {winner} (set by admin) | yes |  |
| Route: /competitions | · you | yes |  |
| Route: /competitions | 🎉 Earned | yes |  |
| Route: /competitions | · {total} ÷ {n} rep(s) | yes (elsewhere) | src/pages/Payroll.jsx |
| Route: /competitions | {n} deal(s) counted | yes (fuzzy) | src/utils/competition.js |
| Route: /competitions | Counts toward score | yes |  |
| Route: /competitions | Set: … · Closed: … · Sold {d} · Install {d} · excluded: {note} | yes (fuzzy) |  |
| Route: /competitions | Average | yes |  |
| Route: /competitions | Total | yes |  |
| Route: /competitions | No participants yet. | yes |  |
| Route: /competitions | Show top 5 only | yes |  |
| Route: /competitions | Show all {n} | yes |  |
| Route: /competitions | Hide details | yes |  |
| Route: /competitions | Details | yes |  |
| Route: /competitions | Rules | yes |  |
| Route: /competitions | Past competitions ({n}) | yes |  |
| Route: /competitions | 📖 Record Book | yes |  |
| Route: /competitions | All-time bests · completed periods only · since {Month YYYY} | yes |  |
| Route: /competitions | Company records | yes |  |
| Route: /competitions | Biggest Month — Revenue | yes |  |
| Route: /competitions | Biggest Week — Revenue | yes |  |
| Route: /competitions | Biggest Day — Revenue | yes |  |
| Route: /competitions | Most Deals — Month | yes |  |
| Route: /competitions | Most Deals — Week | yes |  |
| Route: /competitions | Most Deals — Day | yes |  |
| Route: /competitions | Rep records | yes |  |
| Route: /competitions | Biggest Rep Month | yes |  |
| Route: /competitions | Biggest Rep Week | yes |  |
| Route: /competitions | Biggest Single Deal | yes |  |
| Route: /competitions | Most Deals — Rep Month | yes |  |
| Route: /competitions | Most Deals — Rep Week | yes |  |
| Route: /competitions | Biggest Rep Day | yes |  |
| Route: /competitions | Team records | yes |  |
| Route: /competitions | Biggest Team Month | yes |  |
| Route: /competitions | Biggest Team Week | yes |  |
| Route: /competitions | Biggest Team Day | yes |  |
| Route: /competitions | Most Deals — Team Month | yes |  |
| Route: /competitions | Most Deals — Team Week | yes |  |
| Route: /competitions | Most Deals — Team Day | yes |  |
| Route: /competitions | 🔥 NEW RECORD — … | yes |  |
| Route: /competitions | 🔥 RECORD WATCH — … | yes |  |
| Route: /competitions | Personal bests in play | yes |  |
| Route: /competitions | Week | yes |  |
| Route: /competitions | Month | yes |  |
| Route: /competitions | Quarter | yes |  |
| Route: /competitions | each rep against their own history · {n} set, {n} closing in | yes |  |
| Route: /competitions | Nobody reached 85% of their own best in {label}. | yes |  |
| Route: /competitions | Export all | yes |  |
| Route: /competitions | Exporting… | yes |  |
| Route: /competitions | Download a PNG of every competition's standings (one per slide) | yes |  |
| Route: /competitions | canManage | yes |  |
| Route: /competitions | New | yes |  |
| Route: /competitions | Copy standings image to clipboard (paste into Canva) | yes |  |
| Route: /competitions | Download standings as an image (PNG) | yes |  |
| Route: /competitions | Edit | yes |  |
| Route: /competitions | Delete | yes |  |
| Route: /competitions | Winner: auto | yes |  |
| Route: /competitions | Winner: {name} | yes |  |
| Route: /competitions | canManage && round ended | gate | src/pages/Competitions.jsx |
| Route: /competitions | canManage && !e.manual | yes |  |
| Route: /competitions | Exclude this deal from every competition (it still pays commission) | yes |  |
| Route: /competitions | Put this deal back into every competition | yes |  |
| Route: /competitions | canManage && onToggleComp | yes |  |
| Route: /competitions | Copy image | yes |  |
| Route: /competitions | Copy table | yes |  |
| Route: /competitions | Copied | yes |  |
| Route: /competitions | Record | yes |  |
| Route: /competitions | Value | yes |  |
| Route: /competitions | Who | yes |  |
| Route: /competitions | When | yes |  |
| Route: /competitions | Right now | yes |  |
| Route: /competitions | Personal bests in play · {label} | yes |  |
| Route: /competitions | record-book.png | yes |  |
| Route: /competitions | Exclude "{deal}" from competitions? | yes |  |
| Route: /competitions | Reason (optional) | yes |  |
| Route: /competitions | e.g. finance docs not signed | yes |  |
| Route: /competitions | Exclude from contests | yes |  |
| Route: /competitions | Delete the competition "{name}"? | yes |  |
| Route: /competitions | Delete competition | yes |  |
| Route: /competitions | canManage = isAdmin | yes |  |
| Route: /competitions | hiddenIds: isAdmin ? null : ghostIds | yes |  |
| Route: /competitions | profileId | yes |  |
| Route: /home | · viewing | yes |  |
| Route: /home | Company Rank | yes |  |
| Route: /home | {$} to pass {name} | yes |  |
| Route: /home | 🏆 You're #1 — leading {name} by {$} | yes (fuzzy) |  |
| Route: /home | Not ranked yet | yes |  |
| Route: /home | Log a sale this month to hit the board, {first}. | yes |  |
| Route: /home | 🔥 Personal best | yes |  |
| Route: /home | {n} weeks | yes |  |
| Route: /home | win streak | yes |  |
| Route: /home | last sale | yes |  |
| Route: /home | Self-gen | yes |  |
| Route: /home | Revenue | yes |  |
| Route: /home | baseline you set · tap | yes |  |
| Route: /home | Closes | yes |  |
| Route: /home | deals you set · tap | yes |  |
| Route: /home | Estimates | yes |  |
| Route: /home | self-gen · tap | yes |  |
| Route: /home | Closing % | yes |  |
| Route: /home | ▲/▼ n pts vs last mo | yes (fuzzy) | src/App.jsx |
| Route: /home | Leads | yes |  |
| Route: /home | Lead Rev | yes |  |
| Route: /home | Leads Closed | yes |  |
| Route: /home | Lead Est | yes |  |
| Route: /home | Commission | yes |  |
| Route: /home | your total earnings · tap | yes |  |
| Route: /home | Avg Deal | yes |  |
| Route: /home | per self-gen deal · tap | yes |  |
| Route: /home | Field activity · RepCard | yes |  |
| Route: /home | repCard.configured === false | gate | src/pages/Home.jsx |
| Route: /home | This week | yes |  |
| Route: /home | This month | yes |  |
| Route: /home | Last month | yes |  |
| Route: /home | 90 days | yes |  |
| Route: /home | Custom | yes |  |
| Route: /home | Doors | yes |  |
| Route: /home | Appts set | yes |  |
| Route: /home | your sales | yes |  |
| Route: /home | Averages · {label} | yes |  |
| Route: /home | Avg doors / day | yes |  |
| Route: /home | Doors / appt | yes |  |
| Route: /home | Appts / close | yes |  |
| Route: /home | Personal bests | yes |  |
| Route: /home | Best Month | yes |  |
| Route: /home | Best Week | yes |  |
| Route: /home | Most Deals / Mo | yes |  |
| Route: /home | Biggest Deal | yes |  |
| Route: /home | {$} this month — a new personal best, and the month isn't over. | yes (fuzzy) | src/utils/records.js |
| Route: /home | … — {$} away from your best month ever. | yes |  |
| Route: /home | Self-gen — deals you set | yes |  |
| Route: /home | Leads — deals you closed for another setter | yes |  |
| Route: /home | Self-gen estimates | yes |  |
| Route: /home | Lead estimates | yes |  |
| Route: /home | Commission — your earnings | yes |  |
| Route: /home | Nothing here for {month}. | yes |  |
| Route: /home | Monthly pace | yes |  |
| Route: /home | {$} of {$} target | yes |  |
| Route: /home | Target = your trailing 3-month average +10%. · Best month: … | yes (fuzzy) |  |
| Route: /home | Your competitions | yes |  |
| Route: /home | View all | yes |  |
| Route: /home | You're not in any active competitions right now. | yes |  |
| Route: /home | 🎉 Earned | yes |  |
| Route: /home | You: | yes |  |
| Route: /home | Your team: | yes |  |
| Route: /home | · target … | yes |  |
| Route: /home | · {gap} to pass {name} | yes |  |
| Route: /home | · 🏆 leading | yes |  |
| Route: /home | My card | yes |  |
| Route: /home | isAdmin | yes |  |
| Route: /home | Share | yes |  |
| Route: /home | Copied | yes |  |
| Route: /home | Saved | yes |  |
| Route: /home | Copy a shareable card image | yes |  |
| Route: /home | isAdmin \|\| !u.ghost | yes |  |
| Route: /home | hiddenIds = isAdmin ? null : ghostIds | yes |  |
| Route: /payroll | Payroll | yes |  |
| Route: /payroll | Review deals due for pay, approve them, and track deductions. | yes |  |
| Route: /payroll | No deals have a pay date yet. Set install dates (which auto-fill pay dates) or run the pay | yes |  |
| Route: /payroll | This pay run is locked | yes |  |
| Route: /payroll | Auto-locked (pay date passed with every deal Paid) | yes |  |
| Route: /payroll | Locked | yes |  |
| Route: /payroll | {date} by {name} · locked total {$} — deals and adjustments on this run are frozen. | yes |  |
| Route: /payroll | {n} admin override(s) on this run ▾/▴ | yes (fuzzy) | src/contexts/AuthContext.jsx |
| Route: /payroll | deal · who · when · changed {keys} | yes (fuzzy) | src/utils/competition.js |
| Route: /payroll | "reason" | yes (fuzzy) | src/main.jsx |
| Route: /payroll | Total payout | yes |  |
| Route: /payroll | Rep payout | yes |  |
| Route: /payroll | incl. ±{$} adjustments · {n} payee(s) | yes (fuzzy) | src/lib/db.js |
| Route: /payroll | Run progress | yes |  |
| Route: /payroll | Nothing on this run | yes |  |
| Route: /payroll | Paid — ready to lock | yes |  |
| Route: /payroll | Approved — ready to pay | yes |  |
| Route: /payroll | Paying | yes |  |
| Route: /payroll | In review | yes |  |
| Route: /payroll | {v}/{t} verified | yes |  |
| Route: /payroll | {f}/{t} approved | yes |  |
| Route: /payroll | {p}/{f} paid | yes |  |
| Route: /payroll | {$} remaining | yes |  |
| Route: /payroll | nothing outstanding | yes |  |
| Route: /payroll | + {$} across {n} deal(s) not yet finalized — excluded from the total until they reach "Pay | yes (fuzzy) |  |
| Route: /payroll | Before you pay — {n} thing(s) to look at | yes (fuzzy) | src/utils/team.js |
| Route: /payroll | none of these block payment | yes |  |
| Route: /payroll | {n} deal(s) | yes |  |
| Route: /payroll | aren't gold-checked yet | yes (fuzzy) | src/components/DealTable.jsx |
| Route: /payroll | have no office — override rates may be wrong | yes (fuzzy) | src/utils/commission.js |
| Route: /payroll | have commission with nobody assigned to pay it to | yes |  |
| Route: /payroll | {$} in deductions owed — {n} of {m} is a rep/are reps getting paid on this run | yes (fuzzy) |  |
| Route: /payroll | on this run · {$} | yes |  |
| Route: /payroll | no pay on this run | yes |  |
| Route: /payroll | logged {date} · {$} already recovered | yes |  |
| Route: /payroll | Everything checks out — all deals verified, offices set, every share assigned, nothing owe | yes |  |
| Route: /payroll | Who gets paid · {n} person/people | yes (fuzzy) | src/components/DealModal.jsx |
| Route: /payroll | Person | yes |  |
| Route: /payroll | Deals | yes |  |
| Route: /payroll | Deal pay | yes |  |
| Route: /payroll | Adjustments | yes |  |
| Route: /payroll | Net pay | yes |  |
| Route: /payroll | Nothing on this run. | yes |  |
| Route: /payroll | Run total | yes |  |
| Route: /payroll | {$} of this run's total reaches nobody — … | yes (fuzzy) |  |
| Route: /payroll | Who | yes |  |
| Route: /payroll | Amount | yes |  |
| Route: /payroll | What for | yes |  |
| Route: /payroll | Paid on {date} and listed with everyone else. … | yes |  |
| Route: /payroll | Deals in this run | yes |  |
| Route: /payroll | Deal | yes |  |
| Route: /payroll | Install | yes |  |
| Route: /payroll | Office | yes |  |
| Route: /payroll | Setter | yes |  |
| Route: /payroll | Closer | yes |  |
| Route: /payroll | Overrides | yes |  |
| Route: /payroll | Baseline | yes |  |
| Route: /payroll | Commission | yes |  |
| Route: /payroll | Status | yes |  |
| Route: /payroll | TBD | yes |  |
| Route: /payroll | Unassigned | yes |  |
| Route: /payroll | self-gen | yes |  |
| Route: /payroll | No office / payment set | yes |  |
| Route: /payroll | Sold | yes |  |
| Route: /payroll | Job price | yes |  |
| Route: /payroll | Rep pool | yes |  |
| Route: /payroll | Pay date | yes |  |
| Route: /payroll | Unassigned · {role} — set the {role} on the deal | yes |  |
| Route: /payroll | No payouts on this deal. | yes |  |
| Route: /payroll | {$} deduction — {label} | yes |  |
| Route: /payroll | No deals in this run. | yes |  |
| Route: /payroll | No deals for the selected rep(s) in this run. | yes |  |
| Route: /payroll | Logged after payout | yes |  |
| Route: /payroll | {$} owed across {n} person/people | yes (fuzzy) | src/components/PeopleChart.jsx |
| Route: /payroll | logged {date} | yes |  |
| Route: /payroll | {$} came out {day} | yes |  |
| Route: /payroll | {$} rolls to their next run | yes |  |
| Route: /payroll | written off — {note} | yes |  |
| Route: /payroll | Outstanding | yes |  |
| Route: /payroll | Partly recovered | yes (elsewhere) | src/utils/deductions.js |
| Route: /payroll | Recovered | yes (elsewhere) | src/utils/deductions.js |
| Route: /payroll | Written off | yes (elsewhere) | src/utils/deductions.js |
| Route: /payroll | Nothing owed — every logged deduction has been recovered or written off. | yes |  |
| Route: /payroll | No deductions logged yet. | yes |  |
| Route: /payroll | Total deductions | yes |  |
| Route: /payroll | {n} total | yes |  |
| Route: /payroll | Pending | yes |  |
| Route: /payroll | {n} not yet paid | yes |  |
| Route: /payroll | Applied | yes |  |
| Route: /payroll | on paid deals | yes |  |
| Route: /payroll | All deductions · present & past | yes (fuzzy) |  |
| Route: /payroll | From {who} · {office} · pays {day} | yes |  |
| Route: /payroll | · pay date TBD | yes |  |
| Route: /payroll | Dealer fee −{$} · other −{$} | yes |  |
| Route: /payroll | Edit | yes |  |
| Route: /payroll | No deductions on any deal. | yes |  |
| Route: /payroll | EEE, MMM d, yyyy | yes |  |
| Route: /payroll | Overdue (unpaid) | yes |  |
| Route: /payroll | No pay dates yet | yes |  |
| Route: /payroll | {n} overdue | yes |  |
| Route: /payroll | Expand all | yes |  |
| Route: /payroll | Collapse all | yes |  |
| Route: /payroll | All | yes |  |
| Route: /payroll | Show | yes |  |
| Route: /payroll | Hide | yes |  |
| Route: /payroll | Log a deduction | yes |  |
| Route: /payroll | isAdmin | yes |  |
| Route: /payroll | Export CSV | yes |  |
| Route: /payroll | Pay run | yes |  |
| Route: /payroll | Deductions ({n}) | yes (fuzzy) |  |
| Route: /payroll | Unlock | yes |  |
| Route: /payroll | {n} admin override(s) on this run | yes (fuzzy) | src/contexts/AuthContext.jsx |
| Route: /payroll | Take from this run | yes |  |
| Route: /payroll | isAdmin && !runLock && !open | yes |  |
| Route: /payroll | Take | yes |  |
| Route: /payroll | Take it | yes |  |
| Route: /payroll | Cancel | yes |  |
| Route: /payroll | leaves {$} owed — carries to the next run | yes |  |
| Route: /payroll | more than the {$} they earn this run — their cheque would go negative | yes |  |
| Route: /payroll | Approve all | yes |  |
| Route: /payroll | canApprove = isAdmin && !runLock && statusLabels.includes('Pay Finalized') | gate | src/pages/Payroll.jsx |
| Route: /payroll | Mark all paid | yes |  |
| Route: /payroll | canPay = isAdmin && statusLabels.includes('Paid') | gate | src/pages/Payroll.jsx |
| Route: /payroll | Add pay | yes |  |
| Route: /payroll | Pick a person… | yes |  |
| Route: /payroll | — already on this run | yes |  |
| Route: /payroll | e.g. Door-knock contest — 2nd place | yes |  |
| Route: /payroll | Add to this run | yes |  |
| Route: /payroll | Adding… | yes |  |
| Route: /payroll | isAdmin && !runLock | yes |  |
| Route: /payroll | Lock run | yes |  |
| Route: /payroll | Add a payroll adjustment (+/−) | yes |  |
| Route: /payroll | ± $ | yes |  |
| Route: /payroll | note (e.g. missed deduction) | yes |  |
| Route: /payroll | isAdmin && view !== 'overdue' && !runLock | yes |  |
| Route: /payroll | Copy this rep's pay statement to email | yes |  |
| Route: /payroll | Undo this recovery — … | yes |  |
| Route: /payroll | Remove adjustment | yes |  |
| Route: /payroll | … — click the name to edit this deal | yes |  |
| Route: /payroll | openEdit | yes |  |
| Route: /payroll | Approve | yes |  |
| Route: /payroll | Move to Pay Finalized | yes (fuzzy) |  |
| Route: /payroll | canApprove && !dealLocked && !isPaid && status !== 'Pay Finalized' | gate | src/pages/Payroll.jsx |
| Route: /payroll | Paid | yes |  |
| Route: /payroll | canPay | yes |  |
| Route: /payroll | Edit deal | yes |  |
| Route: /payroll | + Log a deduction | yes |  |
| Route: /payroll | Reopen — it starts showing on runs again | yes |  |
| Route: /payroll | Write it off | yes |  |
| Route: /payroll | Delete | yes |  |
| Route: /payroll | isAdmin && status !== 'settled' | gate | src/pages/Payroll.jsx |
| Route: /payroll | Deal, Baseline, Paid to, Role, %, Commission $, Note | yes (fuzzy) | src/pages/Commissions.jsx |
| Route: /payroll | Manual adjustments | yes |  |
| Route: /payroll | Net totals per rep | yes |  |
| Route: /payroll | TOTAL | yes |  |
| Route: /payroll | TURF TIME | yes |  |
| Route: /payroll | Pay Statement | yes |  |
| Route: /payroll | Paid to | yes |  |
| Route: /payroll | Deal, Baseline, Role, %, Commission | yes (fuzzy) | src/pages/Commissions.jsx |
| Route: /payroll | Net total | yes |  |
| Route: /payroll | Deductions are already reflected in each line. Questions? Reply to this email. | yes |  |
| Route: /payroll | Take {$} against a balance of only {$}? | yes |  |
| Route: /payroll | Take it anyway | yes |  |
| Route: /payroll | Delete this deduction? | yes |  |
| Route: /payroll | Delete it | yes |  |
| Route: /payroll | Lock the {run} run? | yes |  |
| Route: /payroll | Lock the run | yes |  |
| Route: /payroll | Unlock the {run} run? | yes |  |
| Route: /payroll | Unlock the run | yes |  |
| Route: /payroll | Mark {n} deal(s) as "{status}"? | yes (fuzzy) | src/components/DealTable.jsx |
| Route: /payroll | Mark as {status} | yes |  |
| Route: /payroll | Write off {$} still owed by {name}? | yes |  |
| Route: /payroll | Reason (optional) | yes |  |
| Route: /payroll | e.g. left the company, never another run to take it from | yes |  |
| Route: /payroll | saveDealFields | yes |  |
| Route: /payroll | The {date} pay run is locked — unlock it first to change this deal. | yes |  |
| Route: /payroll | canApprove | yes |  |
| Route: /payroll | statusLabels | yes |  |
| Route: /payroll | Pay Finalized | yes |  |
| Route: /payroll | payUsers | yes |  |
| Route: /import | Import Deals | yes |  |
| Route: /import | Bring deals in from any spreadsheet or CRM — export a CSV, drop it here, map the columns,  | yes |  |
| Route: /import | Import complete | yes |  |
| Route: /import | Created {n} · Skipped {n} · Errors {n} | yes |  |
| Route: /audit | Requires Audit | yes |  |
| Route: /audit | Deals where the stored sheet amounts disagree with the commission rules (by more than $1). | yes |  |
| Route: /audit | Needs review | yes |  |
| Route: /audit | Everything reconciles. No deals need review. | yes |  |
| Route: /audit | Tucson | yes |  |
| Route: /audit | {project_id} · Sale {date} · Baseline {$} | yes |  |
| Route: /audit | Correction history | yes |  |
| Route: /audit | No corrections logged yet. | yes |  |
| Route: /audit | Field | yes |  |
| Route: /audit | Sheet value | yes |  |
| Route: /audit | Calculated | yes |  |
| Route: /audit | Difference | yes |  |
| Route: /audit | billed at 5%, should be 3.75% | yes |  |
| Route: /audit | tucson-rate | yes |  |
| Route: /audit | Deal | yes |  |
| Route: /audit | Sheet → Corrected | yes |  |
| Route: /audit | Note | yes |  |
| Route: /audit | Corrected by | yes |  |
| Route: /audit | When | yes |  |
| Route: /audit | Override & Correct | yes (fuzzy) | src/lib/db.js |
| Route: /goals | Goals | yes |  |
| Route: /goals | Weekly + monthly commitments per rep — click any goal number to type it. Estimate goals ar | yes (fuzzy) |  |
| Route: /goals | No Team | yes |  |
| Route: /goals | Former Team | yes |  |
| Route: /goals | {$} / {$goal} · {n}/{goal} deals this month | yes |  |
| Route: /goals | {n} straight weeks hitting the estimate goal | yes |  |
| Route: /goals | no goals set | yes |  |
| Route: /goals | Leads: {n} ran · {n} closed | yes |  |
| Route: /goals | Click to set a goal | yes |  |
| Route: /goals | No goal set | yes |  |
| Route: /goals | Goal hit | yes |  |
| Route: /goals | On pace | yes |  |
| Route: /goals | Behind pace by … | yes |  |
| Route: /goals | {$}/mo ≈ {n} deals · {n} est ({pct}% close · {$} avg) → {n} est / wk | yes (fuzzy) | src/utils/records.js |
| Route: /goals | Use as targets | yes |  |
| Route: /goals | canEditRep(rep) = isAdmin \\|\\| rep.id === profile.id \\|\\| rep.manager_id === profile.id | gate | src/pages/Goals.jsx |
| Route: /goals | isAdmin \|\| !u.ghost | yes |  |
| Route: /goals | canEditRep | yes |  |
| Route: /admin | System health | yes |  |
| Route: /admin | Scheduler sync | yes |  |
| Route: /admin | Lead feed | yes |  |
| Route: /admin | Watchdog | yes |  |
| Route: /admin | no heartbeat yet — paste the latest ScheduleSync.gs | yes |  |
| Route: /admin | PREVIEW MODE — running but writing nothing (SCH_DRY_RUN=true) · … | yes |  |
| Route: /admin | stalled — last ran … | yes |  |
| Route: /admin | SHEET FORMAT PROBLEM · ran … | yes |  |
| Route: /admin | ran … with n error(s) | yes (fuzzy) | src/App.jsx |
| Route: /admin | ran … | yes |  |
| Route: /admin | not running yet — set up Watchdog.gs | yes |  |
| Route: /admin | {n} issue(s) found · … | yes (fuzzy) |  |
| Route: /admin | all clear · … | yes |  |
| Route: /admin | People | yes |  |
| Route: /admin | Settings | yes |  |
| Route: /admin | Scheduled moves | yes |  |
| Route: /admin | nothing changes until the date — the roster is live as-is | yes |  |
| Route: /admin | {n} upcoming | yes |  |
| Route: /admin | One of these was / {n} of these were due on or before today ({date}) and has/have not been | yes (fuzzy) |  |
| Route: /admin | The site could not run them: {err} | yes |  |
| Route: /admin | Usually the database's own clock has not reached the date yet — Apply now will say which. | yes (fuzzy) |  |
| Route: /admin | due — not applied | yes |  |
| Route: /admin | Team change log | yes |  |
| Route: /admin | sales & overrides attribute to teams by these dates | yes (fuzzy) | src/components/UserModal.jsx |
| Route: /admin | {n} change(s) · show/hide | yes (fuzzy) | src/components/SettingsPanel.jsx |
| Route: /admin | recorded {date} | yes |  |
| Route: /admin | {who} — {from} → {to} · by {name} · {note} · re-dated from {date} | yes |  |
| Route: /admin | Apply now | yes |  |
| Route: /admin | Cancel | yes |  |
| Route: /admin | Change the date this move counts from | yes |  |
| Route: /admin | Undo this move, or remove the entry | yes |  |
| Route: /admin | Remove this entry from the log | yes |  |
| Route: /admin | {name} has {n} direct report(s) | yes (fuzzy) | src/utils/competition.js |
| Route: /admin | Move the reports too | yes |  |
| Route: /admin | Leave them | yes |  |
| Route: /admin | Delete this user? | yes |  |
| Route: /admin | Delete | yes |  |
| Route: /admin | Deactivate {name}? | yes |  |
| Route: /admin | Deactivate | yes |  |
| Route: /admin | Move {name} to {team}? | yes |  |
| Route: /admin | Move them | yes |  |
| Route: /admin | Cancel this scheduled move? | yes |  |
| Route: /admin | Cancel the move | yes |  |
| Route: /admin | Keep it | yes |  |
| Route: /admin | Change this move to {date}? | yes |  |
| Route: /admin | Change the date | yes |  |
| Route: /admin | Remove this log entry? | yes |  |
| Route: /admin | Remove it | yes |  |
| Route: /admin | Create {name}'s login? | yes |  |
| Route: /admin | Email an invite | yes |  |
| Route: /admin | Set a temporary password | yes |  |
| Route: /admin | Reset {name}'s password? | yes |  |
| Route: /admin | Email a reset link | yes |  |
| Route: /admin | Undo the move | yes |  |
| Route: /admin | Remove the entry only | yes |  |
| Route: /admin | Login created for {name} | yes |  |
| Route: /admin | New temporary password for {name} | yes |  |
| Route: /admin | Profile created. To give them a login, open Edit on their row … | yes (fuzzy) |  |
| Component: AuditStrip |  · Reviewed | yes |  |
| Component: AuditStrip | Refresh | yes |  |
| Component: AuditStrip | Re-check every deal against the install sheet + GHL now (otherwise cached for an hour) | yes |  |
| Component: AuditStrip | updated {ago} | yes |  |
| Component: AuditStrip | Running audit… | yes |  |
| Component: AuditStrip | The audit runs on the live site (disabled in demo mode). | yes |  |
| Component: AuditStrip | Audit failed: {err} retry | yes |  |
| Component: AuditStrip | Matched a non-cancelled install booking on the calendar. | yes |  |
| Component: AuditStrip | Site install date: … | yes |  |
| Component: AuditStrip | Payment method: … | yes |  |
| Component: AuditStrip | Setter: … | yes |  |
| Component: AuditStrip | Closer: … | yes |  |
| Component: AuditStrip | Name: … | yes |  |
| Component: AuditStrip | Phone: … | yes |  |
| Component: AuditStrip | Address: … | yes |  |
| Component: AuditStrip | Manager: … | yes |  |
| Component: AuditStrip | Use calendar date | yes |  |
| Component: AuditStrip | Use calendar setter/closer | yes |  |
| Component: AuditStrip | Assign team | yes |  |
| Component: AuditStrip | Fill blanks in GHL | yes |  |
| Component: AuditStrip | canAudit | yes |  |
| Component: CompetitionModal | New Competition | yes |  |
| Component: CompetitionModal | Edit Competition | yes |  |
| Component: CompetitionModal | Name * | yes |  |
| Component: CompetitionModal | e.g. Top Closer — March | yes |  |
| Component: CompetitionModal | Type | yes |  |
| Component: CompetitionModal | Individual | yes |  |
| Component: CompetitionModal | Team | yes |  |
| Component: CompetitionModal | Grouped Teams | yes (elsewhere) | src/utils/competition.js |
| Component: CompetitionModal | Team Average (per rep) | yes (elsewhere) | src/utils/competition.js |
| Component: CompetitionModal | Company-wide | yes |  |
| Component: CompetitionModal | Head-to-head | yes (elsewhere) | src/utils/competition.js |
| Component: CompetitionModal | Metric | yes |  |
| Component: CompetitionModal | Revenue (baseline) | yes (elsewhere) | src/utils/competition.js |
| Component: CompetitionModal | Deals closed | yes (elsewhere) | src/components/SettingsPanel.jsx,src/utils/competition.js |
| Component: CompetitionModal | Start date | yes |  |
| Component: CompetitionModal | End date | yes |  |
| Component: CompetitionModal | Goal | yes |  |
| Component: CompetitionModal | Race — highest score wins | yes (elsewhere) | src/utils/competition.js |
| Component: CompetitionModal | Target — reach a number to earn it | yes (elsewhere) | src/utils/competition.js |
| Component: CompetitionModal | Target (deals) | yes |  |
| Component: CompetitionModal | Target ($ baseline) | yes |  |
| Component: CompetitionModal | Target (avg deals per rep) | yes |  |
| Component: CompetitionModal | Target (avg $ baseline per rep) | yes |  |
| Component: CompetitionModal | e.g. 20 | yes |  |
| Component: CompetitionModal | e.g. 100000 | yes |  |
| Component: CompetitionModal | e.g. 4 | yes |  |
| Component: CompetitionModal | e.g. 25000 | yes |  |
| Component: CompetitionModal | Who gets credit | yes |  |
| Component: CompetitionModal | Setter & closer — both get full credit | yes (elsewhere) | src/utils/competition.js |
| Component: CompetitionModal | Setter only — the rep who generated the lead | yes (elsewhere) | src/utils/competition.js |
| Component: CompetitionModal | Closer only — the rep who closed it | yes (elsewhere) | src/utils/competition.js |
| Component: CompetitionModal | Solo only — one rep both set AND closed it | yes (elsewhere) | src/utils/competition.js |
| Component: CompetitionModal | Split between setter & closer | yes (elsewhere) | src/utils/competition.js |
| Component: CompetitionModal | Setter full credit + closer part on a lead | yes (elsewhere) | src/utils/competition.js |
| Component: CompetitionModal | Setter 100% | yes |  |
| Component: CompetitionModal | Closer {n}% | yes |  |
| Component: CompetitionModal | Setter {n}% | yes |  |
| Component: CompetitionModal | Description | yes |  |
| Component: CompetitionModal | Short summary shown on the card | yes |  |
| Component: CompetitionModal | Rules | yes |  |
| Component: CompetitionModal | How it's scored, the prize, fine print… | yes |  |
| Component: CompetitionModal | Sides — group teams & reps | yes (fuzzy) |  |
| Component: CompetitionModal | Add side | yes |  |
| Component: CompetitionModal | Side name | yes |  |
| Component: CompetitionModal | Remove side | yes |  |
| Component: CompetitionModal | Whole teams | yes |  |
| Component: CompetitionModal | Individual reps ({n} added) | yes |  |
| Component: CompetitionModal | Manual score overrides (optional) | yes |  |
| Component: CompetitionModal | Company-wide automatically includes every rep and manager — no need to pick participants. | yes |  |
| Component: CompetitionModal | Participants | yes |  |
| Component: CompetitionModal | Teams (pick managers) | yes |  |
| Component: CompetitionModal | Teams competing | yes |  |
| Component: CompetitionModal | {n} selected | yes |  |
| Component: CompetitionModal | No people available. | yes |  |
| Component: CompetitionModal | Who counts toward the average | yes |  |
| Component: CompetitionModal | {n} left out | yes |  |
| Component: CompetitionModal | {counted} of {n} count | yes |  |
| Component: CompetitionModal | · deactivated | yes |  |
| Component: CompetitionModal | Also left out (not on a picked team) | yes |  |
| Component: CompetitionModal | dropped on save | yes |  |
| Component: CompetitionModal | Rounds (optional) | yes |  |
| Component: CompetitionModal | Auto-split into weeks | yes |  |
| Component: CompetitionModal | Add round | yes |  |
| Component: CompetitionModal | Round name | yes |  |
| Component: CompetitionModal | Prize (e.g. $250) | yes |  |
| Component: CompetitionModal | Remove round | yes |  |
| Component: CompetitionModal | Create competition | yes |  |
| Component: CompetitionModal | Save changes | yes |  |
| Component: CompetitionModal | Saving… | yes |  |
| Component: CompetitionModal | Cancel | yes |  |
| Component: DateRangeFilter | This Week | yes |  |
| Component: DateRangeFilter | Last Week | yes (elsewhere) | src/pages/Leads.jsx,src/utils/dateRanges.js |
| Component: DateRangeFilter | MTD | yes |  |
| Component: DateRangeFilter | Last Month | yes (elsewhere) | src/utils/dateRanges.js |
| Component: DateRangeFilter | This Quarter | yes (elsewhere) | src/utils/dateRanges.js |
| Component: DateRangeFilter | Last Quarter | yes (elsewhere) | src/utils/dateRanges.js |
| Component: DateRangeFilter | YTD | yes (elsewhere) | src/utils/dateRanges.js |
| Component: DateRangeFilter | All Time | yes (elsewhere) | src/utils/dateRanges.js |
| Component: DateRangeFilter | Custom | yes |  |
| Component: DateRangeFilter | Clear | yes |  |
| Component: DateRangeFilter | showCustom | yes |  |
| Component: DealModal | New Deal | yes |  |
| Component: DealModal | Edit Deal | yes |  |
| Component: DealModal | Status | yes |  |
| Component: DealModal | Sale Date * | yes |  |
| Component: DealModal | Install Date | yes |  |
| Component: DealModal | Pay Date | yes |  |
| Component: DealModal | Office | yes |  |
| Component: DealModal | Select office… | yes |  |
| Component: DealModal | Payment Method | yes |  |
| Component: DealModal | Select method… | yes |  |
| Component: DealModal | useSettings().paymentMethods | gate | src/contexts/SettingsContext.jsx |
| Component: DealModal | Project ID | yes |  |
| Component: DealModal | SPX-1234 | yes |  |
| Component: DealModal | Setter * | yes |  |
| Component: DealModal | Closer * | yes |  |
| Component: DealModal | Type to search setter… | yes |  |
| Component: DealModal | Type to search closer… | yes |  |
| Component: DealModal | No one matches "{q}". | yes (fuzzy) | src/utils/commission.js |
| Component: DealModal | Commission Split | yes |  |
| Component: DealModal | Setter {n}% | yes |  |
| Component: DealModal | Closer {n}% | yes |  |
| Component: DealModal | Setter $ | yes |  |
| Component: DealModal | Closer $ | yes |  |
| Component: DealModal | Type either $ amount — the other rep gets the rest of the {$} rep pool and the split % upd | yes |  |
| Component: DealModal | Baseline Revenue ($) * | yes |  |
| Component: DealModal | 5000 | yes |  |
| Component: DealModal | Job Price ($) * | yes |  |
| Component: DealModal | 9000 | yes |  |
| Component: DealModal | Commission Preview | yes |  |
| Component: DealModal | Gross Comm | yes |  |
| Component: DealModal | Setter ({n}%) | yes |  |
| Component: DealModal | Closer ({n}%) | yes |  |
| Component: DealModal | Rep Comm % | yes |  |
| Component: DealModal | Overrides | yes |  |
| Component: DealModal | Gross {$} | yes |  |
| Component: DealModal | Mgr Override | yes (fuzzy) | src/contexts/SettingsContext.jsx |
| Component: DealModal | Dir Override | yes (fuzzy) | src/contexts/SettingsContext.jsx |
| Component: DealModal | VP Override | yes (fuzzy) | src/contexts/SettingsContext.jsx |
| Component: DealModal | Deduction | yes |  |
| Component: DealModal | Amount ($) | yes |  |
| Component: DealModal | Description | yes |  |
| Component: DealModal | What is this deduction for? | yes |  |
| Component: DealModal | Dealer Fee | yes |  |
| Component: DealModal | Financed amount ($) | yes |  |
| Component: DealModal | Dealer fee % | yes |  |
| Component: DealModal | Dealer fee | yes |  |
| Component: DealModal | Who pays the deduction? | yes |  |
| Component: DealModal | Split | yes |  |
| Component: DealModal | Override Chain | yes |  |
| Component: DealModal | Manager | yes |  |
| Component: DealModal | Director | yes |  |
| Component: DealModal | None | yes |  |
| Component: DealModal | Override % | yes |  |
| Component: DealModal | −{$} bonus → nets {$} ({pct}%) | yes |  |
| Component: DealModal | Override Exclusions · subcontracted items, no override on these | yes (fuzzy) |  |
| Component: DealModal | Select item… | yes |  |
| Component: DealModal | useSettings().overrideExclusionItems | gate | src/contexts/SettingsContext.jsx |
| Component: DealModal | Price $ | yes |  |
| Component: DealModal | Remove item | yes |  |
| Component: DealModal | + Add excluded item | yes |  |
| Component: DealModal | Override base: … (baseline … − … excluded) · effective: … | yes (fuzzy) | src/utils/commission.js |
| Component: DealModal | Rep Bonus · optional, chip in from anyone | yes (fuzzy) |  |
| Component: DealModal | Enter as | yes |  |
| Component: DealModal | $ amount | yes |  |
| Component: DealModal | % of baseline | yes |  |
| Component: DealModal | Bonus to | yes |  |
| Component: DealModal | Split between both | yes |  |
| Component: DealModal | Company | yes |  |
| Component: DealModal | an extra on top, from nobody | yes |  |
| Component: DealModal | no one assigned | yes |  |
| Component: DealModal | override {$} → {$} ({pct}%) | yes |  |
| Component: DealModal | · only has {$}; capped | yes |  |
| Component: DealModal | Total bonus … | yes |  |
| Component: DealModal | Total mgmt override: … → … (−…) | yes (fuzzy) |  |
| Component: DealModal | Edit history | yes |  |
| Component: DealModal | Loading… | yes |  |
| Component: DealModal | No history yet. (Changes are recorded once migration 019 is run.) | yes |  |
| Component: DealModal | Deal created | yes |  |
| Component: DealModal | Create Deal | yes |  |
| Component: DealModal | Save Changes | yes |  |
| Component: DealModal | Saving… | yes |  |
| Component: DealModal | Cancel | yes |  |
| Component: DealTable | Deal | yes |  |
| Component: DealTable | Notes | yes |  |
| Component: DealTable | Canceled | yes |  |
| Component: DealTable | Hidden — counts toward nothing (revenue, payroll, leaderboards, competitions) | yes |  |
| Component: DealTable | Possible duplicate — … | yes |  |
| Component: DealTable | Office | yes |  |
| Component: DealTable | All offices | yes |  |
| Component: DealTable | + office | yes (elsewhere) | src/pages/Dashboard.jsx |
| Component: DealTable | Payment | yes |  |
| Component: DealTable | All payments | yes |  |
| Component: DealTable | + payment | yes (fuzzy) | src/contexts/SettingsContext.jsx |
| Component: DealTable | Status | yes |  |
| Component: DealTable | All statuses | yes |  |
| Component: DealTable | Change status | yes |  |
| Component: DealTable | People | yes |  |
| Component: DealTable | Set {name} | yes |  |
| Component: DealTable | Cls {name} | yes |  |
| Component: DealTable | Dates | yes |  |
| Component: DealTable | Sale | yes |  |
| Component: DealTable | Inst | yes |  |
| Component: DealTable | Pay | yes |  |
| Component: DealTable | Clear {label} date | yes |  |
| Component: DealTable | — missing | yes |  |
| Component: DealTable | Revenue | yes |  |
| Component: DealTable | base {baseline} | yes |  |
| Component: DealTable | Commission | yes |  |
| Component: DealTable | Commission checked | yes |  |
| Component: DealTable | Commission checked — click to unmark | yes |  |
| Component: DealTable | Mark commission as checked | yes |  |
| Component: DealTable | View deduction reason | yes |  |
| Component: DealTable | Deduction · {$} | yes |  |
| Component: DealTable | No description provided. | yes |  |
| Component: DealTable | Actions | yes |  |
| Component: DealTable | Re-run audit | yes |  |
| Component: DealTable | Hide — keep the record but count it toward nothing | yes |  |
| Component: DealTable | Un-hide — this job counts again everywhere | yes |  |
| Component: DealTable | onToggleHidden | yes |  |
| Component: DealTable | Notes — {deal_name} | yes |  |
| Component: DeductionModal | Log a deduction | yes |  |
| Component: DeductionModal | Edit deduction | yes |  |
| Component: DeductionModal | Records what is owed. It never changes the deal's own numbers or a run that has already go | yes (fuzzy) |  |
| Component: DeductionModal | Which job? | yes |  |
| Component: DeductionModal | {$} baseline · sold {d} · installed {d} · {status} | yes |  |
| Component: DeductionModal | Change | yes |  |
| Component: DeductionModal | Search every deal by customer name… | yes |  |
| Component: DeductionModal | Leave blank if it isn't tied to a job — a tool, an advance, a uniform. | yes (fuzzy) |  |
| Component: DeductionModal | Amount owed | yes |  |
| Component: DeductionModal | Who absorbs it | yes |  |
| Component: DeductionModal | earned {$} | yes |  |
| Component: DeductionModal | {MMM d} pay {$} · {$} pending | yes |  |
| Component: DeductionModal | Split | yes |  |
| Component: DeductionModal | Pick a person… | yes |  |
| Component: DeductionModal | {a} owes {$} · {b} owes {$} — two separate balances, each coming off that rep's own next c | yes (fuzzy) |  |
| Component: DeductionModal | Pre-picked from how this deal already splits deductions. | yes |  |
| Component: DeductionModal | {name} is {$} short … on {date} — it waits, then comes out across however many runs it tak | yes (fuzzy) |  |
| Component: DeductionModal | — "Hold until they have pay" takes what fits and carries the rest. | yes (fuzzy) |  |
| Component: DeductionModal | What was it | yes |  |
| Component: DeductionModal | e.g. turf seam repair — office email 9/18 | yes |  |
| Component: DeductionModal | This is what the rep reads on their pay statement, so write it for them. | yes |  |
| Component: DeductionModal | When does it come out | yes |  |
| Component: DeductionModal | Hold until they have pay | yes |  |
| Component: DeductionModal | Waits in the Payroll tray and follows them run to run. Nothing to remember. | yes |  |
| Component: DeductionModal | Take it on this run — {date} | yes |  |
| Component: DeductionModal | Comes out now, in full. | yes |  |
| Component: DeductionModal | A run I pick | yes |  |
| Component: DeductionModal | When you already know which cheque it belongs on. | yes |  |
| Component: DeductionModal | No pay runs yet | yes |  |
| Component: DeductionModal | Cancel | yes |  |
| Component: DeductionModal | Log deduction | yes |  |
| Component: DeductionModal | Save changes | yes |  |
| Component: DeductionModal | Saving… | yes |  |
| Component: DialogHost | Required. | yes |  |
| Component: DialogHost | Copy | yes |  |
| Component: DialogHost | Copied | yes |  |
| Component: DialogHost |  · recommended | yes |  |
| Component: FilterBar | Which date the range applies to | yes |  |
| Component: FilterBar | Closing date | yes (elsewhere) | src/components/DealTable.jsx,src/pages/Commissions.jsx |
| Component: FilterBar | Install date | yes (elsewhere) | src/components/DealModal.jsx,src/components/DealTable.jsx,src/utils/dealAudit7.js |
| Component: FilterBar | Pay date | yes (elsewhere) | src/components/DealModal.jsx,src/components/DealTable.jsx,src/components/SettingsPanel.jsx,src/pages/Commissions.jsx,src/pages/Payroll.jsx |
| Component: FilterBar | Whose deals to show | yes |  |
| Component: FilterBar | scopeOptions.length > 1 | yes |  |
| Component: FilterBar | Search deal, address, ID… | yes |  |
| Component: FilterBar | Clear search | yes |  |
| Component: FilterBar | All Reps | yes (elsewhere) | src/components/RepMultiSelect.jsx |
| Component: FilterBar | All Statuses | yes |  |
| Component: FilterBar | All Offices | yes |  |
| Component: FilterBar | All Payments | yes |  |
| Component: FilterBar | useSettings().paymentMethods | gate | src/contexts/SettingsContext.jsx |
| Component: FilterBar | Filtered by | yes |  |
| Component: FilterBar | Rep: {name} | yes |  |
| Component: FilterBar | Status: {x} | yes |  |
| Component: FilterBar | Office: {x} | yes |  |
| Component: FilterBar | Payment: {x} | yes |  |
| Component: FilterBar | Clear all | yes |  |
| Component: ManagerBackfillModal | Backfill manager on past deals | yes |  |
| Component: ManagerBackfillModal | {rep} → {manager}. Tick the deals that should get {manager} as manager. Nothing changes un | yes |  |
| Component: ManagerBackfillModal | Loading… | yes |  |
| Component: ManagerBackfillModal | No past deals without a manager — nothing to backfill. | yes |  |
| Component: ManagerBackfillModal | {n} selected · {$} in overrides | yes |  |
| Component: ManagerBackfillModal | Skip | yes |  |
| Component: ManagerBackfillModal | Backfill {n} | yes |  |
| Component: ManagerBackfillModal | Saving… | yes |  |
| Component: NavBar | TITLES[pathname] ?? 'Turf Time' | yes |  |
| Component: NavBar | Notifications | yes |  |
| Component: NavBar | Nothing yet — you'll see deal-note replies here. | yes |  |
| Component: NavBar | {ago} ago · tap to open the thread | yes |  |
| Component: NavBar | View site as | yes |  |
| Component: NavBar | Rep view | yes |  |
| Component: NavBar | Manager view | yes |  |
| Component: NavBar | isAdmin | yes |  |
| Component: NavBar | Preview as User | yes |  |
| Component: NavBar | Change Password | yes |  |
| Component: NavBar | New password | yes |  |
| Component: NavBar | Confirm new password | yes |  |
| Component: NavBar | Update password | yes |  |
| Component: NavBar | Saving… | yes |  |
| Component: NavBar | At least 8 characters. | yes |  |
| Component: NavBar | Passwords don't match. | CHECK | 2/3 words in src/utils/competition.js |
| Component: NavBar | Password updated. | yes |  |
| Component: NavBar | !demoMode | yes |  |
| Component: NavBar | Sign Out | yes |  |
| Component: Notices | Your session expired — data may not load or save until you sign in again. | yes |  |
| Component: Notices | Sign in again | yes |  |
| Component: PeopleChart | Search name or email… | yes |  |
| Component: PeopleChart | {n} people · {n} team(s) | yes (fuzzy) | src/contexts/SettingsContext.jsx |
| Component: PeopleChart | Deactivated · {n} | yes |  |
| Component: PeopleChart | Move people | yes |  |
| Component: PeopleChart | Add person | yes |  |
| Component: PeopleChart | Deactivated | yes |  |
| Component: PeopleChart | Leadership | yes |  |
| Component: PeopleChart | Teams | yes |  |
| Component: PeopleChart | {head}'s Team | yes |  |
| Component: PeopleChart | Rename team | yes |  |
| Component: PeopleChart | Name this team | yes |  |
| Component: PeopleChart | Expand | yes |  |
| Component: PeopleChart | Collapse | yes |  |
| Component: PeopleChart | Unassigned | yes |  |
| Component: PeopleChart | no team lead — drag them to a team | yes |  |
| Component: PeopleChart | Everyone has a team. | yes |  |
| Component: PeopleChart | No reps yet — drag someone here. | yes |  |
| Component: PeopleChart | Drop to move to {name} | yes |  |
| Component: PeopleChart | Drag a rep onto another team for a quick one-off move — effective today, … For a reorg use | yes (fuzzy) |  |
| Component: PeopleChart | no login | yes |  |
| Component: PeopleChart | since {date} | yes |  |
| Component: PeopleChart | Move to… | yes |  |
| Component: PeopleChart | Reset their password | yes |  |
| Component: PeopleChart | No login yet — create one | yes |  |
| Component: PeopleChart | Edit | yes |  |
| Component: PeopleChart | Deactivate — cuts their login, keeps all their deals and stats | yes |  |
| Component: PeopleChart | Delete from the roster — only for a row created by mistake | yes |  |
| Component: PeopleChart | hasUserAdmin | yes |  |
| Component: PeopleChart | Their deals and stats still count everywhere. Reactivate restores login + site access. | yes |  |
| Component: PeopleChart | was on {team} | yes |  |
| Component: PeopleChart | no team | yes |  |
| Component: PeopleChart | Reactivate | yes |  |
| Component: RepActivityTable | Nobody has appointments or deals in this range. | yes |  |
| Component: RepActivityTable | Rep | yes |  |
| Component: RepActivityTable | Set | yes |  |
| Component: RepActivityTable | they booked it | yes |  |
| Component: RepActivityTable | Ran | yes |  |
| Component: RepActivityTable | of those | yes |  |
| Component: RepActivityTable | Closed | yes |  |
| Component: RepActivityTable | Leads Ran | yes |  |
| Component: RepActivityTable | another rep's | yes |  |
| Component: RepActivityTable | Leads Closed | yes |  |
| Component: RepActivityTable | Date | yes |  |
| Component: RepActivityTable | Customer | yes |  |
| Component: RepActivityTable | Role | yes |  |
| Component: RepActivityTable | Self-Gen | yes |  |
| Component: RepActivityTable | Closer | yes |  |
| Component: RepActivityTable | Setter | yes |  |
| Component: RepActivityTable | RepCard outcome | yes |  |
| Component: RepActivityTable | not recorded | yes |  |
| Component: RepActivityTable | No appointments in this range. | yes |  |
| Component: RepActivityTable | Column totals | yes |  |
| Component: RepActivityTable | {n} appointments | yes |  |
| Component: RepActivityTable | {n} deals | yes |  |
| Component: RepActivityTable | {pct} close rate | yes |  |
| Component: RepActivityTable | Counted once each. … | yes |  |
| Component: RepMultiSelect | All Reps | yes |  |
| Component: RepMultiSelect | Clear reps | yes |  |
| Component: RepMultiSelect | Search reps… | yes |  |
| Component: RepMultiSelect | All reps | yes |  |
| Component: RepMultiSelect | No one matches "{q}". | yes (fuzzy) | src/utils/commission.js |
| Component: RepMultiSelect | {n} selected | yes |  |
| Component: RepMultiSelect | Clear | yes |  |
| Component: SettingsPanel | Logo | yes |  |
| Component: SettingsPanel | default mark | yes |  |
| Component: SettingsPanel | Upload logo | yes |  |
| Component: SettingsPanel | Replace logo | yes |  |
| Component: SettingsPanel | Remove | yes |  |
| Component: SettingsPanel | Make white background transparent (applied on upload — re-upload to change) | yes (fuzzy) |  |
| Component: SettingsPanel | Saving… | yes |  |
| Component: SettingsPanel | Saved — live everywhere now | yes |  |
| Component: SettingsPanel | Site Name | yes |  |
| Component: SettingsPanel | Turf Time Dashboard | yes |  |
| Component: SettingsPanel | Deal Statuses | yes |  |
| Component: SettingsPanel | Status name | yes |  |
| Component: SettingsPanel | Add status | yes |  |
| Component: SettingsPanel | Payment Methods | yes |  |
| Component: SettingsPanel | e.g. Self-Pay + Goodleap | yes |  |
| Component: SettingsPanel | Add option | yes |  |
| Component: SettingsPanel | None yet — add one below. | yes |  |
| Component: SettingsPanel | Offices | yes |  |
| Component: SettingsPanel | e.g. Phoenix | yes |  |
| Component: SettingsPanel | Override Rates | yes |  |
| Component: SettingsPanel | Effective from | yes |  |
| Component: SettingsPanel | Manager % | yes |  |
| Component: SettingsPanel | Dir/VP % · {office} | yes |  |
| Component: SettingsPanel | Dir/VP % · other | yes |  |
| Component: SettingsPanel | Remove this rate era | yes |  |
| Component: SettingsPanel | Add a rate change | yes |  |
| Component: SettingsPanel | Pay Date Rule | yes |  |
| Component: SettingsPanel | Pay day | yes |  |
| Component: SettingsPanel | Monday | yes |  |
| Component: SettingsPanel | Sunday | yes |  |
| Component: SettingsPanel | Weeks after install week | yes |  |
| Component: SettingsPanel | Rule: {day} of … | yes |  |
| Component: SettingsPanel | Deal Note Notifications | yes |  |
| Component: SettingsPanel | Closer | yes |  |
| Component: SettingsPanel | the deal's closer | yes |  |
| Component: SettingsPanel | Setter | yes |  |
| Component: SettingsPanel | Manager | yes |  |
| Component: SettingsPanel | Admins | yes |  |
| Component: SettingsPanel | every admin | yes |  |
| Component: SettingsPanel | Lead Feed (CRM Webhook) | yes |  |
| Component: SettingsPanel | Webhook URL · POST | yes |  |
| Component: SettingsPanel | Copy | yes |  |
| Component: SettingsPanel | Last received | yes |  |
| Component: SettingsPanel | Copy payload | yes |  |
| Component: SettingsPanel | Last result | yes |  |
| Component: SettingsPanel | Field mapping | yes |  |
| Component: SettingsPanel | Appointment ID | yes |  |
| Component: SettingsPanel | Customer Name | yes |  |
| Component: SettingsPanel | Appointment Date/Time | yes |  |
| Component: SettingsPanel | Status / Disposition | yes |  |
| Component: SettingsPanel | Setter Email | yes |  |
| Component: SettingsPanel | Closer Email | yes |  |
| Component: SettingsPanel | Setter Name | yes |  |
| Component: SettingsPanel | Closer Name | yes |  |
| Component: SettingsPanel | Address | yes |  |
| Component: SettingsPanel | Phone | yes |  |
| Component: SettingsPanel | Customer Email | yes |  |
| Component: SettingsPanel | Office | yes |  |
| Component: SettingsPanel | Notes | yes |  |
| Component: SettingsPanel | Their dispositions → our lifecycle | yes |  |
| Component: SettingsPanel | — auto-detect — | yes |  |
| Component: SettingsPanel | Scheduled — on the calendar | yes |  |
| Component: SettingsPanel | Ran — counts as an estimate | yes |  |
| Component: SettingsPanel | Sold — ran and closed | yes |  |
| Component: SettingsPanel | No Show | yes |  |
| Component: SettingsPanel | Canceled | yes |  |
| Component: SettingsPanel | Add a disposition you use… | yes |  |
| Component: SettingsPanel | Add | yes |  |
| Component: SettingsPanel | Field Activity Feed (Door Knocks — recorded, not shown) | yes |  |
| Component: SettingsPanel | Rep Email | yes |  |
| Component: SettingsPanel | Rep Name | yes |  |
| Component: SettingsPanel | Date | yes |  |
| Component: SettingsPanel | Doors Knocked | yes |  |
| Component: SettingsPanel | Knock Time | yes |  |
| Component: SettingsPanel | Is a Knock? | yes |  |
| Component: SettingsPanel | Event / Row ID | yes |  |
| Component: SettingsPanel | Feed: Not Field Reps | yes |  |
| Component: SettingsPanel | e.g. Josh Hilton | yes |  |
| Component: SettingsPanel | Override Exclusion Items | yes |  |
| Component: SettingsPanel | e.g. Electrical | yes |  |
| Component: SettingsPanel | Sync: Excluded Reps | yes |  |
| Component: SettingsPanel | e.g. Rhett | yes |  |
| Component: SettingsPanel | Sync: Skip Deal Names | yes |  |
| Component: SettingsPanel | e.g. test | yes |  |
| Component: SettingsPanel | Estimates From Leads — Start Date | yes |  |
| Component: SettingsPanel | Dashboard: Red-Flag Floors | yes |  |
| Component: SettingsPanel | Appointments set | yes |  |
| Component: SettingsPanel | Default team for unassigned | yes |  |
| Component: SettingsPanel | Keep a separate "Unassigned" row | yes |  |
| Component: SettingsPanel | Data Start Date | yes |  |
| Component: SettingsPanel | 2026-06-01 | yes |  |
| Component: TeamMoveModal | Move people | yes |  |
| Component: TeamMoveModal | Past sales stay with the old team — you choose the day it changes over. | yes |  |
| Component: TeamMoveModal | Who's moving · {n} selected | yes |  |
| Component: TeamMoveModal | Search the roster… | yes |  |
| Component: TeamMoveModal | Nobody matches. | yes |  |
| Component: TeamMoveModal | {names} lead(s) {teams} | yes (fuzzy) | src/App.jsx |
| Component: TeamMoveModal | Moving a lead here makes them a rep on {dest}, so that team is dissolved. … use Edit inste | yes (fuzzy) |  |
| Component: TeamMoveModal | Its rep goes to | yes |  |
| Component: TeamMoveModal | Its {n} reps go to | yes |  |
| Component: TeamMoveModal | {dest} — same as their lead | yes |  |
| Component: TeamMoveModal | The same team as their lead | yes |  |
| Component: TeamMoveModal | Unassigned — no team lead | yes |  |
| Component: TeamMoveModal | Their report goes to | yes |  |
| Component: TeamMoveModal | Their {n} reports go to | yes |  |
| Component: TeamMoveModal | The same team as whoever is moving | yes |  |
| Component: TeamMoveModal | Moving to | yes |  |
| Component: TeamMoveModal | Choose a team… | yes |  |
| Component: TeamMoveModal | Effective from | yes |  |
| Component: TeamMoveModal | Today | yes |  |
| Component: TeamMoveModal | Tomorrow | yes |  |
| Component: TeamMoveModal | 1st of this month | yes |  |
| Component: TeamMoveModal | 1st of next month | yes |  |
| Component: TeamMoveModal | This is in the future, so it gets scheduled. … | yes (fuzzy) |  |
| Component: TeamMoveModal | What this changes | yes |  |
| Component: TeamMoveModal | Pick who's moving and where, and this will say exactly how many deals change hands. | yes |  |
| Component: TeamMoveModal | Checking the deals… | yes |  |
| Component: TeamMoveModal | Deals moving to {dest} | yes |  |
| Component: TeamMoveModal | Deals staying where they are | yes |  |
| Component: TeamMoveModal | Closing on {date} itself | yes |  |
| Component: TeamMoveModal | {lead} stops leading a team | yes |  |
| Component: TeamMoveModal | {n} rep(s) → {dest} | CHECK | 0/0 words in  |
| Component: TeamMoveModal | no reps to reassign | yes |  |
| Component: TeamMoveModal | On the boundary — these go to {dest}. Push the date to {d+1} and they stay put. | yes |  |
| Component: TeamMoveModal | +{n} more | yes |  |
| Component: TeamMoveModal | {n} moving · {n} staying | yes |  |
| Component: TeamMoveModal | Why (optional) | yes |  |
| Component: TeamMoveModal | e.g. Q4 reorg — Jared's team split | yes |  |
| Component: TeamMoveModal | Shows on the change log beside the dates. | yes |  |
| Component: TeamMoveModal | {n} of the {m} selected is/are already on {dest} — they will be left alone … | yes (fuzzy) |  |
| Component: TeamMoveModal | Pick who's moving. | yes |  |
| Component: TeamMoveModal | Choose a team to move them to. | yes |  |
| Component: TeamMoveModal | Pick the day it takes effect. | yes |  |
| Component: TeamMoveModal | They are already on {dest}, so there is nothing to move. | yes |  |
| Component: TeamMoveModal | Open the change log | yes |  |
| Component: TeamMoveModal | Cancel | yes |  |
| Component: TeamMoveModal | Move {n} person/people | yes (fuzzy) | src/utils/scorecard.js |
| Component: TeamMoveModal | Schedule {n} for {date} | yes |  |
| Component: UserModal | Add User | yes |  |
| Component: UserModal | Edit User | yes |  |
| Component: UserModal | Full Name * | yes |  |
| Component: UserModal | Jane Smith | yes |  |
| Component: UserModal | Email * | yes |  |
| Component: UserModal | jane@company.com | yes |  |
| Component: UserModal | Password * | yes |  |
| Component: UserModal | •••••••• | yes |  |
| Component: UserModal | Role * | yes |  |
| Component: UserModal | Company | yes |  |
| Component: UserModal | Turf Time | yes |  |
| Component: UserModal | Site Access | yes |  |
| Component: UserModal | Admin access — on/off | yes (fuzzy) | src/contexts/AuthContext.jsx |
| Component: UserModal | Full site/admin powers, independent of sales title. | yes |  |
| Component: UserModal | Visibility | yes |  |
| Component: UserModal | Ghost — on/off | yes (fuzzy) | src/utils/records.js |
| Component: UserModal | Deals still count in all totals, but the name is hidden from non-admins on leaderboards, c | yes (fuzzy) |  |
| Component: UserModal | Reports To | yes |  |
| Component: UserModal | None | yes |  |
| Component: UserModal | Assigned Director | yes |  |
| Component: UserModal | Assigned VP | yes |  |
| Component: UserModal | Login Password | yes |  |
| Component: UserModal | Type a password (min 8 chars) | yes |  |
| Component: UserModal | Set password | yes |  |
| Component: UserModal | Create login | yes |  |
| Component: UserModal | Saving… | yes |  |
| Component: UserModal | Set SUPABASE_SERVICE_KEY on the site service to manage passwords here, or use Supabase Stu | yes (fuzzy) |  |
| Component: UserModal | pwConfigured = userAdminConfigured() | yes |  |
| Component: UserModal | Team History | yes |  |
| Component: UserModal | No team moves recorded — reporting to {x} since before the change log began. | yes |  |
| Component: UserModal | Now: reports to {x} · since {date} | yes (fuzzy) | src/components/TeamMoveModal.jsx |
| Component: UserModal | Create User | yes |  |
| Component: UserModal | Save Changes | yes |  |
| Component: UserModal | Cancel | yes |  |

## Totals

- yes: 1197
- yes (fuzzy): 98
- gate: 13
- yes (elsewhere): 47
- CHECK: 3

Hand-resolved CHECK items: "e.g. Tanner’s job, came in under Keaton’s ArcSite login" is in src/pages/Deals.jsx (curly apostrophes); "Passwords don’t match." is in src/components/NavBar.jsx line 130 (curly apostrophe); "{n} rep(s) → {dest}" is the TeamMoveModal preview row. Nothing from the inventory is missing.
