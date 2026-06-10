/**
 * Turf Time — Daily Supabase → Google Sheets backup
 *
 * Dumps every table to a brand-new, date-stamped Google Sheet in a Drive folder,
 * one tab per table, and prunes old backups. This is a secondary, off-platform,
 * human-readable copy of all your data — separate from (and in addition to) any
 * database-level backup on Railway.
 *
 * Setup:
 *   1. Paste this file into your Apps Script project (the same one that runs
 *      Sync.gs / ScheduleSync.gs — it reuses the same Script Properties).
 *   2. Confirm Script Properties has SUPABASE_URL and SUPABASE_SERVICE_KEY.
 *   3. Run backupNow() once to authorize (it will ask for Drive permission).
 *   4. Triggers → backupNow → Time-driven → Day timer → e.g. 2–3am.
 *
 * Restore: open the backup sheet for the day you want, copy the table's rows,
 * and re-import (or hand them to Claude / your DB tool). Each tab's first row is
 * the exact column names; JSON columns (e.g. checklist) are stored as JSON text.
 */

// ── CONFIG ──────────────────────────────────────────────────
// Every table to back up. Add new tables here as the schema grows.
const BK_TABLES = [
  'profiles',
  'deals',
  'payments',
  'monthly_goals',
  'weekly_stats',
  'app_settings',
  'competitions',
];
const BK_FOLDER  = 'Turf Time Backups';   // Drive folder (created if missing)
const BK_PREFIX  = 'Turf Time Backup ';   // file name prefix + timestamp
const BK_KEEP    = 30;                     // how many recent backups to retain
const BK_PAGE    = 1000;                   // rows fetched per request (paginated)

// ── ENTRY POINT (put this on the daily trigger) ─────────────
function backupNow() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SUPABASE_URL');
  const key = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in Script Properties');

  const tz   = Session.getScriptTimeZone();
  const name = BK_PREFIX + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  const ss   = SpreadsheetApp.create(name);

  const summary = [];
  for (const table of BK_TABLES) {
    try {
      const rows = bkFetchAll_(url, key, table);
      bkWriteTable_(ss, table, rows);
      summary.push(table + ': ' + rows.length);
    } catch (e) {
      bkWriteError_(ss, table, e.message);
      summary.push(table + ': ERROR ' + e.message);
    }
  }

  // Drop the default empty "Sheet1" once real tabs exist.
  const def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

  // File it in the backups folder and trim old ones.
  const folder = bkFolder_();
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  bkPrune_(folder);

  bkHeartbeat_(url, key, summary);
  Logger.log('Backup complete → ' + name + '\n' + summary.join('\n'));
  return summary;
}

// Stamp app_settings so the Admin page can show backup health.
// Best-effort: a heartbeat failure must never break the backup itself.
function bkHeartbeat_(url, key, summary) {
  try {
    UrlFetchApp.fetch(url + '/rest/v1/app_settings?on_conflict=key', {
      method: 'post', contentType: 'application/json',
      headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'resolution=merge-duplicates,return=minimal' },
      payload: JSON.stringify({ key: 'backup_heartbeat', value: {
        at: new Date().toISOString(),
        errors: summary.filter(s => s.indexOf('ERROR') !== -1).length,
        summary: summary.join(', ').slice(0, 500),
      } }),
      muteHttpExceptions: true,
    });
  } catch (e) { Logger.log('Heartbeat failed: ' + e.message); }
}

// ── FETCH (paginated so large tables come through whole) ─────
function bkFetchAll_(url, key, table) {
  let from = 0, all = [];
  while (true) {
    const resp = UrlFetchApp.fetch(
      url + '/rest/v1/' + table + '?select=*&limit=' + BK_PAGE + '&offset=' + from, {
        method: 'get',
        headers: { apikey: key, Authorization: 'Bearer ' + key },
        muteHttpExceptions: true,
      });
    const code = resp.getResponseCode();
    if (code >= 300) throw new Error('HTTP ' + code + ' ' + resp.getContentText().slice(0, 200));
    const batch = JSON.parse(resp.getContentText());
    all = all.concat(batch);
    if (batch.length < BK_PAGE) break;   // last page
    from += BK_PAGE;
  }
  return all;
}

// ── WRITE one table to its own tab ──────────────────────────
function bkWriteTable_(ss, table, rows) {
  const sheet = ss.insertSheet(table);
  if (!rows.length) { sheet.getRange(1, 1).setValue('(no rows)'); return; }

  // Column set = union of all keys across rows, so nothing is dropped.
  const colMap = {};
  rows.forEach(r => Object.keys(r).forEach(k => { colMap[k] = true; }));
  const cols = Object.keys(colMap);

  const data = [cols];
  for (const r of rows) {
    data.push(cols.map(c => {
      const v = r[c];
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return JSON.stringify(v);   // jsonb (e.g. checklist)
      return v;
    }));
  }
  sheet.getRange(1, 1, data.length, cols.length).setValues(data);
  sheet.setFrozenRows(1);
}

function bkWriteError_(ss, table, msg) {
  const sheet = ss.insertSheet(table);
  sheet.getRange(1, 1, 2, 1).setValues([['BACKUP FAILED'], [msg]]);
}

// ── DRIVE folder + retention ────────────────────────────────
function bkFolder_() {
  const it = DriveApp.getFoldersByName(BK_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(BK_FOLDER);
}

function bkPrune_(folder) {
  const files = [];
  const it = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(BK_PREFIX) === 0) files.push(f);
  }
  files.sort((a, b) => b.getDateCreated() - a.getDateCreated());   // newest first
  for (let i = BK_KEEP; i < files.length; i++) files[i].setTrashed(true);
}
