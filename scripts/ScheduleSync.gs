/**
 * Turf Time — Spreadsheet → Supabase sync (Jobs + Schedule, with change orders)
 *
 * One trigger drives everything. Paste this file into the scheduler
 * spreadsheet's Apps Script project and run schSync() on a 1-minute timer.
 *
 * What it does each run:
 *   1) JOBS tab (the ArcSite "sold" feed) — the source of truth for deals:
 *        • Every APPROVED job becomes a deal as soon as it lands (status
 *          "Deal Review"), with the details it has (baseline, sale price, sale
 *          date, Sales Rep as setter+closer). Rhett & Ronnie are never imported.
 *        • Already imported? If the baseline or sale price changed (a change
 *          order / re-sign), the deal is updated to the new numbers, its status
 *          is set to "Change Order", and its checklist + commission sign-off are
 *          cleared so you re-verify. Unchanged jobs are left alone.
 *        • Hand-entered deals are protected (matched by customer name).
 *   2) SCHEDULE tab — layers scheduling info onto the matching deal:
 *        • install_date (+ pay_date computed), payment method, office, and the
 *          real setter from Lead Source ("Setter: Name" → setter, Sales Rep →
 *          closer). Status is left alone here.
 *        • A CANCELLED schedule row flips the deal to "Canceled".
 *
 * Setup:
 *   1. Paste as a file in the spreadsheet's Apps Script project (replaces the
 *      old ScheduleSync). DISABLE the old ArcSiteImport `importJobs` trigger —
 *      this script now owns creation.
 *   2. Script Properties: SUPABASE_URL, SUPABASE_SERVICE_KEY (already set).
 *   3. Run schSync() once with SCH_DRY_RUN = true and read the Execution log.
 *      (Heads up: the first real run imports every job on the sheet that isn't
 *      already a deal. To only bring in jobs from now on, run schBaselineNow()
 *      once first.)
 *   4. Set SCH_DRY_RUN = false, then Triggers → schSync → time-driven → every minute.
 */

// ── CONFIG ──────────────────────────────────────────────────
const SCH_TAB             = 'Schedule';
const SCH_JOBS_TAB        = 'Jobs';
const SCH_ONLY_STATUS     = 'APPROVED';        // only import Jobs rows with this Status (blank = all)
const SCH_DIRECTOR        = 'garrison shaker'; // default override chain (lowercased)
const SCH_VP              = 'keaton shaker';
const SCH_EXCLUDE_REPS    = ['rhett', 'ronnie'];   // never import these reps
const SCH_SKIP_NAME_CONTAINS = ['test', 'cute'];   // junk/test customers
const SCH_NEW_STATUS      = 'Deal Review';      // status for a freshly imported deal
const SCH_CHANGE_STATUS   = 'Change Order';     // a re-signed / changed deal
const SCH_CANCEL_STATUS   = 'Canceled';         // CANCELLED schedule row → this status
// Statuses the sync never touches — finalized pay + manual triage. A deal you
// mark Sales Issue / Canceled (or that's already paid) won't get schedule info
// re-applied or its status changed by the sync.
const SCH_LOCKED_STATUSES = ['Pay Finalized', 'Paid', 'Sales Issue', 'Canceled'];
const SCH_FINALIZED_STATUS = 'Pay Finalized';  // auto-advances to Paid once its pay date arrives
const SCH_PAID_STATUS      = 'Paid';
const SCH_BASELINE_PROP   = 'SCHED_BASELINE_IDS';
// SAFETY: true = preview only (logs what it WOULD do, writes nothing).
const SCH_DRY_RUN         = true;

// ── ENTRY POINT (put this on the trigger) ───────────────────
function schSync() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SUPABASE_URL');
  const key = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in Script Properties');

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Roster by name → ids + override chain.
  const profiles = schGet_(url, key, '/rest/v1/profiles?select=id,name,manager_id');
  const byName = {};
  profiles.forEach(p => { if (p?.name) byName[String(p.name).trim().toLowerCase()] = p; });
  const directorId = (byName[SCH_DIRECTOR] || {}).id || null;
  const vpId       = (byName[SCH_VP] || {}).id || null;

  // Existing deals, keyed by project_id; plus the set of customer names (to
  // protect hand-entered deals from being duplicated).
  const deals = schGet_(url, key,
    '/rest/v1/deals?select=id,project_id,deal_name,status,baseline_revenue,job_price,install_date,pay_date,payment_method,office,setter_id,closer_id,manager_override_pct,director_override_pct,vp_override_pct,commission_verified,checklist');
  const byProject = {}, namesSeen = new Set();
  deals.forEach(d => {
    if (d.project_id) byProject[String(d.project_id)] = d;
    if (d.deal_name) namesSeen.add(String(d.deal_name).trim().toLowerCase());
  });

  const ignoreCreate = new Set((props.getProperty(SCH_BASELINE_PROP) || '').split(',').filter(Boolean));
  const out = { created: 0, changed: 0, updated: 0, canceled: 0, paid: 0, skipped: 0, errors: 0, details: [] };

  // ── PAID PASS — Pay Finalized → Paid once the pay date has arrived ──
  const todayISO = new Date().toISOString().slice(0, 10);
  for (const d of deals) {
    if (d.status === SCH_FINALIZED_STATUS && d.pay_date && d.pay_date <= todayISO) {
      if (SCH_DRY_RUN) { out.paid++; out.details.push('WOULD MARK PAID — ' + (d.deal_name || d.project_id)); }
      else { try { schPatch_(url, key, '/rest/v1/deals?id=eq.' + d.id, { status: SCH_PAID_STATUS }); d.status = SCH_PAID_STATUS; out.paid++; } catch (e) { out.errors++; out.details.push((d.deal_name || d.project_id) + ': ' + e.message); } }
    }
  }

  // ── JOBS PASS — create new deals & catch change orders ──
  const jobsSheet = ss.getSheetByName(SCH_JOBS_TAB);
  if (jobsSheet) {
    const rows = jobsSheet.getDataRange().getDisplayValues();
    if (rows.length >= 2) {
      const h = rows[0].map(x => String(x).trim());
      const c = (n) => h.indexOf(n);
      const ix = {
        approved: c('Approved Date'), customer: c('Customer'), rep: c('Sales Rep'),
        baseline: c('Baseline Cost'), sale: c('Pre-Tax Sale'),
        project: c('Project ID'), proposal: c('Proposal ID'), status: c('Status'),
      };
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const customer = String(row[ix.customer] || '').trim();
        if (!customer) { out.skipped++; continue; }
        if (SCH_SKIP_NAME_CONTAINS.some(x => customer.toLowerCase().indexOf(x) !== -1)) { out.skipped++; continue; }

        const status = String(ix.status >= 0 ? row[ix.status] : '').trim().toUpperCase();
        if (SCH_ONLY_STATUS && status && status !== SCH_ONLY_STATUS) { out.skipped++; continue; }

        const projectId = String(row[ix.project] || '').trim() || String(ix.proposal >= 0 ? row[ix.proposal] : '').trim();
        if (!projectId) { out.skipped++; continue; }

        const repName = schCleanRep_(row[ix.rep]);
        const repLc = repName.toLowerCase();
        if (SCH_EXCLUDE_REPS.some(x => repLc.indexOf(x) !== -1)) { out.skipped++; continue; }

        const baselineVal = schMoney_(row[ix.baseline]);
        const saleVal     = schMoney_(row[ix.sale]);
        const existing    = byProject[projectId];

        if (existing) {
          // Change order: the sheet's financials differ from what we stored.
          // This OVERRIDES any current status (even Paid / Sales Issue) so a
          // re-signed deal always surfaces as "Change Order" for re-verification.
          const changed = schChanged_(existing.baseline_revenue, baselineVal) || schChanged_(existing.job_price, saleVal);
          if (changed && existing.status !== SCH_CHANGE_STATUS) {
            // Clear stored commission amounts so everything recomputes off the new
            // baseline/price + override %s (overrides won't go stale).
            const patch = { baseline_revenue: baselineVal, job_price: saleVal, status: SCH_CHANGE_STATUS, commission_verified: false, checklist: [],
              setter_amount: null, closer_amount: null, manager_amount: null, director_amount: null, vp_amount: null };
            if (customer && existing.deal_name !== customer) patch.deal_name = customer;
            if (SCH_DRY_RUN) {
              out.changed++;
              out.details.push('WOULD CHANGE-ORDER — ' + customer + ' (base ' + existing.baseline_revenue + '→' + baselineVal + ', sale ' + existing.job_price + '→' + saleVal + ')');
            } else {
              try { schPatch_(url, key, '/rest/v1/deals?id=eq.' + existing.id, patch); Object.assign(existing, patch); out.changed++; }
              catch (e) { out.errors++; out.details.push(customer + ': ' + e.message); }
            }
          }
          continue;
        }

        // New deal.
        if (ignoreCreate.has(projectId)) { out.skipped++; continue; }
        if (namesSeen.has(customer.toLowerCase())) { out.skipped++; continue; }  // protect hand-entered
        const rep = byName[repLc];
        if (!rep) { out.skipped++; out.details.push('Unknown rep "' + repName + '" for ' + customer); continue; }

        const deal = {
          deal_name: customer, sale_date: schDate_(row[ix.approved]), status: SCH_NEW_STATUS,
          setter_id: rep.id, closer_id: rep.id, setter_split_pct: 1,
          manager_id: rep.manager_id || null, director_id: directorId, vp_id: vpId,
          baseline_revenue: baselineVal, job_price: saleVal, project_id: projectId,
          // Office-based override defaults (office unknown at sold-time → 5%;
          // the Schedule pass corrects Director/VP to the office rate).
          manager_override_pct: 0.03, director_override_pct: 0.05, vp_override_pct: 0.05,
        };
        if (SCH_DRY_RUN) {
          out.created++; byProject[projectId] = Object.assign({ id: 'preview' }, deal); namesSeen.add(customer.toLowerCase());
          out.details.push('WOULD CREATE — ' + customer + ' (base ' + (baselineVal || 0) + ', ' + repName + ')');
        } else {
          try { schPost_(url, key, '/rest/v1/deals', deal); byProject[projectId] = Object.assign({ id: 'new' }, deal); namesSeen.add(customer.toLowerCase()); out.created++; }
          catch (e) { out.errors++; out.details.push(customer + ': ' + e.message); }
        }
      }
    }
  }

  // ── SCHEDULE PASS — install date, setter, payment, office, cancels ──
  const schedSheet = ss.getSheetByName(SCH_TAB);
  if (schedSheet) {
    const jobsIdx = schBuildJobsIndex_(ss);   // proposalId → { projectId, ... }
    const rows = schedSheet.getDataRange().getDisplayValues();
    if (rows.length >= 2) {
      const h = rows[0].map(x => String(x).trim());
      const c = (n) => h.indexOf(n);
      const ix = {
        install: c('Install Date'), customer: c('Customer'), rep: c('Sales Rep'),
        status: c('Status'), proposal: c('Proposal ID'), lead: c('Lead Source'),
        payment: c('Payment'), booked: c('Booked At'),
      };
      const officeIx = schFindOfficeCol_(h, rows, ix.payment);
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const proposalId = String(row[ix.proposal] || '').trim();
        if (!proposalId || proposalId.indexOf('CAL-') === 0) { out.skipped++; continue; }
        const job = jobsIdx[proposalId];
        const projectId = (job && job.projectId) ? job.projectId : proposalId;
        const existing = byProject[projectId];
        if (!existing) { out.skipped++; continue; }   // not imported (e.g. not APPROVED yet)

        const status = String(row[ix.status] || '').trim().toUpperCase();
        if (status === 'CANCELLED') {
          if (existing.status !== SCH_CANCEL_STATUS && SCH_LOCKED_STATUSES.indexOf(existing.status) === -1) {
            if (SCH_DRY_RUN) { out.canceled++; out.details.push('WOULD CANCEL — ' + (existing.deal_name || projectId)); }
            else { try { schPatch_(url, key, '/rest/v1/deals?id=eq.' + existing.id, { status: SCH_CANCEL_STATUS }); existing.status = SCH_CANCEL_STATUS; out.canceled++; } catch (e) { out.errors++; out.details.push((existing.deal_name || projectId) + ': ' + e.message); } }
          } else { out.skipped++; }
          continue;
        }
        if (status && status !== 'BOOKED') { out.skipped++; continue; }

        // Don't re-apply schedule info to finalized/triaged deals (Paid, Pay
        // Finalized, Sales Issue, Canceled) — respects manual changes.
        if (SCH_LOCKED_STATUSES.indexOf(existing.status) !== -1) { out.skipped++; continue; }

        const installDate = schDate_(row[ix.install]);
        const payDate = installDate ? schPayDate_(installDate) : null;
        const payment = schPayment_(row[ix.payment]);
        const office  = officeIx >= 0 ? schTitle_(row[officeIx]) : null;

        const patch = {};
        if (installDate && existing.install_date   !== installDate) patch.install_date   = installDate;
        if (payDate     && existing.pay_date       !== payDate)     patch.pay_date       = payDate;
        if (payment     && existing.payment_method !== payment)     patch.payment_method = payment;
        const officeChanged = office && existing.office !== office;
        if (officeChanged) patch.office = office;

        // Override % by office (Tucson 3.75%, else 5%; manager 3%). Backfill any
        // nulls and recompute Director/VP when the office is first set/changed.
        const rate = schOfficeRate_(office);
        if (existing.manager_override_pct  == null) patch.manager_override_pct  = 0.03;
        if (existing.director_override_pct == null || officeChanged) patch.director_override_pct = rate;
        if (existing.vp_override_pct       == null || officeChanged) patch.vp_override_pct       = rate;

        // Real setter from Lead Source ("Setter: Name"); the Sales Rep closes.
        const setterName = schParseSetter_(row[ix.lead]);
        if (setterName) {
          const sp = byName[setterName.toLowerCase()];
          if (sp) {
            const closerName = schCleanRep_(row[ix.rep]);
            const cp = closerName ? byName[closerName.toLowerCase()] : null;
            const closerId = (cp && cp.id) ? cp.id : (existing.closer_id || sp.id);
            if (existing.setter_id !== sp.id) {
              patch.setter_id = sp.id; patch.closer_id = closerId; patch.setter_split_pct = (sp.id === closerId ? 1 : 0.5);
            }
          }
        }

        if (!Object.keys(patch).length) { out.skipped++; continue; }
        if (SCH_DRY_RUN) { out.updated++; out.details.push('WOULD UPDATE — ' + (existing.deal_name || projectId) + ' ' + JSON.stringify(patch)); }
        else { try { schPatch_(url, key, '/rest/v1/deals?id=eq.' + existing.id, patch); Object.assign(existing, patch); out.updated++; } catch (e) { out.errors++; out.details.push((existing.deal_name || projectId) + ': ' + e.message); } }
      }
    }
  }

  Logger.log((SCH_DRY_RUN ? '[DRY RUN — nothing written] ' : '') +
    'Sync — created ' + out.created + ', change-orders ' + out.changed + ', updated ' + out.updated +
    ', canceled ' + out.canceled + ', paid ' + out.paid + ', skipped ' + out.skipped + ', errors ' + out.errors);
  if (out.details.length) Logger.log(out.details.join('\n'));
  return out;
}

// ── BASELINE (optional, run once) ───────────────────────────
// Records every job currently on the Jobs tab as "already handled" so the sync
// only CREATES jobs that land from now on. (Change orders & schedule updates to
// existing deals still flow through regardless.)
function schBaselineNow() {
  const props = PropertiesService.getScriptProperties();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SCH_JOBS_TAB);
  if (!sheet) throw new Error('Tab not found: ' + SCH_JOBS_TAB);
  const rows = sheet.getDataRange().getDisplayValues();
  if (rows.length < 2) { Logger.log('Nothing to baseline.'); return 0; }
  const h = rows[0].map(x => String(x).trim());
  const pi = h.indexOf('Project ID'), ppi = h.indexOf('Proposal ID');
  const ids = [];
  for (let r = 1; r < rows.length; r++) {
    const id = String(rows[r][pi] || '').trim() || (ppi >= 0 ? String(rows[r][ppi] || '').trim() : '');
    if (id) ids.push(id);
  }
  const uniq = [...new Set(ids)];
  props.setProperty(SCH_BASELINE_PROP, uniq.join(','));
  Logger.log('Baseline set — ' + uniq.length + ' current jobs will NOT be auto-created. Only new jobs import from now on.');
  return uniq.length;
}

// Clears the baseline so EVERY job on the sheet (not already a deal) imports.
function schClearBaseline() {
  PropertiesService.getScriptProperties().deleteProperty(SCH_BASELINE_PROP);
  Logger.log('Baseline cleared — every job on the sheet will import (minus existing deals & excluded reps).');
}

// ── JOBS INDEX (proposal → project) ─────────────────────────
function schBuildJobsIndex_(ss) {
  const sheet = ss.getSheetByName(SCH_JOBS_TAB);
  if (!sheet) return {};
  const rows = sheet.getDataRange().getDisplayValues();
  const map = {};
  if (rows.length < 2) return map;
  const h = rows[0].map(x => String(x).trim());
  const c = (n) => h.indexOf(n);
  const ix = { proposal: c('Proposal ID'), project: c('Project ID') };
  if (ix.proposal === -1) return map;
  for (let r = 1; r < rows.length; r++) {
    const pid = String(rows[r][ix.proposal] || '').trim();
    if (!pid) continue;
    map[pid] = { projectId: ix.project >= 0 ? String(rows[r][ix.project] || '').trim() : '' };
  }
  return map;
}

// Locate the office column on the Schedule tab. Its header is usually blank, so
// header-name matching alone is unreliable. Detection order:
//   1. An explicit header (Office / Location / Market / Branch / Region).
//   2. By value — the column whose cells actually read like office names
//      (Tucson / Phoenix / Mesa). This is the robust path for the blank header.
//   3. Legacy fallback — the column right after "Payment".
// If detection misses, office stays null and the Tucson 3.75% rate never gets
// applied, leaving the deal at the 5% default — which is the bug this fixes.
const SCH_KNOWN_OFFICES = ['tucson', 'phoenix', 'mesa'];
function schFindOfficeCol_(headers, rows, paymentIx) {
  for (const name of ['Office', 'Location', 'Market', 'Branch', 'Region']) {
    const i = headers.indexOf(name);
    if (i >= 0) return i;
  }
  let best = -1, bestHits = 0;
  const scanTo = Math.min(rows ? rows.length : 0, 60);
  for (let col = 0; col < headers.length; col++) {
    let hits = 0;
    for (let r = 1; r < scanTo; r++) {
      const v = String(rows[r][col] || '').trim().toLowerCase();
      if (SCH_KNOWN_OFFICES.indexOf(v) !== -1) hits++;
    }
    if (hits > bestHits) { bestHits = hits; best = col; }
  }
  if (best >= 0) return best;
  if (paymentIx >= 0 && paymentIx + 1 < headers.length) return paymentIx + 1;
  return -1;
}

// ── PARSERS ─────────────────────────────────────────────────
function schOfficeRate_(office) { return String(office || '').toLowerCase() === 'tucson' ? 0.0375 : 0.05; }
function schChanged_(stored, sheetVal) {
  if (sheetVal == null) return false;                     // missing sheet value → don't wipe
  return Math.abs((Number(stored) || 0) - (Number(sheetVal) || 0)) > 0.5;
}
function schParseSetter_(v) {
  const m = String(v || '').trim().match(/^setter\s*:\s*(.+)$/i);
  return m ? m[1].trim() : null;
}
function schCleanRep_(v) { return String(v || '').replace(/\s*\(.*$/, '').trim(); }
function schPayment_(v) { const s = String(v || '').trim(); return s ? s.replace(/self\s*pay/ig, 'Self-Pay') : null; }
function schTitle_(v) { const s = String(v || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : null; }
function schMoney_(val) {
  if (val === '' || val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  const raw = String(val).trim();
  const neg = /^\(.*\)$/.test(raw);
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
function schPayDate_(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T12:00:00Z');
  if (isNaN(d.getTime())) return null;
  const dow = d.getUTCDay();
  const offset = (dow === 0 ? 7 : dow) - 1;
  const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - offset);
  const pay = new Date(monday); pay.setUTCDate(monday.getUTCDate() + 11);
  return pay.toISOString().slice(0, 10);
}

// ── SUPABASE HELPERS ────────────────────────────────────────
function schGet_(url, key, path) {
  const resp = UrlFetchApp.fetch(url + path, { method: 'get', headers: { apikey: key, Authorization: 'Bearer ' + key }, muteHttpExceptions: true });
  if (resp.getResponseCode() >= 300) throw new Error('GET ' + path + ' failed: ' + resp.getContentText());
  return JSON.parse(resp.getContentText());
}
function schPost_(url, key, path, payload) {
  const resp = UrlFetchApp.fetch(url + path, { method: 'post', contentType: 'application/json', headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'return=minimal' }, payload: JSON.stringify(payload), muteHttpExceptions: true });
  if (resp.getResponseCode() >= 300) throw new Error('Insert failed: ' + resp.getContentText());
}
function schPatch_(url, key, path, payload) {
  const resp = UrlFetchApp.fetch(url + path, { method: 'patch', contentType: 'application/json', headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'return=minimal' }, payload: JSON.stringify(payload), muteHttpExceptions: true });
  if (resp.getResponseCode() >= 300) throw new Error('Patch failed: ' + resp.getContentText());
}
