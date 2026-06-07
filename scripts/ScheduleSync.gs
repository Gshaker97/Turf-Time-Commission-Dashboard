/**
 * Turf Time — "Schedule" tab → Supabase (auto-import scheduled jobs)
 *
 * Pulls scheduled installs from the scheduler spreadsheet's "Schedule" tab and
 * upserts them into the dashboard's `deals` table. This is the no-webhook path:
 * ArcSite already lands every job in this spreadsheet, so we push straight from
 * the Sheet over the normal Supabase REST API — no Edge Function required.
 *
 * Flow:
 *   ArcSite (sold) → "Jobs" tab (baseline + Project ID)
 *                 → "Schedule" tab (install date, payment, office, setter)
 *                 → [this script, on a 1-min trigger] → deals → the site
 *
 * What it does per BOOKED row that has an Install Date:
 *   • Joins the "Jobs" tab by Proposal ID to recover the baseline cost, the
 *     ArcSite Project ID (the dedupe key), a clean Sales Rep, and the sale date.
 *     Rows with no Jobs match (e.g. CAL-… calendar imports) are skipped.
 *   • Setter/closer from Lead Source: "Setter: John Kostiv" → John sets,
 *     the Sales Rep closes (split 50/50). "Self Gen"/blank → Sales Rep is solo.
 *   • UPSERT keyed on the Project ID:
 *       – Deal exists  → PATCH only schedule-owned facts that changed
 *         (install_date, pay_date computed, payment_method, office) and bump
 *         status to "Pending Install" — preserves splits/overrides/notes/etc.
 *       – Deal missing → CREATE it (status "Pending Install"), gated by the
 *         forward-only baseline so your existing backlog doesn't flood in.
 *   • CANCELLED row → flips the matching deal's status to "Sales Issue"
 *     (never creates, never touches a deal already Pay Finalized / Paid).
 *
 * Setup (in the scheduler spreadsheet's Apps Script project):
 *   1. Add this as a new .gs file (it shares Script Properties with the other
 *      syncs — all names here are sch*-prefixed to avoid collisions).
 *   2. Script Properties (already set by the commission/ArcSite syncs):
 *        SUPABASE_URL          (Kong public URL, no trailing slash)
 *        SUPABASE_SERVICE_KEY  (service_role key — NOT the anon key)
 *   3. Run schBaselineNow() ONCE — marks currently-scheduled jobs as handled so
 *      only jobs scheduled from now on get auto-CREATED. (Existing deals still
 *      receive schedule updates.)
 *   4. Run schSync() once with SCH_DRY_RUN = true and read the Execution log.
 *   5. Set SCH_DRY_RUN = false, then Triggers → Add Trigger → schSync →
 *      Time-driven → every minute.
 */

// ── CONFIG ──────────────────────────────────────────────────
const SCH_TAB              = 'Schedule';        // per-scheduled-job source tab
const SCH_JOBS_TAB         = 'Jobs';            // ArcSite sold feed (baseline + Project ID)
const SCH_DIRECTOR         = 'garrison shaker'; // default override chain (lowercased)
const SCH_VP               = 'keaton shaker';
const SCH_EXCLUDE_REPS     = ['rhett', 'ronnie'];       // never import inside-sales reps
const SCH_SKIP_NAME_CONTAINS = ['test', 'cute'];        // junk/test customers
const SCH_NEW_STATUS       = 'Pending Install'; // status for a freshly scheduled deal
const SCH_CANCEL_STATUS    = 'Sales Issue';     // CANCELLED schedule row → this status
const SCH_LOCKED_STATUSES  = ['Pay Finalized', 'Paid']; // never auto-overridden
const SCH_BASELINE_PROP    = 'SCHED_BASELINE_IDS';
// SAFETY: true = preview only (logs what it WOULD do, writes nothing).
const SCH_DRY_RUN          = true;

// ── ENTRY POINT (put this on the trigger) ───────────────────
function schSync() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SUPABASE_URL');
  const key = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in Script Properties');

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Jobs index: Proposal ID → { projectId, baseline, sale, rep, saleDate }
  const jobs = schBuildJobsIndex_(ss);

  // Roster by name → ids + override chain.
  const profiles = schGet_(url, key, '/rest/v1/profiles?select=id,name,manager_id');
  const byName = {};
  profiles.forEach(p => { if (p.name) byName[String(p.name).trim().toLowerCase()] = p; });
  const directorId = (byName[SCH_DIRECTOR] || {}).id || null;
  const vpId       = (byName[SCH_VP] || {}).id || null;

  // Existing deals keyed by project_id (with the fields we may patch).
  const deals = schGet_(url, key, '/rest/v1/deals?select=id,project_id,status,install_date,pay_date,payment_method,office');
  const dealByKey = {};
  deals.forEach(d => { if (d.project_id) dealByKey[String(d.project_id)] = d; });

  // Forward-only baseline — gates CREATES only (updates always flow through).
  const ignoreCreate = new Set((props.getProperty(SCH_BASELINE_PROP) || '').split(',').filter(Boolean));

  const sheet = ss.getSheetByName(SCH_TAB);
  if (!sheet) throw new Error('Tab not found: ' + SCH_TAB);
  const rows = sheet.getDataRange().getDisplayValues();
  if (rows.length < 2) return;

  const headers = rows[0].map(h => String(h).trim());
  const col = (n) => headers.indexOf(n);
  const ix = {
    booked:   col('Booked At'),
    install:  col('Install Date'),
    customer: col('Customer'),
    jobValue: col('Job Value'),
    rep:      col('Sales Rep'),
    status:   col('Status'),
    proposal: col('Proposal ID'),
    lead:     col('Lead Source'),
    payment:  col('Payment'),
  };
  const officeIx = schFindOfficeCol_(headers, ix.payment);
  if (ix.customer === -1 || ix.proposal === -1 || ix.install === -1) {
    throw new Error("Schedule tab needs 'Customer', 'Proposal ID', and 'Install Date' columns");
  }

  const out = { created: 0, updated: 0, flagged: 0, skipped: 0, errors: 0, details: [] };

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];

    const customer = String(row[ix.customer] || '').trim();
    if (!customer) { out.skipped++; continue; }
    if (SCH_SKIP_NAME_CONTAINS.some(x => customer.toLowerCase().indexOf(x) !== -1)) { out.skipped++; continue; }

    const proposalId = String(row[ix.proposal] || '').trim();
    if (!proposalId || proposalId.indexOf('CAL-') === 0) { out.skipped++; continue; } // calendar junk / no id

    const job = jobs[proposalId];
    if (!job) { out.skipped++; continue; } // no Jobs match → no baseline/Project ID → can't trust it

    const dealKey  = job.projectId || proposalId;
    const existing = dealByKey[dealKey] || dealByKey[proposalId];

    // Rep (schedule row, else from Jobs). Excluded inside-sales reps never import.
    const repName = schCleanRep_(row[ix.rep]) || job.rep;
    const repLc   = (repName || '').toLowerCase();
    if (SCH_EXCLUDE_REPS.some(x => repLc.indexOf(x) !== -1)) { out.skipped++; continue; }

    const status = String(row[ix.status] || '').trim().toUpperCase();

    // CANCELLED → flag an existing deal; never create.
    if (status === 'CANCELLED') {
      if (existing && existing.status !== SCH_CANCEL_STATUS && SCH_LOCKED_STATUSES.indexOf(existing.status) === -1) {
        if (SCH_DRY_RUN) { out.flagged++; out.details.push('WOULD FLAG cancelled — ' + customer); }
        else { try { schPatch_(url, key, '/rest/v1/deals?id=eq.' + existing.id, { status: SCH_CANCEL_STATUS }); out.flagged++; } catch (e) { out.errors++; out.details.push(customer + ': ' + e.message); } }
      } else { out.skipped++; }
      continue;
    }
    if (status !== 'BOOKED') { out.skipped++; continue; } // only act on BOOKED

    const installDate = schDate_(row[ix.install]);
    if (!installDate) { out.skipped++; continue; } // not actually scheduled yet
    const payDate = schPayDate_(installDate);
    const payment = schPayment_(row[ix.payment]);
    const office  = officeIx >= 0 ? schTitle_(row[officeIx]) : null;

    // ── UPDATE existing deal — only the schedule-owned facts that changed ──
    if (existing) {
      const patch = {};
      if (installDate && existing.install_date   !== installDate) patch.install_date   = installDate;
      if (payDate     && existing.pay_date       !== payDate)     patch.pay_date       = payDate;
      if (payment     && existing.payment_method !== payment)     patch.payment_method = payment;
      if (office      && existing.office         !== office)      patch.office         = office;
      if (existing.status !== SCH_NEW_STATUS &&
          existing.status !== SCH_CANCEL_STATUS &&
          SCH_LOCKED_STATUSES.indexOf(existing.status) === -1) {
        patch.status = SCH_NEW_STATUS;
      }
      if (!Object.keys(patch).length) { out.skipped++; continue; }
      if (SCH_DRY_RUN) { out.updated++; out.details.push('WOULD UPDATE — ' + customer + ' ' + JSON.stringify(patch)); continue; }
      try { schPatch_(url, key, '/rest/v1/deals?id=eq.' + existing.id, patch); out.updated++; }
      catch (e) { out.errors++; out.details.push(customer + ': ' + e.message); }
      continue;
    }

    // ── CREATE — gated by the forward-only baseline ──
    if (ignoreCreate.has(dealKey) || ignoreCreate.has(proposalId)) { out.skipped++; continue; }

    const repProfile = byName[repLc];
    if (!repProfile) { out.skipped++; out.details.push('Unknown rep "' + repName + '" for ' + customer); continue; }

    // Setter from Lead Source ("Setter: Name") → split; else solo.
    let setterId = repProfile.id, closerId = repProfile.id, split = 1;
    const setterName = schParseSetter_(row[ix.lead]);
    if (setterName) {
      const sp = byName[setterName.toLowerCase()];
      if (sp && sp.id !== repProfile.id) { setterId = sp.id; closerId = repProfile.id; split = 0.5; }
    }

    const deal = {
      deal_name:        customer,
      sale_date:        job.saleDate || schDate_(row[ix.booked]),
      install_date:     installDate,
      pay_date:         payDate,
      status:           SCH_NEW_STATUS,
      setter_id:        setterId,
      closer_id:        closerId,
      setter_split_pct: split,
      manager_id:       repProfile.manager_id || null,
      director_id:      directorId,
      vp_id:            vpId,
      baseline_revenue: job.baseline,
      job_price:        job.sale != null ? job.sale : schMoney_(row[ix.jobValue]),
      payment_method:   payment,
      office:           office,
      project_id:       dealKey,
    };

    if (SCH_DRY_RUN) {
      out.created++;
      dealByKey[dealKey] = { id: 'preview', project_id: dealKey };  // dedupe within this run
      out.details.push('WOULD CREATE — ' + customer + ' (install ' + installDate + ', base ' + (deal.baseline_revenue || 0) +
        ', ' + repName + (setterName ? ', set by ' + setterName : '') + ')');
      continue;
    }
    try {
      schPost_(url, key, '/rest/v1/deals', deal);
      dealByKey[dealKey] = { id: 'new', project_id: dealKey, status: SCH_NEW_STATUS };
      out.created++;
    } catch (e) { out.errors++; out.details.push(customer + ': ' + e.message); }
  }

  Logger.log((SCH_DRY_RUN ? '[DRY RUN — nothing written] ' : '') +
    'Schedule sync — created ' + out.created + ', updated ' + out.updated +
    ', flagged ' + out.flagged + ', skipped ' + out.skipped + ', errors ' + out.errors);
  if (out.details.length) Logger.log(out.details.join('\n'));
  return out;
}

// ── BASELINE (run once) ─────────────────────────────────────
// Records every job currently on the Schedule tab as "already handled" so the
// sync only auto-CREATES jobs scheduled from now on. Existing deals still get
// schedule updates regardless.
function schBaselineNow() {
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const jobs = schBuildJobsIndex_(ss);
  const sheet = ss.getSheetByName(SCH_TAB);
  if (!sheet) throw new Error('Tab not found: ' + SCH_TAB);
  const rows = sheet.getDataRange().getDisplayValues();
  if (rows.length < 2) { Logger.log('Nothing to baseline.'); return 0; }
  const proposalIx = rows[0].map(h => String(h).trim()).indexOf('Proposal ID');
  if (proposalIx === -1) throw new Error("Schedule tab missing 'Proposal ID'");
  const keys = [];
  for (let r = 1; r < rows.length; r++) {
    const pid = String(rows[r][proposalIx] || '').trim();
    if (!pid || pid.indexOf('CAL-') === 0) continue;
    const job = jobs[pid];
    keys.push((job && job.projectId) ? job.projectId : pid);
  }
  const uniq = [...new Set(keys)];
  props.setProperty(SCH_BASELINE_PROP, uniq.join(','));
  Logger.log('Baseline set — ' + uniq.length + ' currently-scheduled jobs will NOT be auto-created. ' +
    'Newly scheduled jobs import from now on. (Existing deals still get schedule updates.)');
  return uniq.length;
}

// ── JOBS INDEX ──────────────────────────────────────────────
function schBuildJobsIndex_(ss) {
  const sheet = ss.getSheetByName(SCH_JOBS_TAB);
  if (!sheet) throw new Error('Tab not found: ' + SCH_JOBS_TAB);
  const rows = sheet.getDataRange().getDisplayValues();
  const map = {};
  if (rows.length < 2) return map;
  const h = rows[0].map(x => String(x).trim());
  const c = (n) => h.indexOf(n);
  const ix = {
    proposal: c('Proposal ID'), project: c('Project ID'),
    baseline: c('Baseline Cost'), sale: c('Pre-Tax Sale'),
    rep: c('Sales Rep'), approved: c('Approved Date'),
  };
  if (ix.proposal === -1) return map;
  for (let r = 1; r < rows.length; r++) {
    const pid = String(rows[r][ix.proposal] || '').trim();
    if (!pid) continue;
    map[pid] = {  // last row wins (handles re-signs)
      projectId: ix.project  >= 0 ? String(rows[r][ix.project] || '').trim() : '',
      baseline:  schMoney_(rows[r][ix.baseline]),
      sale:      schMoney_(rows[r][ix.sale]),
      rep:       ix.rep      >= 0 ? schCleanRep_(rows[r][ix.rep]) : '',
      saleDate:  ix.approved >= 0 ? schDate_(rows[r][ix.approved]) : null,
    };
  }
  return map;
}

// The office column on the Schedule tab has a blank header; it sits just after
// "Payment". Prefer a real "Office" header if one exists.
function schFindOfficeCol_(headers, paymentIx) {
  const named = headers.indexOf('Office');
  if (named >= 0) return named;
  if (paymentIx >= 0 && paymentIx + 1 < headers.length) return paymentIx + 1;
  return -1;
}

// ── PARSERS ─────────────────────────────────────────────────
function schParseSetter_(v) {
  const m = String(v || '').trim().match(/^setter\s*:\s*(.+)$/i);
  return m ? m[1].trim() : null;
}
function schCleanRep_(v) {
  return String(v || '').replace(/\s*\(.*$/, '').trim();   // strip "(group)" suffixes
}
function schPayment_(v) {
  const s = String(v || '').trim();
  return s ? s.replace(/self\s*pay/ig, 'Self-Pay') : null;
}
function schTitle_(v) {
  const s = String(v || '').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : null;  // phoenix → Phoenix
}
function schMoney_(val) {
  if (val === '' || val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  const raw = String(val).trim();
  const neg = /^\(.*\)$/.test(raw);                  // ($1,234.00) = negative
  const cleaned = raw.replace(/[$,\s()]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : (neg ? -n : n);
}
function schDate_(val) {
  if (!val) return null;
  if (val instanceof Date) return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { let [, mo, d, y] = m; if (y.length === 2) y = '20' + y; return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
  return null;
}
// Pay the Friday following the (Monday-anchored) install week = Monday + 11 days.
function schPayDate_(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T12:00:00Z');
  if (isNaN(d.getTime())) return null;
  const dow = d.getUTCDay();                 // 0=Sun..6=Sat
  const offset = (dow === 0 ? 7 : dow) - 1;  // days since Monday
  const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - offset);
  const pay = new Date(monday); pay.setUTCDate(monday.getUTCDate() + 11);
  return pay.toISOString().slice(0, 10);
}

// ── SUPABASE HELPERS ────────────────────────────────────────
function schGet_(url, key, path) {
  const resp = UrlFetchApp.fetch(url + path, {
    method: 'get',
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) throw new Error('GET ' + path + ' failed: ' + resp.getContentText());
  return JSON.parse(resp.getContentText());
}
function schPost_(url, key, path, payload) {
  const resp = UrlFetchApp.fetch(url + path, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'return=minimal' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) throw new Error('Insert failed: ' + resp.getContentText());
}
function schPatch_(url, key, path, payload) {
  const resp = UrlFetchApp.fetch(url + path, {
    method: 'patch',
    contentType: 'application/json',
    headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'return=minimal' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) throw new Error('Patch failed: ' + resp.getContentText());
}
