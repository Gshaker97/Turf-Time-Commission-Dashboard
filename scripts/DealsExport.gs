/**
 * Turf Time — Daily deals export → Google Sheets (the spreadsheet backup)
 *
 * Every day this creates a clean spreadsheet of all deals (July 2026 onward),
 * one tab per closing month, in a Drive folder — keeping the last few copies.
 * The rows come from the SITE's export endpoint, computed by the same
 * commission engine that runs payroll, so this backup can never disagree with
 * the site. Pure outbound flow: if this script vanished, the site loses
 * nothing.
 *
 * Columns: Deal · Closing Date · Install Date · Setter · Closer · Baseline ·
 * Total Price · Setter Commission · Closer Commission · Commission % ·
 * Manager/% /$ · Director/% /$ · VP/% /$ · Status
 *
 * Setup (same Apps Script project as ScheduleSync — reuses its properties):
 *   1. Paste this as a new file (e.g. "DealsExport"), save.
 *   2. Script properties needed (Project Settings → Script Properties):
 *        FRONTEND_URL          = https://your-dashboard.up.railway.app  (Watchdog already uses this)
 *        SUPABASE_SERVICE_KEY  = (already set for the sync)
 *   3. Run dealsExportRun() once to authorize Drive/Sheets access and create
 *      the first export. Check the "Turf Time Deal Exports" folder in Drive.
 *   4. Triggers → dealsExportRun → time-driven → Day timer → pick an hour
 *      (e.g. 4–5am).
 */

const DX_FOLDER_NAME = 'Turf Time Deal Exports';
const DX_NAME_PREFIX = 'Turf Time Deals — ';
const DX_KEEP        = 7;              // dated copies to keep (older ones are trashed)
const DX_SINCE       = '2026-07-01';   // first closing date exported

function dealsExportRun() {
  try {
    dealsExport_();
  } catch (e) {
    // Never fail the trigger (no Google error-rate noise) — email instead.
    const msg = 'Deals export FAILED: ' + ((e && e.message) || e);
    Logger.log(msg);
    const email = PropertiesService.getScriptProperties().getProperty('ALERT_EMAIL');
    if (email) MailApp.sendEmail(email, '🚨 Turf Time deals export failed', msg);
  }
}

function dealsExport_() {
  const props = PropertiesService.getScriptProperties();
  const site = String(props.getProperty('FRONTEND_URL') || '').replace(/\/+$/, '');
  const key  = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!site || !key) throw new Error('Missing FRONTEND_URL or SUPABASE_SERVICE_KEY in Script Properties');

  const resp = UrlFetchApp.fetch(site + '/api/export/deals?since=' + DX_SINCE, {
    headers: { Authorization: 'Bearer ' + key },
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) throw new Error('Export endpoint returned HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 200));
  const data = JSON.parse(resp.getContentText());

  // One folder, dated file per day; a re-run replaces today's copy.
  const folder = dxFolder_();
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const name = DX_NAME_PREFIX + today;
  const existing = folder.getFilesByName(name);
  while (existing.hasNext()) existing.next().setTrashed(true);

  const ss = SpreadsheetApp.create(name);
  DriveApp.getFileById(ss.getId()).moveTo(folder);

  const HEADERS = ['Deal', 'Closing Date', 'Install Date', 'Setter', 'Closer',
    'Baseline', 'Total Price', 'Setter Commission', 'Closer Commission', 'Commission %',
    'Manager', 'Manager %', 'Manager $', 'Director', 'Director %', 'Director $',
    'VP', 'VP %', 'VP $', 'Status'];
  const MONEY_COLS = [6, 7, 8, 9, 13, 16, 19];   // 1-based
  const PCT_COLS   = [10, 12, 15, 18];

  const months = data.months || [];
  for (const m of months) {
    const sh = ss.insertSheet(m.label);
    const rows = m.rows.map(r => [
      r.deal, r.closing_date, r.install_date, r.setter, r.closer,
      r.baseline, r.total_price, r.setter_commission, r.closer_commission, r.commission_pct,
      r.manager, r.manager_pct, r.manager_amount, r.director, r.director_pct, r.director_amount,
      r.vp, r.vp_pct, r.vp_amount, r.status,
    ]);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
      .setFontWeight('bold').setBackground('#1e3a34').setFontColor('#ffffff');
    if (rows.length) sh.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
    sh.setFrozenRows(1);
    MONEY_COLS.forEach(c => sh.getRange(2, c, Math.max(rows.length, 1), 1).setNumberFormat('$#,##0.00'));
    PCT_COLS.forEach(c => sh.getRange(2, c, Math.max(rows.length, 1), 1).setNumberFormat('0.00"%"'));
    sh.autoResizeColumns(1, HEADERS.length);
  }
  // Drop the default empty sheet; note when there is nothing to export yet.
  const def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  else if (def) def.getRange('A1').setValue('No deals with a closing date on/after ' + DX_SINCE + ' yet.');

  dxRotate_(folder);
  Logger.log('Exported ' + months.reduce((s, m) => s + m.rows.length, 0) + ' deals across ' + months.length + ' month tab(s) → ' + name);
}

function dxFolder_() {
  const it = DriveApp.getFoldersByName(DX_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DX_FOLDER_NAME);
}

// Keep only the newest DX_KEEP dated exports (matched by name prefix, so
// nothing else in the folder is ever touched).
function dxRotate_(folder) {
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(DX_NAME_PREFIX) === 0) files.push(f);
  }
  files.sort((a, b) => b.getName().localeCompare(a.getName()));   // newest first (date in name)
  files.slice(DX_KEEP).forEach(f => f.setTrashed(true));
}
