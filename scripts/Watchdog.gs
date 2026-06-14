/**
 * Turf Time — Watchdog (the sentry)
 *
 * Runs hourly, scans for problems, and EMAILS you a digest when something is
 * wrong. It detects + notifies; it never edits data (automation that silently
 * "fixes" money data is how payroll errors hide).
 *
 * What it checks each run:
 *   • Site up?           — fetches the frontend URL.
 *   • Sync healthy?      — sync_heartbeat fresh, not stuck in DRY_RUN, no errors.
 *   • Backup healthy?    — backup_heartbeat within ~26h.
 *   • Payday hygiene     — deals paying within 7 days that are missing office /
 *                          payment / install date, or aren't gold-checked yet.
 *   • Overdue deals      — pay date in the past but never finalized/paid.
 *   • Data smells        — active deals where job price < baseline (negative pool).
 *   • Frontend crashes   — new rows in client_errors in the last 24h.
 *
 * Emails only when the findings CHANGE (no hourly nagging about the same
 * thing), and writes watchdog_heartbeat to app_settings so the Admin page's
 * System Health card shows the latest result.
 *
 * Setup (in the SAME Apps Script project as ScheduleSync — reuses its keys):
 *   1. Paste this file, save.
 *   2. Project Settings → Script properties → add:
 *        ALERT_EMAIL   = you@company.com   (where digests go)
 *        FRONTEND_URL  = https://your-dashboard.up.railway.app
 *   3. Run watchdogRun() once to authorize (needs mail permission).
 *   4. Triggers → watchdogRun → Time-driven → Hour timer → every hour.
 */

function watchdogRun() {
  const props = PropertiesService.getScriptProperties();
  const url   = props.getProperty('SUPABASE_URL');
  const key   = props.getProperty('SUPABASE_SERVICE_KEY');
  const email = props.getProperty('ALERT_EMAIL');
  const site  = props.getProperty('FRONTEND_URL');
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');

  const issues = [];   // { sev: 'CRIT'|'WARN', text }
  const add = (sev, text) => issues.push({ sev: sev, text: text });

  // ── 1. Site up? ───────────────────────────────────────────
  if (site) {
    try {
      const r = UrlFetchApp.fetch(site, { muteHttpExceptions: true, followRedirects: true });
      if (r.getResponseCode() >= 500) add('CRIT', 'Site returned HTTP ' + r.getResponseCode() + ' — frontend may be down');
    } catch (e) {
      add('CRIT', 'Site unreachable: ' + e.message);
    }
  }

  // ── 2/3. Heartbeats ───────────────────────────────────────
  try {
    const settings = wdGet_(url, key, '/rest/v1/app_settings?select=key,value&key=in.(sync_heartbeat,backup_heartbeat)');
    const byKey = {};
    settings.forEach(s => { byKey[s.key] = s.value; });

    const hb = byKey.sync_heartbeat;
    if (!hb || !hb.at) add('WARN', 'Scheduler sync has never reported a heartbeat');
    else {
      const mins = (Date.now() - new Date(hb.at).getTime()) / 60000;
      if (hb.dry_run)     add('CRIT', 'Scheduler sync is in DRY_RUN (preview) mode — running but writing NOTHING');
      else if (mins > 15) add('CRIT', 'Scheduler sync stalled — last ran ' + Math.round(mins) + ' min ago');
      else if (hb.errors > 0) add('WARN', 'Scheduler sync logged ' + hb.errors + ' error(s) on its last run');
    }

    const bk = byKey.backup_heartbeat;
    if (bk && bk.at) {
      const hrs = (Date.now() - new Date(bk.at).getTime()) / 3600000;
      if (hrs > 26) add('WARN', 'Nightly backup overdue — last ran ' + Math.round(hrs) + 'h ago');
      else if (bk.errors > 0) add('WARN', 'Last backup had ' + bk.errors + ' table error(s)');
    }
  } catch (e) { add('WARN', 'Could not read heartbeats: ' + e.message); }

  // ── 4–6. Data hygiene ─────────────────────────────────────
  try {
    const soon = wdISO_(7), today = wdISO_(0);
    // UrlFetchApp rejects raw quotes/spaces in URLs — every quoted PostgREST
    // list value must be percent-encoded (wdList_).
    const active = 'status=not.in.(' + wdList_(['Canceled', 'Cancelled', 'Sales Issue']) + ')';
    const sel = 'select=deal_name,status,office,payment_method,install_date,pay_date,commission_verified,baseline_revenue,job_price';

    // Legacy cutoff: deals closed before data_start_date predate our atomized
    // data and are intentionally NOT nagged about in the background (overdue /
    // negative-pool). They still surface in the "paying within 7 days" checks
    // below, so they're flagged once they actually approach payout.
    const dataStart = wdDataStart_(url, key);
    const notLegacy = dataStart ? '&sale_date=gte.' + dataStart : '';

    // Deals paying within 7 days (kept unfiltered — these ARE the pay-time prompts)
    const paying = wdGet_(url, key, '/rest/v1/deals?' + sel + '&pay_date=lte.' + soon + '&pay_date=gte.' + today + '&' + active);
    const missing = paying.filter(d => !d.office || !d.payment_method || !d.install_date);
    if (missing.length) add('WARN', missing.length + ' deal(s) paying within 7 days missing office/payment/install: ' +
      wdNames_(missing));
    const unverified = paying.filter(d => d.commission_verified !== true && d.status !== 'Paid');
    if (unverified.length) add('WARN', unverified.length + ' deal(s) paying within 7 days not gold-checked: ' +
      wdNames_(unverified));

    // Overdue: pay date passed, never finalized (legacy deals excluded)
    const overdue = wdGet_(url, key, '/rest/v1/deals?' + sel + '&pay_date=lt.' + today + notLegacy +
      '&status=not.in.(' + wdList_(['Paid', 'Pay Finalized', 'Canceled', 'Cancelled', 'Sales Issue']) + ')');
    if (overdue.length) add('WARN', overdue.length + ' deal(s) past their pay date but never finalized: ' + wdNames_(overdue));

    // Negative rep pool (price below baseline) on active deals (legacy excluded)
    const all = wdGet_(url, key, '/rest/v1/deals?select=deal_name,baseline_revenue,job_price&' + active + notLegacy);
    const negative = all.filter(d => Number(d.job_price) > 0 && Number(d.job_price) < Number(d.baseline_revenue) - 0.5);
    if (negative.length) add('WARN', negative.length + ' deal(s) priced BELOW baseline (negative rep pool): ' + wdNames_(negative));
  } catch (e) { add('WARN', 'Data checks failed: ' + e.message); }

  // ── 7. Frontend crashes (last 24h) ────────────────────────
  try {
    const since = new Date(Date.now() - 24 * 3600000).toISOString();
    const errs = wdGet_(url, key, '/rest/v1/client_errors?select=message,path,at&at=gte.' + since + '&order=at.desc&limit=10');
    if (errs.length) {
      const uniq = [...new Set(errs.map(e2 => (e2.path || '?') + ': ' + (e2.message || '').slice(0, 80)))];
      add('WARN', errs.length + ' frontend error(s) in the last 24h — ' + uniq.slice(0, 3).join(' | '));
    }
  } catch (e) { /* table may not exist until migration 020 runs — fine */ }

  // ── Report ────────────────────────────────────────────────
  const summary = issues.map(i => '[' + i.sev + '] ' + i.text);
  wdHeartbeat_(url, key, summary);

  // Email only when the findings change (incl. recovering to zero).
  const hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, summary.join('\n') || 'CLEAR'));
  const last = props.getProperty('WATCHDOG_LAST_HASH');
  if (email && hash !== last) {
    props.setProperty('WATCHDOG_LAST_HASH', hash);
    if (issues.length) {
      const crit = issues.some(i => i.sev === 'CRIT');
      MailApp.sendEmail({
        to: email,
        subject: (crit ? '🚨' : '⚠️') + ' Turf Time Watchdog: ' + issues.length + ' issue' + (issues.length === 1 ? '' : 's'),
        body: 'The Watchdog found:\n\n' + summary.join('\n\n') +
              '\n\nDetails: Admin → System Health on the dashboard.\nThis email repeats only when the findings change.',
      });
    } else if (last) {
      MailApp.sendEmail({ to: email, subject: '✅ Turf Time Watchdog: all clear', body: 'Previous issues are resolved. Nothing outstanding.' });
    }
  }

  Logger.log('Watchdog — ' + (issues.length ? summary.join(' | ') : 'all clear'));
  return summary;
}

// ── helpers ─────────────────────────────────────────────────
function wdGet_(url, key, path) {
  const r = UrlFetchApp.fetch(url + path, {
    method: 'get', headers: { apikey: key, Authorization: 'Bearer ' + key }, muteHttpExceptions: true,
  });
  if (r.getResponseCode() >= 300) throw new Error('HTTP ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 120));
  return JSON.parse(r.getContentText());
}
// '"A","B C"' percent-encoded for a PostgREST in.() list (quotes + spaces).
function wdList_(values) {
  return values.map(function (v) { return '%22' + encodeURIComponent(v) + '%22'; }).join(',');
}
// The admin-set legacy cutoff (app_settings.data_start_date, a JSON string
// like "2026-06-01"). Returns '' if unset so callers skip the filter.
function wdDataStart_(url, key) {
  try {
    const rows = wdGet_(url, key, '/rest/v1/app_settings?select=value&key=eq.data_start_date');
    const v = rows && rows[0] ? rows[0].value : null;
    return (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : '';
  } catch (e) { return ''; }
}
function wdISO_(daysAhead) {
  const d = new Date(); d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}
function wdNames_(deals) {
  const names = deals.map(d => d.deal_name).slice(0, 6).join(', ');
  return names + (deals.length > 6 ? ' (+' + (deals.length - 6) + ' more)' : '');
}
function wdHeartbeat_(url, key, summary) {
  try {
    UrlFetchApp.fetch(url + '/rest/v1/app_settings?on_conflict=key', {
      method: 'post', contentType: 'application/json',
      headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'resolution=merge-duplicates,return=minimal' },
      payload: JSON.stringify({ key: 'watchdog_heartbeat', value: { at: new Date().toISOString(), issues: summary } }),
      muteHttpExceptions: true,
    });
  } catch (e) { Logger.log('Watchdog heartbeat failed: ' + e.message); }
}
