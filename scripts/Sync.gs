/**
 * Turf Time — Google Sheet → Supabase Sync
 *
 * Reads the configured monthly tabs and upserts each row to the deals table.
 * Match key: lower(trim(deal_name))
 *
 * Setup:
 *   1. Extensions → Apps Script → paste this file
 *   2. File → Project Settings → Script Properties:
 *        SUPABASE_URL          (your Kong public URL, no trailing slash)
 *        SUPABASE_SERVICE_KEY  (service_role key — do NOT use anon key)
 *   3. Run syncAll() once manually to authorize
 *   4. Triggers → Add Trigger → syncAll → Time-driven → Every 5 minutes
 */

// ── CONFIG ──────────────────────────────────────────────────
const TABS_TO_SYNC = ["April '26", "May '26"];

// Sheet status → Dashboard status. "SKIP" means don't import that row.
const STATUS_MAP = {
  "Scheduled":     "Pending Install",
  "Pay Finalized": "Pay Finalized",
  "Paid":          "Paid",
  "Sales issue":   "Sales Issue",
  "Sales Issue":   "Sales Issue",
  "Canceled":      "SKIP",
  "Cancelled":     "SKIP",
  "":              "Deal Review",
};

// ── ENTRY POINT ─────────────────────────────────────────────
function syncAll() {
  const props = PropertiesService.getScriptProperties();
  const supabaseUrl = props.getProperty("SUPABASE_URL");
  const serviceKey  = props.getProperty("SUPABASE_SERVICE_KEY");

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in Script Properties");
  }

  const profiles = fetchProfiles_(supabaseUrl, serviceKey);
  const profileByName = indexProfilesByName_(profiles);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const summary = { synced: 0, skipped: 0, errors: 0, errorDetails: [] };

  for (const tabName of TABS_TO_SYNC) {
    const sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      Logger.log("Tab not found: " + tabName);
      continue;
    }
    const tabResult = syncTab_(sheet, profileByName, supabaseUrl, serviceKey);
    summary.synced  += tabResult.synced;
    summary.skipped += tabResult.skipped;
    summary.errors  += tabResult.errors;
    summary.errorDetails.push(...tabResult.errorDetails);
  }

  Logger.log("=== Sync complete ===");
  Logger.log("Synced:  " + summary.synced);
  Logger.log("Skipped: " + summary.skipped);
  Logger.log("Errors:  " + summary.errors);
  if (summary.errors > 0) {
    Logger.log("Error details:\n" + summary.errorDetails.join("\n"));
  }
  return summary;
}

// ── PER-TAB SYNC ────────────────────────────────────────────
function syncTab_(sheet, profileByName, supabaseUrl, serviceKey) {
  const result = { synced: 0, skipped: 0, errors: 0, errorDetails: [] };
  const range = sheet.getDataRange();
  const values = range.getValues();
  if (values.length < 2) return result;

  const headers = values[0].map(h => String(h).trim());
  const col = (name) => headers.indexOf(name);

  const idx = {
    lead:        col("Lead Name"),
    setter:      col("Setter"),
    closer:      col("Closer"),
    baseline:    col("Baseline $"),
    total:       col("Total $"),
    commPct:     col("Comm %"),
    commission:  col("Commission"),       // older format
    setterAmt:   col("Setter $"),         // May+ format
    closerAmt:   col("Closer $"),         // May+ format
    manager:     col("Manager"),
    mgrPct:      col("Manager %"),
    mgrAmt:      col("Manager $"),
    dirPct:      col("Director %"),
    dirAmt:      col("Director $"),
    vpPct:       col("VP %"),
    vpAmt:       col("VP $"),
    closingDate: col("Closing Date"),
    installDate: col("Install Date"),
    status:      col("Status"),
    payDate:     col("Pay Date"),
  };

  if (idx.lead === -1) {
    result.errorDetails.push(sheet.getName() + ": no 'Lead Name' column");
    result.errors++;
    return result;
  }

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const leadName = String(row[idx.lead] || "").trim();

    // Skip empty rows and TOTALS row
    if (!leadName) { result.skipped++; continue; }
    if (leadName.toUpperCase() === "TOTALS") { result.skipped++; continue; }

    const sheetStatus = String(idx.status >= 0 ? row[idx.status] : "").trim();
    const mappedStatus = STATUS_MAP[sheetStatus];
    if (mappedStatus === undefined) {
      // Unknown status — default to Deal Review and log
      Logger.log("Unknown status '" + sheetStatus + "' on row " + (r+1) + " in " + sheet.getName() + " — defaulting to Deal Review");
    }
    if (mappedStatus === "SKIP") { result.skipped++; continue; }

    // Resolve people
    const setterId = lookupProfileId_(row[idx.setter], profileByName);
    if (!setterId) {
      result.errorDetails.push(sheet.getName() + " row " + (r+1) + " (" + leadName + "): unknown setter '" + row[idx.setter] + "'");
      result.errors++;
      continue;
    }
    const closerId  = lookupProfileId_(row[idx.closer],  profileByName);
    const managerId = idx.manager >= 0 ? lookupProfileId_(row[idx.manager], profileByName) : null;

    // All Turf Time deals: Garrison = director, Keaton = VP
    const directorId = profileByName["garrison shaker"] || null;
    const vpId       = profileByName["keaton shaker"]   || null;

    const baseline = parseMoney_(row[idx.baseline]);
    const total    = parseMoney_(row[idx.total]);

    if (baseline === null || total === null) {
      result.errorDetails.push(sheet.getName() + " row " + (r+1) + " (" + leadName + "): missing baseline or total");
      result.errors++;
      continue;
    }

    const closingDate = parseDate_(row[idx.closingDate]);
    if (!closingDate) {
      result.errorDetails.push(sheet.getName() + " row " + (r+1) + " (" + leadName + "): missing closing date");
      result.errors++;
      continue;
    }

    // Build the deal payload
    const sameRep = setterId && closerId && setterId === closerId;
    const deal = {
      deal_name:    leadName,
      sale_date:    closingDate,
      install_date: parseDate_(row[idx.installDate]),
      pay_date:     parseDate_(row[idx.payDate]),
      status:       mappedStatus || "Deal Review",
      setter_id:    setterId,
      closer_id:    closerId,
      manager_id:   managerId,
      director_id:  directorId,
      vp_id:        vpId,
      baseline_revenue: baseline,
      job_price:        total,
      // Splits
      setter_split_pct: sameRep ? 1 : 0.5,
      // % fields (kept as backup; primary source is the $ fields below)
      manager_override_pct:  parsePercent_(row[idx.mgrPct]),
      director_override_pct: parsePercent_(row[idx.dirPct]),
      vp_override_pct:       parsePercent_(row[idx.vpPct]),
      // Stored $ amounts (the truth, including bonuses)
      setter_amount:   resolveSetterAmt_(row, idx, sameRep),
      closer_amount:   resolveCloserAmt_(row, idx, sameRep),
      manager_amount:  parseMoney_(row[idx.mgrAmt]),
      director_amount: parseMoney_(row[idx.dirAmt]),
      vp_amount:       parseMoney_(row[idx.vpAmt]),
    };

    // Upsert to Supabase
    try {
      upsertDeal_(deal, supabaseUrl, serviceKey);
      result.synced++;
    } catch (err) {
      result.errorDetails.push(sheet.getName() + " row " + (r+1) + " (" + leadName + "): " + err.message);
      result.errors++;
    }
  }

  return result;
}

// ── PROFILES (Supabase) ─────────────────────────────────────
function fetchProfiles_(supabaseUrl, serviceKey) {
  const resp = UrlFetchApp.fetch(supabaseUrl + "/rest/v1/profiles?select=id,name,role", {
    method: "get",
    headers: {
      "apikey": serviceKey,
      "Authorization": "Bearer " + serviceKey,
    },
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) {
    throw new Error("fetchProfiles failed: " + resp.getContentText());
  }
  return JSON.parse(resp.getContentText());
}

function indexProfilesByName_(profiles) {
  const map = {};
  for (const p of profiles) {
    if (!p.name) continue;
    map[p.name.trim().toLowerCase()] = p.id;
  }
  return map;
}

function lookupProfileId_(rawName, profileByName) {
  if (!rawName) return null;
  const key = String(rawName).trim().toLowerCase();
  if (!key || key === "-" || key === "-%") return null;
  return profileByName[key] || null;
}

// ── SUPABASE UPSERT ─────────────────────────────────────────
function upsertDeal_(deal, supabaseUrl, serviceKey) {
  // Match key: deal_name (case-insensitive). Sheet doesn't have a stable ID.
  // Strategy: try to find an existing deal by deal_name; PATCH if found, POST if not.
  const matchUrl = supabaseUrl + "/rest/v1/deals?deal_name=eq." + encodeURIComponent(deal.deal_name) + "&select=id";
  const findResp = UrlFetchApp.fetch(matchUrl, {
    method: "get",
    headers: {
      "apikey": serviceKey,
      "Authorization": "Bearer " + serviceKey,
    },
    muteHttpExceptions: true,
  });
  if (findResp.getResponseCode() >= 300) {
    throw new Error("Lookup failed: " + findResp.getContentText());
  }
  const matches = JSON.parse(findResp.getContentText());

  if (matches.length === 0) {
    // INSERT
    const resp = UrlFetchApp.fetch(supabaseUrl + "/rest/v1/deals", {
      method: "post",
      contentType: "application/json",
      headers: {
        "apikey": serviceKey,
        "Authorization": "Bearer " + serviceKey,
        "Prefer": "return=minimal",
      },
      payload: JSON.stringify(deal),
      muteHttpExceptions: true,
    });
    if (resp.getResponseCode() >= 300) {
      throw new Error("Insert failed: " + resp.getContentText());
    }
  } else {
    // UPDATE (use the first match if multiple)
    const id = matches[0].id;
    const resp = UrlFetchApp.fetch(supabaseUrl + "/rest/v1/deals?id=eq." + id, {
      method: "patch",
      contentType: "application/json",
      headers: {
        "apikey": serviceKey,
        "Authorization": "Bearer " + serviceKey,
        "Prefer": "return=minimal",
      },
      payload: JSON.stringify(deal),
      muteHttpExceptions: true,
    });
    if (resp.getResponseCode() >= 300) {
      throw new Error("Update failed: " + resp.getContentText());
    }
  }
}

// ── PARSING HELPERS ─────────────────────────────────────────
function parseMoney_(val) {
  if (val === "" || val === null || val === undefined) return null;
  if (typeof val === "number") return val;
  const cleaned = String(val).replace(/[$,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function parsePercent_(val) {
  if (val === "" || val === null || val === undefined) return 0;
  if (typeof val === "number") {
    // Sheet may store 0.05 or 5 depending on cell formatting
    return val < 1 ? val : val / 100;
  }
  const cleaned = String(val).replace(/[%\s]/g, "");
  if (cleaned === "" || cleaned === "-") return 0;
  const n = parseFloat(cleaned);
  if (isNaN(n)) return 0;
  return n < 1 ? n : n / 100;
}

function parseDate_(val) {
  if (!val) return null;
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  const s = String(val).trim();
  if (!s) return null;
  // Try MM/DD/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let [, mo, d, y] = m;
    if (y.length === 2) y = "20" + y;
    return y + "-" + String(mo).padStart(2,"0") + "-" + String(d).padStart(2,"0");
  }
  // Try YYYY-MM-DD already
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function resolveSetterAmt_(row, idx, sameRep) {
  // May+ has Setter $; older months have only Commission (which is total rep $)
  if (idx.setterAmt >= 0) {
    return parseMoney_(row[idx.setterAmt]);
  }
  if (idx.commission >= 0) {
    const total = parseMoney_(row[idx.commission]);
    if (total === null) return null;
    return sameRep ? total : total / 2;
  }
  return null;
}

function resolveCloserAmt_(row, idx, sameRep) {
  if (sameRep) return null; // closer_amount stays null when same rep
  if (idx.closerAmt >= 0) {
    return parseMoney_(row[idx.closerAmt]);
  }
  if (idx.commission >= 0) {
    const total = parseMoney_(row[idx.commission]);
    if (total === null) return null;
    return total / 2;
  }
  return null;
}

// ── MANUAL TEST HELPER ──────────────────────────────────────
function testFetchProfiles() {
  const props = PropertiesService.getScriptProperties();
  const profiles = fetchProfiles_(
    props.getProperty("SUPABASE_URL"),
    props.getProperty("SUPABASE_SERVICE_KEY")
  );
  Logger.log("Found " + profiles.length + " profiles:");
  profiles.forEach(p => Logger.log("  " + p.name + " (" + p.role + ")"));
}
