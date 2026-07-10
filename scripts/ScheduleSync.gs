/**
 * Turf Time — Spreadsheet → Supabase sync (Jobs + Schedule, with change alerts)
 *
 * One trigger drives everything. Paste this file into the scheduler
 * spreadsheet's Apps Script project and run schSync() on a 1-minute timer.
 *
 * What it does each run:
 *   1) JOBS tab (the ArcSite "sold" feed) — the source of truth for deals:
 *        • Every APPROVED job becomes a deal as soon as it lands (status
 *          "Deal Review"), with the details it has (baseline, sale price, sale
 *          date, Sales Rep as setter+closer). Rhett & Ronnie are never imported.
 *        • Already imported? If the sheet's baseline or sale price changed (a
 *          re-signed agreement), the deal itself is NOT touched — no new
 *          numbers, no status change, no un-verifying. The sync stamps
 *          deals.change_alert (migration 031) so the deal wears a clearable
 *          ❗ flag on the Deals page for manual review. Unchanged jobs are
 *          left alone.
 *        • Hand-entered deals are protected (matched by customer name).
 *   2) SCHEDULE tab — layers scheduling info onto the matching deal:
 *        • install_date (+ pay_date computed), payment method, office, and the
 *          real setter from Lead Source ("Setter: Name" → setter, Sales Rep →
 *          closer). Status is left alone here.
 *        • A CANCELLED schedule row is ignored — the deal's status is never
 *          changed by the sync; cancel manually in the site if needed.
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
// Defaults for the admin-editable sync rules (Admin → Settings). Overridden
// per run from app_settings sync_excluded_reps / sync_skip_names when present.
var SCH_EXCLUDE_REPS    = ['rhett', 'ronnie'];   // never import these reps
var SCH_SKIP_NAME_CONTAINS = ['test', 'cute'];   // junk/test customers
const SCH_NEW_STATUS      = 'Deal Review';      // status for a freshly imported deal
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
  const profiles = schGet_(url, key, '/rest/v1/profiles?select=id,name,role,manager_id');
  const profById = {};
  profiles.forEach(function (p) { profById[p.id] = p; });
  const byName = {};
  profiles.forEach(p => { if (p?.name) byName[String(p.name).trim().toLowerCase()] = p; });
  const directorId = (byName[SCH_DIRECTOR] || {}).id || null;
  const vpId       = (byName[SCH_VP] || {}).id || null;

  // Admin-configured sync settings (Admin → Settings): override-rate schedule
  // (picked by a deal's SALE DATE, so rate changes never re-price older deals),
  // the excluded-reps / junk-name lists, and the pay-date rule. Any key that's
  // absent/unreadable falls back to the built-in defaults.
  SCH_RATES = null; SCH_PAY_RULE = null;
  SCH_EXCLUDE_REPS = ['rhett', 'ronnie']; SCH_SKIP_NAME_CONTAINS = ['test', 'cute'];
  try {
    const cfg = schGet_(url, key, '/rest/v1/app_settings?select=key,value&key=in.(override_rates,sync_excluded_reps,sync_skip_names,pay_date_rule)');
    cfg.forEach(function (row) {
      if (row.key === 'override_rates' && Array.isArray(row.value) && row.value.length) {
        SCH_RATES = row.value.slice().sort(function (a, b) { return String(a.effective || '').localeCompare(String(b.effective || '')); });
      } else if (row.key === 'sync_excluded_reps' && Array.isArray(row.value)) {
        SCH_EXCLUDE_REPS = row.value.map(function (s) { return String(s).trim().toLowerCase(); }).filter(Boolean);
      } else if (row.key === 'sync_skip_names' && Array.isArray(row.value)) {
        SCH_SKIP_NAME_CONTAINS = row.value.map(function (s) { return String(s).trim().toLowerCase(); }).filter(Boolean);
      } else if (row.key === 'pay_date_rule' && row.value && Number(row.value.day) >= 1 && Number(row.value.day) <= 7) {
        SCH_PAY_RULE = { day: Number(row.value.day), weeks_after: Math.max(0, Number(row.value.weeks_after) || 0) };
      }
    });
  } catch (e) { /* settings rows not there yet — use built-in defaults */ }

  // Existing deals, keyed by project_id; plus the set of customer names (to
  // protect hand-entered deals from being duplicated).
  const deals = schGet_(url, key,
    '/rest/v1/deals?select=id,project_id,deal_name,status,sale_date,baseline_revenue,job_price,install_date,pay_date,payment_method,office,setter_id,closer_id,manager_override_pct,director_override_pct,vp_override_pct,commission_verified,checklist,synced_baseline,synced_job_price');
  const byProject = {}, namesSeen = new Set(), dealByName = {};
  deals.forEach(d => {
    if (d.project_id) byProject[String(d.project_id)] = d;
    if (d.deal_name) {
      const k = String(d.deal_name).trim().toLowerCase();
      namesSeen.add(k);
      dealByName[k] = d;   // name fallback so a re-sign under a new Project ID still matches
    }
  });

  const ignoreCreate = new Set((props.getProperty(SCH_BASELINE_PROP) || '').split(',').filter(Boolean));
  const out = { created: 0, changed: 0, updated: 0, paid: 0, locked: 0, skipped: 0, errors: 0, details: [] };

  // ── PAID PASS — Pay Finalized → Paid once the pay date has arrived ──
  const todayISO = new Date().toISOString().slice(0, 10);
  for (const d of deals) {
    if (d.status === SCH_FINALIZED_STATUS && d.pay_date && d.pay_date <= todayISO) {
      if (SCH_DRY_RUN) { out.paid++; out.details.push('WOULD MARK PAID — ' + (d.deal_name || d.project_id)); }
      else { try { schPatch_(url, key, '/rest/v1/deals?id=eq.' + d.id, { status: SCH_PAID_STATUS }); d.status = SCH_PAID_STATUS; out.paid++; } catch (e) { out.errors++; out.details.push((d.deal_name || d.project_id) + ': ' + e.message); } }
    }
  }

  // ── AUTO-LOCK PASS — freeze past-due runs that are fully settled ──
  // Once a pay date is in the past AND every payable deal on it is Paid, insert
  // a payroll_locks row (migration 028) so the run is frozen automatically —
  // no manual Lock click needed. Runs with unpaid stragglers stay open so they
  // can still be paid, and a run an admin UNLOCKED in the last 24h is left
  // alone (app_settings.payroll_unlocks) so the sync doesn't instantly re-lock
  // it out from under their correction.
  try {
    const lockRows = schGet_(url, key, '/rest/v1/payroll_locks?select=pay_date');
    const lockedDates = {};
    lockRows.forEach(function (l) { lockedDates[l.pay_date] = true; });
    // Recent manual unlocks → grace period.
    try {
      const unlockRows = schGet_(url, key, '/rest/v1/app_settings?select=value&key=eq.payroll_unlocks');
      const unlocks = (unlockRows[0] && unlockRows[0].value) || {};
      const graceMs = 24 * 3600 * 1000;
      for (const dt in unlocks) {
        if (Date.now() - new Date(unlocks[dt]).getTime() < graceMs) lockedDates[dt] = true;
      }
    } catch (e) { /* no unlock record — fine */ }
    const skipStatuses = { 'Canceled': 1, 'Cancelled': 1, 'Sales Issue': 1 };
    const runs = {};
    for (const d of deals) {
      if (!d.pay_date || d.pay_date >= todayISO) continue;   // only past-due runs
      if (skipStatuses[d.status]) continue;                  // never counts toward a run
      (runs[d.pay_date] = runs[d.pay_date] || []).push(d);
    }
    for (const dt in runs) {
      if (lockedDates[dt]) continue;
      if (!runs[dt].every(function (d) { return d.status === SCH_PAID_STATUS; })) continue;
      if (SCH_DRY_RUN) { out.locked++; out.details.push('WOULD AUTO-LOCK run ' + dt + ' (' + runs[dt].length + ' deals, all Paid)'); }
      else {
        try {
          schPost_(url, key, '/rest/v1/payroll_locks', { pay_date: dt, snapshot: { auto: true, deals: runs[dt].length } });
          out.locked++;
        } catch (e) { out.errors++; out.details.push('auto-lock ' + dt + ': ' + e.message); }
      }
    }
  } catch (e) { /* payroll_locks table not created yet (migration 028) — skip quietly */ }

  // ── JOBS PASS — create new deals & flag re-signed ones for review ──
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
      // A re-signed job leaves its OLD row on the tab next to the new one, and
      // both stay APPROVED. If both rows drive the deal, they fight: the old
      // row keeps flagging "Change Order" with the old numbers every time you
      // move the deal forward. So per customer, only the NEWEST row (latest
      // Approved Date; later sheet row wins ties) is allowed to touch the deal.
      const newestRow = {};
      for (let r = 1; r < rows.length; r++) {
        const cust = String(rows[r][ix.customer] || '').trim().toLowerCase();
        if (!cust) continue;
        const st = String(ix.status >= 0 ? rows[r][ix.status] : '').trim().toUpperCase();
        // Only APPROVED rows drive deals. A blank/pending status (e.g. an
        // unsigned ArcSite design that landed on the sheet) must NOT count — so
        // require an exact APPROVED match whenever a Status column exists.
        if (SCH_ONLY_STATUS && ix.status >= 0 && st !== SCH_ONLY_STATUS) continue;
        // Rows the sync would never import can't OWN a customer either — an
        // excluded rep's newer row must not shadow an older legit row (real
        // case: Ronnie's row blocked Juan Martinez's actual sale from importing).
        const rep0 = schCleanRep_(rows[r][ix.rep]).toLowerCase();
        if (SCH_EXCLUDE_REPS.some(function (x) { return rep0.indexOf(x) !== -1; })) continue;
        const when = schDate_(rows[r][ix.approved]) || '';
        const prev = newestRow[cust];
        if (!prev || when >= prev.when) newestRow[cust] = { r: r, when: when };
      }

      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const customer = String(row[ix.customer] || '').trim();
        if (!customer) { out.skipped++; continue; }
        if (SCH_SKIP_NAME_CONTAINS.some(x => customer.toLowerCase().indexOf(x) !== -1)) { out.skipped++; continue; }

        const status = String(ix.status >= 0 ? row[ix.status] : '').trim().toUpperCase();
        // Require an exact APPROVED match (when a Status column exists) so a
        // blank/pending row — an unsigned design ArcSite parked on the sheet —
        // can neither create a deal nor flag a change for review.
        if (SCH_ONLY_STATUS && ix.status >= 0 && status !== SCH_ONLY_STATUS) { out.skipped++; continue; }

        // Stale duplicate (older re-sign row) — the newest row owns this deal.
        const newest = newestRow[customer.toLowerCase()];
        if (newest && newest.r !== r) { out.skipped++; continue; }

        const projectId = String(row[ix.project] || '').trim() || String(ix.proposal >= 0 ? row[ix.proposal] : '').trim();
        if (!projectId) { out.skipped++; continue; }

        const repName = schCleanRep_(row[ix.rep]);
        const repLc = repName.toLowerCase();
        if (SCH_EXCLUDE_REPS.some(x => repLc.indexOf(x) !== -1)) { out.skipped++; continue; }

        const baselineVal = schMoney_(row[ix.baseline]);
        const saleVal     = schMoney_(row[ix.sale]);
        // Match by Project ID; fall back to customer name so a re-sign that
        // lands under a NEW Project/Proposal ID is still recognized as the same
        // deal (otherwise the re-sign would be silently missed).
        const existing    = byProject[projectId] || dealByName[customer.toLowerCase()];

        if (existing) {
          // The sheet's numbers changed since we last synced this deal
          // (synced_baseline/synced_job_price) — a re-signed agreement / new
          // version of the sale. The sync NO LONGER rewrites the deal for this
          // (no new numbers, no status flip, no un-gold-checking). It stamps
          // deals.change_alert (migration 031) with the old → new figures so
          // the deal wears a clearable ❗ flag on the Deals page; an admin
          // reviews it and either edits the deal by hand or dismisses it.
          // A manual in-app edit (sheet unchanged) or a duplicate row with the
          // same numbers still does nothing.
          const snapMissing  = existing.synced_baseline == null && existing.synced_job_price == null;
          const sheetChanged = !snapMissing &&
            (schChanged_(existing.synced_baseline, baselineVal) || schChanged_(existing.synced_job_price, saleVal));

          if (snapMissing) {
            // First time we've tracked this deal's sheet figures — adopt them
            // silently as the comparison baseline (no alert).
            if (!SCH_DRY_RUN) {
              try { schPatch_(url, key, '/rest/v1/deals?id=eq.' + existing.id, { synced_baseline: baselineVal, synced_job_price: saleVal });
                    Object.assign(existing, { synced_baseline: baselineVal, synced_job_price: saleVal }); }
              catch (e) { out.errors++; out.details.push(customer + ': ' + e.message); }
            }
            continue;
          }
          if (sheetChanged) {
            const patch = {
              change_alert: {
                prev_baseline: existing.synced_baseline, prev_job_price: existing.synced_job_price,
                baseline: baselineVal, job_price: saleVal,
                at: new Date().toISOString(),
              },
              // Advance the snapshot so this sheet version alerts ONCE — the
              // flag stays (even across syncs) until an admin dismisses it.
              synced_baseline: baselineVal, synced_job_price: saleVal,
            };
            // Re-point project_id when the re-sign came in under a new ID, so
            // future syncs (and the Schedule pass) still match this deal.
            if (projectId && existing.project_id !== projectId) patch.project_id = projectId;
            if (SCH_DRY_RUN) {
              out.changed++;
              out.details.push('WOULD FLAG for review — ' + customer + ' (base ' + existing.synced_baseline + '→' + baselineVal + ', sale ' + existing.synced_job_price + '→' + saleVal + ')');
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

        const newSaleDate = schDate_(row[ix.approved]);
        const deal = {
          deal_name: customer, sale_date: newSaleDate, status: SCH_NEW_STATUS,
          setter_id: rep.id, closer_id: rep.id, setter_split_pct: 1,
          // The deal's manager-override recipient — ONLY when the rep's
          // reports-to is an actual MANAGER. A rep managed directly by a
          // director/VP has no manager override (that person already earns
          // their own override; stamping them as manager would double-pay).
          manager_id: (rep.manager_id && profById[rep.manager_id] && profById[rep.manager_id].role === 'manager') ? rep.manager_id : null,
          director_id: directorId, vp_id: vpId,
          baseline_revenue: baselineVal, job_price: saleVal, project_id: projectId,
          // Snapshot of the sheet figures, so a later sheet change is detected
          // and flagged for review (vs. a manual edit, which is ignored).
          synced_baseline: baselineVal, synced_job_price: saleVal,
          // Rate-schedule defaults for the deal's sale date (office unknown at
          // sold-time → the era's default; the Schedule pass corrects
          // Director/VP to the office rate).
          manager_override_pct: schManagerRate_(newSaleDate),
          director_override_pct: schOfficeRate_('', newSaleDate),
          vp_override_pct: schOfficeRate_('', newSaleDate),
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
        // A CANCELLED schedule row no longer changes the deal — the site status
        // is left alone and you cancel manually if needed.
        if (status === 'CANCELLED') { out.skipped++; continue; }

        // Don't re-apply schedule info to finalized/triaged deals (Paid, Pay
        // Finalized, Sales Issue, Canceled) OR to a gold-checked deal — once you
        // verify a deal, ALL of its fields (install/pay dates, payment, office,
        // override %s, setter/closer) are locked from the sheet. Un-check the
        // gold seal to let the sync manage it again.
        if (SCH_LOCKED_STATUSES.indexOf(existing.status) !== -1 || existing.commission_verified === true) { out.skipped++; continue; }

        // Dates/payment/office only come from active (BOOKED/blank) rows. The
        // SETTER applies from any non-cancelled row — Lead Source is often
        // filled in after the row has already moved past BOOKED (e.g.
        // COMPLETED), and skipping those rows silently dropped the setter.
        const layerAll = !status || status === 'BOOKED';

        const patch = {};
        if (layerAll) {
          const installDate = schDate_(row[ix.install]);
          const payDate = installDate ? schPayDate_(installDate) : null;
          const payment = schPayment_(row[ix.payment]);
          const office  = officeIx >= 0 ? schTitle_(row[officeIx]) : null;

          if (installDate && existing.install_date   !== installDate) patch.install_date   = installDate;
          if (payDate     && existing.pay_date       !== payDate)     patch.pay_date       = payDate;
          if (payment     && existing.payment_method !== payment)     patch.payment_method = payment;
          const officeChanged = office && existing.office !== office;
          if (officeChanged) patch.office = office;

          // Override % from the rate schedule for THIS deal's sale date (so an
          // old deal re-officed today still gets the rate in force when it
          // closed). Backfill nulls; recompute Director/VP when the office is
          // first set/changed.
          const rate = schOfficeRate_(office, existing.sale_date);
          if (existing.manager_override_pct  == null) patch.manager_override_pct  = schManagerRate_(existing.sale_date);
          if (existing.director_override_pct == null || officeChanged) patch.director_override_pct = rate;
          if (existing.vp_override_pct       == null || officeChanged) patch.vp_override_pct       = rate;
        }

        // Real setter from Lead Source; the Sales Rep closes. Resolve names
        // leniently ("JC" → "JC Correa") so a first-name-only setter still
        // updates the deal.
        const setterName = schParseSetter_(row[ix.lead]);
        if (setterName) {
          const sp = schResolvePerson_(setterName, profiles);
          if (sp) {
            const cp = schResolvePerson_(schCleanRep_(row[ix.rep]), profiles);
            const closerId = (cp && cp.id) ? cp.id : (existing.closer_id || sp.id);
            if (existing.setter_id !== sp.id) {
              patch.setter_id = sp.id; patch.closer_id = closerId; patch.setter_split_pct = (sp.id === closerId ? 1 : 0.5);
            }
          } else {
            out.details.push('Setter "' + setterName + '" on ' + (existing.deal_name || projectId) + ' — no roster match');
          }
        } else if (/setter/i.test(String(row[ix.lead] || ''))) {
          // The cell clearly names a setter but the parser couldn't read it —
          // surface the raw text so format drift is visible instead of silent.
          out.details.push('Could not parse setter from Lead Source "' + row[ix.lead] + '" — ' + (existing.deal_name || projectId));
        }

        if (!Object.keys(patch).length) { out.skipped++; continue; }
        if (SCH_DRY_RUN) { out.updated++; out.details.push('WOULD UPDATE — ' + (existing.deal_name || projectId) + ' ' + JSON.stringify(patch)); }
        else { try { schPatch_(url, key, '/rest/v1/deals?id=eq.' + existing.id, patch); Object.assign(existing, patch); out.updated++; } catch (e) { out.errors++; out.details.push((existing.deal_name || projectId) + ': ' + e.message); } }
      }
    }
  }

  Logger.log((SCH_DRY_RUN ? '[DRY RUN — nothing written] ' : '') +
    'Sync — created ' + out.created + ', flagged ' + out.changed + ', updated ' + out.updated +
    ', paid ' + out.paid + ', skipped ' + out.skipped + ', errors ' + out.errors);
  if (out.details.length) Logger.log(out.details.join('\n'));
  schHeartbeat_(url, key, out);
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

// Stamp app_settings with this run's outcome so the Admin page can show sync
// health — including whether the script is stuck in DRY_RUN (preview) mode.
// Best-effort: a heartbeat failure must never break the sync itself.
function schHeartbeat_(url, key, out) {
  try {
    schFetch_(url + '/rest/v1/app_settings?on_conflict=key', {
      method: 'post', contentType: 'application/json',
      headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'resolution=merge-duplicates,return=minimal' },
      payload: JSON.stringify({ key: 'sync_heartbeat', value: {
        at: new Date().toISOString(), dry_run: SCH_DRY_RUN,
        created: out.created, changed: out.changed, updated: out.updated,
        paid: out.paid, errors: out.errors,
      } }),
      muteHttpExceptions: true,
    });
  } catch (e) { Logger.log('Heartbeat failed: ' + e.message); }
}

// ── PARSERS ─────────────────────────────────────────────────
// ── Rate schedule (app_settings.override_rates, set per run in schSync) ─────
// Eras: { effective, manager, default, byOffice: { <office lc>: pct } } with
// HUMAN percents (3.75 = 3.75%). Era = last one effective on/before saleDate.
var SCH_RATES = null;
function schEraFor_(saleDate) {
  if (!SCH_RATES || !SCH_RATES.length) return null;
  const d = saleDate || new Date().toISOString().slice(0, 10);
  var era = SCH_RATES[0];
  for (var i = 0; i < SCH_RATES.length; i++) {
    if (String(SCH_RATES[i].effective || '') <= d) era = SCH_RATES[i]; else break;
  }
  return era;
}
function schOfficeRate_(office, saleDate) {
  const era = schEraFor_(saleDate);
  if (era) {
    const o = String(office || '').trim().toLowerCase();
    const v = era.byOffice && era.byOffice[o] != null ? era.byOffice[o] : era['default'];
    return ((Number(v) || 0) / 100) || 0.05;
  }
  return String(office || '').toLowerCase() === 'tucson' ? 0.0375 : 0.05;
}
function schManagerRate_(saleDate) {
  const era = schEraFor_(saleDate);
  return era && era.manager != null ? (Number(era.manager) || 0) / 100 : 0.03;
}
function schChanged_(stored, sheetVal) {
  if (sheetVal == null) return false;                     // missing sheet value → don't wipe
  return Math.abs((Number(stored) || 0) - (Number(sheetVal) || 0)) > 0.5;
}
// Pull the setter's name out of a Lead Source cell. The marker can appear
// anywhere, with ":", "-", "–", "—" or "=" after it: "Setter: JC",
// "Self Gen - Setter- JC", "SETTER = JC Correa (referral)". The name capture
// stops at a trailing delimiter so notes after the name don't break matching.
function schParseSetter_(v) {
  const m = String(v || '').match(/setter\s*[:\-–—=]\s*([^,;|/()\[\]]+)/i);
  return m ? m[1].trim() : null;
}
function schCleanRep_(v) { return String(v || '').replace(/\s*\(.*$/, '').trim(); }
// Resolve a sheet name to a roster profile. Exact full-name match first, then a
// UNIQUE first-name / "starts with" match so "JC" → "JC Correa" and
// "Jean Carlo" → "Jean Carlo Correa". Returns null if nothing matches or the
// match is ambiguous (more than one candidate) — never guesses.
function schResolvePerson_(rawName, profiles) {
  const name = String(rawName || '').trim().toLowerCase();
  if (!name) return null;
  const exact = profiles.find(p => p.name && p.name.trim().toLowerCase() === name);
  if (exact) return exact;
  const cands = profiles.filter(p => {
    const pn = String(p.name || '').trim().toLowerCase();
    return pn && (pn.startsWith(name + ' ') || pn.split(' ')[0] === name);
  });
  return cands.length === 1 ? cands[0] : null;
}
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
// Pay date from install date, per the admin-configurable rule (Admin →
// Settings → Pay Date Rule): { day: 1..7 Mon..Sun, weeks_after } → that
// weekday of the Nth week after the install week. Default = Friday of the
// week after install (Monday + 11), matching history.
var SCH_PAY_RULE = null;
function schPayDate_(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T12:00:00Z');
  if (isNaN(d.getTime())) return null;
  const dow = d.getUTCDay();
  const offset = (dow === 0 ? 7 : dow) - 1;
  const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - offset);
  const rule = SCH_PAY_RULE || { day: 5, weeks_after: 1 };
  const pay = new Date(monday); pay.setUTCDate(monday.getUTCDate() + rule.weeks_after * 7 + (rule.day - 1));
  return pay.toISOString().slice(0, 10);
}

// ── SUPABASE HELPERS ────────────────────────────────────────
// All HTTP goes through schFetch_, which retries transient network failures
// ("Address unavailable", timeouts — Railway/Kong blips) with short backoff.
// Without this, a one-second blip kills the whole run and Google emails a
// failure digest, even though the next minute's run succeeds anyway.
function schFetch_(fullUrl, options) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) Utilities.sleep(500 * attempt);   // 0.5s, then 1s
    try { return UrlFetchApp.fetch(fullUrl, options); }
    catch (e) { lastErr = e; }                     // network-level failure — retry
  }
  throw lastErr;
}
function schGet_(url, key, path) {
  const resp = schFetch_(url + path, { method: 'get', headers: { apikey: key, Authorization: 'Bearer ' + key }, muteHttpExceptions: true });
  if (resp.getResponseCode() >= 300) throw new Error('GET ' + path + ' failed: ' + resp.getContentText());
  return JSON.parse(resp.getContentText());
}
function schPost_(url, key, path, payload) {
  const resp = schFetch_(url + path, { method: 'post', contentType: 'application/json', headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'return=minimal' }, payload: JSON.stringify(payload), muteHttpExceptions: true });
  if (resp.getResponseCode() >= 300) throw new Error('Insert failed: ' + resp.getContentText());
}
function schPatch_(url, key, path, payload) {
  const resp = schFetch_(url + path, { method: 'patch', contentType: 'application/json', headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'return=minimal' }, payload: JSON.stringify(payload), muteHttpExceptions: true });
  if (resp.getResponseCode() >= 300) throw new Error('Patch failed: ' + resp.getContentText());
}

// ── DIAGNOSE — why didn't a customer import? ─────────────────
// Run schDiagnose from the Apps Script editor with the customer's name (edit
// the default below or call schDiagnose('Juan Martinez') from a scratch
// function), then read the Execution log. It walks every Jobs row matching
// that name through the exact same gates as the real sync and prints which
// one skips it. Read-only — writes nothing.
function schDiagnose(name) {
  name = String(name || 'Juan Martinez').trim().toLowerCase();
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SUPABASE_URL');
  const key = props.getProperty('SUPABASE_SERVICE_KEY');
  const log = (m) => Logger.log(m);

  log('Diagnosing "' + name + '" · DRY_RUN=' + SCH_DRY_RUN + (SCH_DRY_RUN ? '  ⚠ sync is in PREVIEW mode — it writes NOTHING' : ''));

  // Same config the sync loads.
  try {
    const cfg = schGet_(url, key, '/rest/v1/app_settings?select=key,value&key=in.(sync_excluded_reps,sync_skip_names)');
    cfg.forEach(function (row) {
      if (row.key === 'sync_excluded_reps' && Array.isArray(row.value)) SCH_EXCLUDE_REPS = row.value.map(function (s) { return String(s).trim().toLowerCase(); }).filter(Boolean);
      if (row.key === 'sync_skip_names' && Array.isArray(row.value)) SCH_SKIP_NAME_CONTAINS = row.value.map(function (s) { return String(s).trim().toLowerCase(); }).filter(Boolean);
    });
  } catch (e) { /* defaults */ }

  const profiles = schGet_(url, key, '/rest/v1/profiles?select=id,name,role');
  const byName = {};
  profiles.forEach(function (p) { if (p && p.name) byName[String(p.name).trim().toLowerCase()] = p; });
  const deals = schGet_(url, key, '/rest/v1/deals?select=id,project_id,deal_name,status,synced_baseline,synced_job_price');
  const byProject = {}, dealByName = {};
  deals.forEach(function (d) {
    if (d.project_id) byProject[String(d.project_id)] = d;
    if (d.deal_name) dealByName[String(d.deal_name).trim().toLowerCase()] = d;
  });
  const ignoreCreate = (props.getProperty(SCH_BASELINE_PROP) || '').split(',').filter(Boolean);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rows = ss.getSheetByName(SCH_JOBS_TAB).getDataRange().getDisplayValues();
  const h = rows[0].map(function (x) { return String(x).trim(); });
  const c = function (n) { return h.indexOf(n); };
  const ix = { approved: c('Approved Date'), customer: c('Customer'), rep: c('Sales Rep'),
    baseline: c('Baseline Cost'), sale: c('Pre-Tax Sale'), project: c('Project ID'), proposal: c('Proposal ID'), status: c('Status') };

  // Newest importable APPROVED row per customer (same as the sync — rows the
  // sync would never import, e.g. an excluded rep's, can't own the customer).
  const newestRow = {};
  for (var r = 1; r < rows.length; r++) {
    const cust = String(rows[r][ix.customer] || '').trim().toLowerCase();
    if (!cust) continue;
    const st = String(ix.status >= 0 ? rows[r][ix.status] : '').trim().toUpperCase();
    if (SCH_ONLY_STATUS && ix.status >= 0 && st !== SCH_ONLY_STATUS) continue;
    const rep0 = schCleanRep_(rows[r][ix.rep]).toLowerCase();
    if (SCH_EXCLUDE_REPS.some(function (x) { return rep0.indexOf(x) !== -1; })) continue;
    const when = schDate_(rows[r][ix.approved]) || '';
    const prev = newestRow[cust];
    if (!prev || when >= prev.when) newestRow[cust] = { r: r, when: when };
  }

  var found = 0;
  for (var r2 = 1; r2 < rows.length; r2++) {
    const row = rows[r2];
    const customer = String(row[ix.customer] || '').trim();
    if (!customer || customer.toLowerCase().indexOf(name) === -1) continue;
    found++;
    const pfx = 'Row ' + (r2 + 1) + ' ("' + customer + '"): ';
    const status = String(ix.status >= 0 ? row[ix.status] : '').trim().toUpperCase();
    if (SCH_SKIP_NAME_CONTAINS.some(function (x) { return customer.toLowerCase().indexOf(x) !== -1; })) { log(pfx + 'SKIPPED — name matches the junk/skip list (' + SCH_SKIP_NAME_CONTAINS.join(', ') + ')'); continue; }
    if (SCH_ONLY_STATUS && ix.status >= 0 && status !== SCH_ONLY_STATUS) { log(pfx + 'SKIPPED — Status is "' + (row[ix.status] || '(blank)') + '", needs exactly ' + SCH_ONLY_STATUS); continue; }
    const newest = newestRow[customer.toLowerCase()];
    if (newest && newest.r !== r2) { log(pfx + 'SKIPPED — an APPROVED row with a newer Approved Date exists for this customer (row ' + (newest.r + 1) + ' drives the deal)'); continue; }
    const projectId = String(row[ix.project] || '').trim() || String(ix.proposal >= 0 ? row[ix.proposal] : '').trim();
    if (!projectId) { log(pfx + 'SKIPPED — no Project ID or Proposal ID on the row'); continue; }
    const repName = schCleanRep_(row[ix.rep]);
    if (SCH_EXCLUDE_REPS.some(function (x) { return repName.toLowerCase().indexOf(x) !== -1; })) { log(pfx + 'SKIPPED — Sales Rep "' + repName + '" is on the excluded-reps list'); continue; }
    const existing = byProject[projectId] || dealByName[customer.toLowerCase()];
    if (existing) {
      const how = byProject[projectId] ? 'Project ID' : 'CUSTOMER NAME';
      const snapMissing = existing.synced_baseline == null && existing.synced_job_price == null;
      const changed = !snapMissing && (schChanged_(existing.synced_baseline, schMoney_(row[ix.baseline])) || schChanged_(existing.synced_job_price, schMoney_(row[ix.sale])));
      log(pfx + 'MATCHED AN EXISTING DEAL by ' + how + ' → deal "' + existing.deal_name + '" (status ' + existing.status + ', project ' + (existing.project_id || 'none') + '). '
        + (snapMissing ? 'No sheet snapshot yet — the sync adopts these numbers silently, no new deal.'
           : changed ? 'Sheet numbers differ from the snapshot — the sync FLAGS that existing deal for review (❗ on the Deals page), no new deal and nothing on it changes.'
                     : 'Numbers match the snapshot — nothing to do, no new deal.')
        + ' If this is genuinely a DIFFERENT job for the same customer, rename one (e.g. "Juan Martinez 2") or give it a distinct Project ID.');
      continue;
    }
    if (ignoreCreate.indexOf(projectId) !== -1) { log(pfx + 'SKIPPED — Project ID ' + projectId + ' is in the baseline ignore list (schBaselineNow was run after this job landed). Remove it from the SCHED_BASELINE_IDS script property to import.'); continue; }
    if (!byName[repName.toLowerCase()]) { log(pfx + 'SKIPPED — Sales Rep "' + repName + '" doesn\'t match any roster name. Fix the sheet name or the roster.'); continue; }
    log(pfx + 'WOULD CREATE ✓ — nothing blocks this row. If it still isn\'t in the site, check System Health (DRY_RUN / sync stalled / errors).');
  }
  if (!found) log('No Jobs row found containing "' + name + '" — check the spelling/tab.');
}
