/**
 * Turf Time — ArcSite "Jobs" Sheet → Supabase (auto-create deals)
 *
 * Reads the ArcSite-fed "Jobs" tab and creates ONE deal per ArcSite Project ID,
 * in status "Deal Review", so closed jobs flow into the dashboard automatically.
 *
 *  • Insert-once: a Project ID already present on a deal is skipped — never
 *    duplicates and never overwrites your edits.
 *  • Team filter: only rows whose Sales Rep matches a profile in the dashboard
 *    are imported (your roster == your team). Unknown reps are skipped.
 *  • Maps: Customer → name, Baseline Cost → baseline_revenue,
 *    Pre-Tax Sale → job_price, Approved Date → sale_date,
 *    Sales Rep → setter & closer (solo), Project ID → project_id.
 *    Baseline & price come in pre-filled; you finish splits/overrides on review.
 *
 * Setup:
 *   1. In THIS scheduler spreadsheet: Extensions → Apps Script → paste this file
 *   2. Project Settings → Script Properties:
 *        SUPABASE_URL          (Kong public URL, no trailing slash)
 *        SUPABASE_SERVICE_KEY  (service_role key — NOT the anon key)
 *   3. Run importJobs() once to authorize
 *   4. Triggers → Add Trigger → importJobs → Time-driven → every 10 minutes
 */

// ── CONFIG ──────────────────────────────────────────────────
const JOBS_TAB      = 'Jobs';
const ONLY_STATUS   = 'APPROVED';        // import only rows with this Status (blank = import all)
const DIRECTOR_NAME = 'garrison shaker'; // default override chain
const VP_NAME       = 'keaton shaker';
// Never import jobs whose Sales Rep name contains any of these (case-insensitive).
const EXCLUDE_REPS  = ['rhett', 'ronnie'];
// Set true to mark rows where the sale is below baseline (negative commission)
// as "Sales Issue" instead of "Deal Review".
const FLAG_NEGATIVE_AS_ISSUE = false;
// SAFETY: true = preview only. Logs what it WOULD create and writes nothing.
// Review the Execution log, then set to false to actually import.
const DRY_RUN = true;

// ── ENTRY POINT ─────────────────────────────────────────────
function importJobs() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SUPABASE_URL');
  const key = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in Script Properties');

  // Roster (id, name, manager_id) → match Sales Rep names to dashboard people.
  const profiles = asGet_(url, key, '/rest/v1/profiles?select=id,name,manager_id');
  const byName = {};
  profiles.forEach(p => { if (p.name) byName[String(p.name).trim().toLowerCase()] = p; });
  const directorId = (byName[DIRECTOR_NAME] || {}).id || null;
  const vpId       = (byName[VP_NAME] || {}).id || null;

  // Existing project_ids → insert-once dedupe.
  const existing = asGet_(url, key, '/rest/v1/deals?select=project_id,deal_name');
  const seen = new Set(existing.map(d => String(d.project_id || '')).filter(Boolean));
  // Also skip anything whose customer name already exists — protects deals you
  // entered by hand (which have no Project ID to match on).
  const seenNames = new Set(existing.map(d => String(d.deal_name || '').trim().toLowerCase()).filter(Boolean));

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(JOBS_TAB);
  if (!sheet) throw new Error('Tab not found: ' + JOBS_TAB);
  const rows = sheet.getDataRange().getDisplayValues(); // display values keep long IDs exact
  if (rows.length < 2) return;

  const headers = rows[0].map(h => String(h).trim());
  const col = (n) => headers.indexOf(n);
  const ix = {
    approved:   col('Approved Date'),
    customer:   col('Customer'),
    rep:        col('Sales Rep'),
    baseline:   col('Baseline Cost'),
    sale:       col('Pre-Tax Sale'),
    projectId:  col('Project ID'),
    proposalId: col('Proposal ID'),
    status:     col('Status'),
  };
  if (ix.customer === -1 || ix.projectId === -1) {
    throw new Error("Couldn't find 'Customer' / 'Project ID' columns on the " + JOBS_TAB + ' tab');
  }

  const out = { created: 0, skipped: 0, errors: 0, details: [] };

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const customer = String(row[ix.customer] || '').trim();
    if (!customer) { out.skipped++; continue; }

    const status = String(ix.status >= 0 ? row[ix.status] : '').trim().toUpperCase();
    if (ONLY_STATUS && status !== ONLY_STATUS) { out.skipped++; continue; }

    const projectId = String(row[ix.projectId] || '').trim()
      || String(ix.proposalId >= 0 ? row[ix.proposalId] : '').trim();
    if (!projectId) { out.skipped++; out.details.push('Row ' + (r + 1) + ' (' + customer + '): no Project/Proposal ID'); continue; }
    if (seen.has(projectId)) { out.skipped++; continue; } // already imported (by Project ID)
    if (seenNames.has(customer.toLowerCase())) { out.skipped++; continue; } // already in dashboard (by name)

    // Team filter: Sales Rep must be a known dashboard person (strip "(group)" suffixes)
    const repName = String(row[ix.rep] || '').replace(/\s*\(.*$/, '').trim();
    const repLc = repName.toLowerCase();
    if (EXCLUDE_REPS.some(x => repLc.indexOf(x) !== -1)) { out.skipped++; continue; } // inside-sales / excluded rep
    const rep = byName[repLc];
    if (!rep) { out.skipped++; continue; } // not on your team / name doesn't match

    const baseline = asMoney_(row[ix.baseline]);
    const sale     = asMoney_(row[ix.sale]);
    const isLoss   = baseline != null && sale != null && sale < baseline;

    const deal = {
      deal_name:        customer,
      sale_date:        asDate_(row[ix.approved]),
      status:           (FLAG_NEGATIVE_AS_ISSUE && isLoss) ? 'Sales Issue' : 'Deal Review',
      setter_id:        rep.id,
      closer_id:        rep.id,            // single Sales Rep → solo
      setter_split_pct: 1,
      manager_id:       rep.manager_id || null,
      director_id:      directorId,
      vp_id:            vpId,
      baseline_revenue: baseline,
      job_price:        sale,
      project_id:       projectId,
    };

    if (DRY_RUN) {
      out.created++;
      seen.add(projectId); seenNames.add(customer.toLowerCase());
      out.details.push('WOULD CREATE — ' + customer + ' (base ' + (baseline || 0) + ' / sale ' + (sale || 0) + ', ' + repName + ')');
      continue;
    }
    try {
      asInsert_(url, key, '/rest/v1/deals', deal);
      seen.add(projectId); seenNames.add(customer.toLowerCase());
      out.created++;
    } catch (e) {
      out.errors++;
      out.details.push('Row ' + (r + 1) + ' (' + customer + '): ' + e.message);
    }
  }

  Logger.log((DRY_RUN ? '[DRY RUN — nothing written] ' : '') + 'ArcSite import — ' + (DRY_RUN ? 'would create ' : 'created ') + out.created + ', skipped ' + out.skipped + ', errors ' + out.errors);
  if (out.details.length) Logger.log(out.details.join('\n'));
  return out;
}

// ── SUPABASE HELPERS ────────────────────────────────────────
function asGet_(url, key, path) {
  const resp = UrlFetchApp.fetch(url + path, {
    method: 'get',
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) throw new Error('GET ' + path + ' failed: ' + resp.getContentText());
  return JSON.parse(resp.getContentText());
}

function asInsert_(url, key, path, payload) {
  const resp = UrlFetchApp.fetch(url + path, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'return=minimal' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) throw new Error('Insert failed: ' + resp.getContentText());
}

// ── PARSERS ─────────────────────────────────────────────────
function asMoney_(val) {
  if (val === '' || val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  const raw = String(val).trim();
  const neg = /^\(.*\)$/.test(raw); // ($1,234.00) = negative
  const cleaned = raw.replace(/[$,\s()]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : (neg ? -n : n);
}

function asDate_(val) {
  if (!val) return null;
  if (val instanceof Date) return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { let [, mo, d, y] = m; if (y.length === 2) y = '20' + y; return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
  return null;
}
