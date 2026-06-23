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
 *   • Frontend crashes   — new rows in client_errors in the last 24h.
 *   • Permission changes — a role / admin flag / active state changed, or an
 *                          account was added/removed (privilege-escalation watch).
 *
 * It is a SITE/BACKEND sentry only — it does NOT report on deal/payroll status
 * (overdue deals, below-baseline pricing, missing fields). Those are surfaced
 * in-app (the Payroll banners, the Deals "Needs review" tab), where they belong.
 *
 * Note: it watches the server side (the DB + site). It can't see what a given
 * user's browser renders, so a UI-only permission leak is guarded by the app's
 * role-gating + RLS, not here — but any change to WHO has what access is caught.
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

  // ── 4. Frontend crashes (last 24h) ────────────────────────
  try {
    const since = new Date(Date.now() - 24 * 3600000).toISOString();
    const errs = wdGet_(url, key, '/rest/v1/client_errors?select=message,path,at&at=gte.' + since + '&order=at.desc&limit=10');
    if (errs.length) {
      const uniq = [...new Set(errs.map(e2 => (e2.path || '?') + ': ' + (e2.message || '').slice(0, 80)))];
      add('WARN', errs.length + ' frontend error(s) in the last 24h — ' + uniq.slice(0, 3).join(' | '));
    }
  } catch (e) { /* table may not exist until migration 020 runs — fine */ }

  // ── 5. Permission / roster changes ────────────────────────
  // Snapshot every profile's role + admin flag + active state and alert when it
  // changes between runs — catches privilege escalation (e.g. a rep suddenly
  // is_admin), a role flip, a deactivated account coming back, or new/removed
  // accounts. (RLS + the app's role-gating control what each person can SEE;
  // this watches WHO has what access.)
  try {
    const profs = wdGet_(url, key, '/rest/v1/profiles?select=id,name,role,is_admin,active');
    const sig = {};
    profs.forEach(p => {
      sig[p.id] = [p.name || '?', p.role || '?', p.is_admin === true ? 'A' : '-', p.active === false ? 'off' : 'on'].join('|');
    });
    const prev = JSON.parse(props.getProperty('WATCHDOG_PERMS') || 'null');
    if (prev) {
      const changes = [];
      Object.keys(sig).forEach(id => {
        if (!prev[id]) { const b = sig[id].split('|'); changes.push(b[0] + ': new account (' + b[1] + (b[2] === 'A' ? ', ADMIN' : '') + ')'); return; }
        if (prev[id] === sig[id]) return;
        const a = prev[id].split('|'), b = sig[id].split('|'), p = [];
        if (a[1] !== b[1]) p.push('role ' + a[1] + ' → ' + b[1]);
        if (a[2] !== b[2]) p.push(b[2] === 'A' ? 'ADMIN GRANTED' : 'admin removed');
        if (a[3] !== b[3]) p.push(b[3] === 'off' ? 'deactivated' : 'reactivated');
        changes.push(b[0] + ': ' + p.join(', '));
      });
      Object.keys(prev).forEach(id => { if (!sig[id]) changes.push(prev[id].split('|')[0] + ': account removed'); });
      if (changes.length) add('CRIT', 'Permission/roster change — ' + changes.join(' · '));
    }
    props.setProperty('WATCHDOG_PERMS', JSON.stringify(sig));
  } catch (e) { add('WARN', 'Permission check failed: ' + e.message); }

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
