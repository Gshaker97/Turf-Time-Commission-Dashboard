/**
 * Turf Time — Daily deals export → ONE live Google Sheet (the spreadsheet backup)
 *
 * Updates a single spreadsheet ("Turf Time Deals — Live Backup") in place every
 * day: one tab per closing month (July 2026 onward, newest first), rows newest
 * first like the site, TOTALS row per tab. Old states are covered by Google
 * Sheets' built-in version history (File → Version history) — no dated copies
 * to manage. The rows come from the SITE's export endpoint, computed by the
 * same commission engine that runs payroll, so this backup can never disagree
 * with the site. Pure outbound flow: if this script vanished, the site loses
 * nothing.
 *
 * Columns: Deal · Closing Date · Install Date · Office · Payment · Setter ·
 * Closer · Baseline · Total Price · Setter Commission · Closer Commission ·
 * Commission % · Manager/% /$ · Director/% /$ · VP/% /$ · Status
 *
 * Setup (same Apps Script project as ScheduleSync — reuses its properties):
 *   1. Paste this as a file named "DealsExport", save.
 *   2. Script properties needed (Project Settings → Script Properties):
 *        FRONTEND_URL          = https://your-dashboard.up.railway.app
 *        SUPABASE_SERVICE_KEY  = (already set for the sync)
 *   3. Run dealsExportRun() once to authorize and create the sheet — find it
 *      in the "Turf Time Deal Exports" folder in Drive and bookmark it.
 *   4. Triggers → dealsExportRun → time-driven → Day timer → pick an hour
 *      (e.g. 4–5am).
 */

const DX_FOLDER_NAME = 'Turf Time Deal Exports';
const DX_FILE_NAME   = 'Turf Time Deals — Live Backup';
const DX_ID_PROP     = 'DX_SPREADSHEET_ID';   // remembers the file across renames
const DX_SINCE       = '2026-07-01';          // first closing date exported

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

  const ss = dxSpreadsheet_(props);
  const HEADERS = ['Deal', 'Closing Date', 'Install Date', 'Office', 'Payment', 'Setter', 'Closer',
    'Baseline', 'Total Price', 'Setter Commission', 'Closer Commission', 'Commission %',
    'Manager', 'Manager %', 'Manager $', 'Director', 'Director %', 'Director $',
    'VP', 'VP %', 'VP $', 'Status'];
  const MONEY_COLS = [8, 9, 10, 11, 15, 18, 21];   // 1-based
  const PCT_COLS   = [12, 14, 17, 20];

  const months = data.months || [];   // newest month first; rows newest first
  const updatedNote = 'Updated ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM d, yyyy h:mm a');

  months.forEach(function (m, i) {
    let sh = ss.getSheetByName(m.label);
    if (!sh) sh = ss.insertSheet(m.label, i);
    sh.clear();
    const rows = m.rows.map(r => [
      r.deal, r.closing_date, r.install_date, r.office, r.payment, r.setter, r.closer,
      r.baseline, r.total_price, r.setter_commission, r.closer_commission, r.commission_pct,
      r.manager, r.manager_pct, r.manager_amount, r.director, r.director_pct, r.director_amount,
      r.vp, r.vp_pct, r.vp_amount, r.status,
    ]);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
      .setFontWeight('bold').setBackground('#1e3a34').setFontColor('#ffffff');
    if (rows.length) sh.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
    // TOTALS row — live SUM formulas over the money columns.
    const totalRow = rows.length + 2;
    sh.getRange(totalRow, 1).setValue('TOTALS (' + rows.length + ' deals)');
    if (rows.length) {
      MONEY_COLS.forEach(function (c) {
        const a1 = sh.getRange(2, c).getA1Notation(), a2 = sh.getRange(totalRow - 1, c).getA1Notation();
        sh.getRange(totalRow, c).setFormula('=SUM(' + a1 + ':' + a2 + ')');
      });
    }
    sh.getRange(totalRow, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#243b35').setFontColor('#ffffff');
    const dataRows = Math.max(rows.length + 1, 1);   // data + totals
    MONEY_COLS.forEach(c => sh.getRange(2, c, dataRows, 1).setNumberFormat('$#,##0.00'));
    PCT_COLS.forEach(c => sh.getRange(2, c, dataRows, 1).setNumberFormat('0.00"%"'));
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, HEADERS.length);
    sh.getRange('A1').setNote(updatedNote);
    // Keep tab order = newest month first (matches the site).
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(i + 1);
  });

  // Drop the default empty sheet once real tabs exist.
  const def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  else if (def) def.getRange('A1').setValue('No deals with a closing date on/after ' + DX_SINCE + ' yet.');

  Logger.log('Updated "' + ss.getName() + '" — ' + months.reduce((s, m) => s + m.rows.length, 0) + ' deals across ' + months.length + ' month tab(s).');
}

// The one live spreadsheet: remembered by ID (survives renames/moves), found
// by name as a fallback, created in the export folder if neither works.
function dxSpreadsheet_(props) {
  const saved = props.getProperty(DX_ID_PROP);
  if (saved) {
    try { return SpreadsheetApp.openById(saved); } catch (e) { /* trashed — recreate */ }
  }
  const folder = dxFolder_();
  const it = folder.getFilesByName(DX_FILE_NAME);
  if (it.hasNext()) {
    const f = it.next();
    props.setProperty(DX_ID_PROP, f.getId());
    return SpreadsheetApp.openById(f.getId());
  }
  const ss = SpreadsheetApp.create(DX_FILE_NAME);
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  props.setProperty(DX_ID_PROP, ss.getId());
  return ss;
}

function dxFolder_() {
  const it = DriveApp.getFoldersByName(DX_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DX_FOLDER_NAME);
}
