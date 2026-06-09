/**
 * Turf Time — Daily Supabase → Google Sheets backup (no Drive permission needed)
 *
 * Writes every table into ONE backup spreadsheet you create yourself, one tab
 * per table, overwriting each run. Point-in-time restore comes from the sheet's
 * built-in Version history (File → Version history → See version history), which
 * Workspace keeps in detail — so you can roll back to any prior day.
 *
 * This version deliberately avoids the restricted Google Drive scope (creating
 * files/folders), so it works on locked-down Workspace accounts. It only needs
 * the ordinary spreadsheet permission.
 *
 * Setup:
 *   1. Create a blank Google Sheet in your Drive, name it e.g. "Turf Time Backup".
 *   2. Copy its ID from the URL:
 *        docs.google.com/spreadsheets/d/THIS_LONG_ID/edit
 *   3. Apps Script → Project Settings (gear) → Script Properties → add:
 *        BACKUP_SHEET_ID  =  THIS_LONG_ID
 *      (SUPABASE_URL and SUPABASE_SERVICE_KEY should already be there.)
 *   4. Paste this file in, save, run backupNow() once (approve the spreadsheet
 *      permission if asked).
 *   5. Triggers → backupNow → Time-driven → Day timer → ~2–3am.
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
const BK_PAGE = 1000;   // rows fetched per request (paginated)

// ── ENTRY POINT (put this on the daily trigger) ─────────────
function backupNow() {
  const props = PropertiesService.getScriptProperties();
  const url     = props.getProperty('SUPABASE_URL');
  const key     = props.getProperty('SUPABASE_SERVICE_KEY');
  const sheetId = props.getProperty('BACKUP_SHEET_ID');
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in Script Properties');
  if (!sheetId)     throw new Error('Missing BACKUP_SHEET_ID — create a blank Google Sheet and put its ID in Script Properties');

  const ss    = SpreadsheetApp.openById(sheetId);
  const tz    = Session.getScriptTimeZone();
  const stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');

  const summary = [];
  for (const table of BK_TABLES) {
    try {
      const rows = bkFetchAll_(url, key, table);
      bkWriteTab_(ss, table, rows);
      summary.push(table + ': ' + rows.length);
    } catch (e) {
      bkWriteTab_(ss, table, null, 'BACKUP FAILED: ' + e.message);
      summary.push(table + ': ERROR ' + e.message);
    }
  }
  bkMeta_(ss, stamp, summary);
  Logger.log('Backup complete ' + stamp + '\n' + summary.join('\n'));
  return summary;
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
    if (batch.length < BK_PAGE) break;
    from += BK_PAGE;
  }
  return all;
}

// ── WRITE one table to its own tab (created if missing, cleared each run) ──
function bkWriteTab_(ss, table, rows, errMsg) {
  let sheet = ss.getSheetByName(table);
  if (!sheet) sheet = ss.insertSheet(table);
  sheet.clearContents();

  if (errMsg) { sheet.getRange(1, 1).setValue(errMsg); return; }
  if (!rows || !rows.length) { sheet.getRange(1, 1).setValue('(no rows)'); return; }

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

// ── A small "Backup log" tab recording each run + row counts ──
function bkMeta_(ss, stamp, summary) {
  const name = 'Backup log';
  let sheet = ss.getSheetByName(name);
  if (!sheet) { sheet = ss.insertSheet(name, 0); sheet.appendRow(['Backed up at', 'Tables (rows)']); }
  sheet.insertRowAfter(1);
  sheet.getRange(2, 1, 1, 2).setValues([[stamp, summary.join(', ')]]);
}
