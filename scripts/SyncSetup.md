# Google Sheet → Supabase Sync — Setup

This Apps Script reads the `April '26` and `May '26` tabs from your sales tracker sheet and upserts each deal to the dashboard's Supabase database every 5 minutes.

## What it does

- Reads each configured tab row by row
- Maps sheet columns to dashboard fields
- Looks up reps/managers by name → gets their profile UUID
- Auto-fills Garrison as Director and Keaton as VP on every deal
- Skips Cancelled deals
- Reads dollar amounts directly from the sheet (so manual bonuses flow through)
- Matches existing deals by Lead Name → updates them; otherwise inserts new

## Prerequisites

- Supabase running on Railway (Steps 1–4 of `SETUP.md`)
- Your `SUPABASE_URL` (the Kong public URL)
- Your `SUPABASE_SERVICE_KEY` (the **service_role** key, NOT the anon key — service_role bypasses RLS so the script can write any deal)

## Install

1. Open the sales tracker Google Sheet
2. **Extensions → Apps Script** — opens the script editor in a new tab
3. Delete the default `Code.gs` content and paste in the contents of `Sync.gs`
4. Click the disk icon to save (name the project anything, e.g. "Turf Time Sync")

## Configure secrets

Apps Script "Script Properties" is where secrets live. They aren't visible to anyone reading the script.

1. In the script editor: **Project Settings** (the gear icon on the left sidebar)
2. Scroll to **Script Properties** → **Add script property**
3. Add two properties:
   - **Property:** `SUPABASE_URL`  → **Value:** your Kong URL (e.g. `https://kong-production.up.railway.app`) — no trailing slash
   - **Property:** `SUPABASE_SERVICE_KEY` → **Value:** your service_role key
4. Save

## First run (authorize)

1. In the editor, select `testFetchProfiles` from the function dropdown at the top
2. Click **Run**
3. Google asks you to authorize — review and approve (you're authorizing your own script to read the sheet and make outbound HTTPS calls)
4. Open **Executions** (clock icon, left sidebar) — click the latest run → confirm you see all your roster names listed

If `testFetchProfiles` works, the connection is solid. Now run `syncAll` once manually to do a real sync. Check **Executions** again — it'll show how many were synced/skipped/errored.

## Set the time trigger

1. In the script editor: **Triggers** (clock icon)
2. **Add Trigger** (bottom-right)
3. Configure:
   - Function: `syncAll`
   - Deployment: Head
   - Event source: **Time-driven**
   - Type: **Minutes timer**
   - Interval: **Every 5 minutes**
   - Failure notification: Notify me daily (or weekly)
4. Save

The sync now runs every 5 minutes automatically.

## Sanity-check checklist after first sync

Open Supabase Studio → Table Editor → `deals` and verify:

- [ ] Roughly the right number of rows (April had 75 minus 5 cancelled = 70, May had 22 minus 3 blanks = 19, so ~89 total)
- [ ] `setter_id`, `closer_id`, `manager_id`, `director_id`, `vp_id` are populated (not null) where expected
- [ ] `setter_amount`, `closer_amount`, `manager_amount`, `director_amount`, `vp_amount` reflect the sheet's $ values
- [ ] `status` values are from the dashboard's allowed list (Deal Review / Pending Install / Pay Finalized / Paid / Sales Issue) — not the raw sheet values
- [ ] Spot-check 3 deals: pull one up in the dashboard and confirm $ amounts match the sheet exactly

## Adding more months later

Edit the `TABS_TO_SYNC` array at the top of `Sync.gs`:

```javascript
const TABS_TO_SYNC = ["April '26", "May '26", "June '26"];
```

Save. Next 5-minute run picks up the new tab.

## Troubleshooting

- **"Missing SUPABASE_URL or SUPABASE_SERVICE_KEY"** — the Script Properties weren't saved correctly. Recheck spelling and make sure you hit Save.
- **"Tab not found: April '26"** — the tab name has special characters (curly apostrophe vs straight). Open the sheet, right-click the tab → Rename → retype, or copy the exact name from the tab and paste it into `TABS_TO_SYNC`.
- **"unknown setter 'Tanner'"** — that name isn't in the `profiles` table. Either it's a typo in the sheet, an old employee, or you need to add them via Studio.
- **"Insert failed: ... violates check constraint 'deals_status_check'"** — a status came in that isn't in `STATUS_MAP`. Add it to the map.
- **"Insert failed: ... null value in column 'sale_date'"** — the row has no Closing Date. The sync skips these and logs an error; fill in the date in the sheet.
- **Deals are duplicated in the dashboard** — two rows in the sheet share the same Lead Name. Either rename one in the sheet, or eventually add a hidden Deal ID column.

## How the bonus/deduction flow works

When you manually adjust commission $ in the sheet (e.g. add a $200 bonus to Conner's commission column), the next 5-minute sync reads that adjusted dollar amount and writes it directly to the dashboard's `manager_amount` field for that deal. The dashboard's commission calculator prefers stored $ over computing from %, so the bonus shows up automatically.

If the sync ever breaks and a deal is created manually in the dashboard with no $ amounts, the calculator falls back to computing from `manager_override_pct` × baseline. So you have a safety net either way.
