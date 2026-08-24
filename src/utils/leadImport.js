// ============================================================
// CSV → lead rows. Used by the Leads page importer to backfill appointments
// the webhook never saw (it only fires on events from the moment it's set up)
// and as a recovery path if the feed is ever down.
//
// Column matching is by HEADER NAME with aliases, so a slightly different
// export still lands. Anything unrecognized is ignored, and every row keeps
// its original CSV record in `raw`.
// ============================================================

// RFC-ish CSV parse: handles quoted fields containing commas, newlines and
// escaped ("") quotes.
export function parseCsv(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  const s = String(text ?? '').replace(/\r\n?/g, '\n')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(c => String(c).trim() !== ''))
}

const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '')

// our key → accepted header spellings (normalized)
const COLUMNS = {
  external_id:   ['id', 'appointmentid'],
  first_name:    ['firstname', 'contactfirstname', 'customerfirstname'],
  last_name:     ['lastname', 'contactlastname', 'customerlastname'],
  phone:         ['phone', 'phonenumber', 'contactphone', 'appointmentphonenumber'],
  email:         ['email', 'contactemail', 'customeremail'],
  address:       ['appointmentaddress', 'contactaddress', 'address', 'fulladdress'],
  notes:         ['appointmentnotes', 'notes'],
  setter_first:  ['settername', 'setterfirstname'],
  setter_last:   ['setterlastname'],
  setter_email:  ['setteremail'],
  closer_first:  ['closerfirstname', 'closername'],
  closer_last:   ['closerlastname'],
  closer_email:  ['closeremail'],
  category:      ['appointmentcategory', 'category'],
  outcome:       ['appointmentoutcome', 'outcome', 'disposition'],
  // UTC is preferred — an unqualified local time would shift the appointment.
  at_utc:        ['appointmentdatetimeutc'],
  at_local:      ['appointmentdatetimelocaltime', 'appointmentdatetime'],
}

// Category is the durable signal: "Held" means the appointment happened,
// which is what makes it an estimate. The specific outcome only distinguishes
// sold from not-sold, so a new disposition added under Held still counts.
export function statusFrom(category, outcome) {
  const c = norm(category), o = norm(outcome)
  if (o === 'signedup' || o === 'sold' || o === 'closed') return 'sold'
  if (c === 'held') return 'completed'
  if (c === 'notheld') {
    if (o.includes('noshow')) return 'no_show'
    if (o.includes('resched')) return 'scheduled'   // still going to happen
    return 'canceled'
  }
  if (o.includes('noshow')) return 'no_show'
  if (o.includes('cancel')) return 'canceled'
  return 'scheduled'   // Confirmation (confirmed / not confirmed) + blanks
}

// "2026-08-24 16:00:00" (UTC) → ISO. Local-time fallback is treated as
// Arizona (UTC-7, no DST) when no UTC column exists.
const toIso = (utc, local) => {
  const v = String(utc || '').trim()
  if (v) return v.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? '' : 'Z')
  const l = String(local || '').trim()
  return l ? l.replace(' ', 'T') + '-07:00' : null
}

const join = (a, b) => [a, b].map(x => String(x || '').trim()).filter(Boolean).join(' ') || null
const clean = (v) => { const s = String(v ?? '').trim(); return s && s !== '+1' ? s : null }

// rows → { leads, headers, unmatchedHeaders }. `profilesByEmail` maps a
// lowercased email to a profile id so setter/closer attach on import.
export function csvToLeads(text, profilesByEmail = {}, source = 'repcard') {
  const table = parseCsv(text)
  if (table.length < 2) return { leads: [], headers: [], missing: ['No data rows found'] }
  const headers = table[0].map(h => String(h).trim())
  const idx = {}
  headers.forEach((h, i) => { const n = norm(h); for (const [key, names] of Object.entries(COLUMNS)) if (names.includes(n)) idx[key] ??= i })
  const get = (r, key) => (idx[key] != null ? clean(r[idx[key]]) : null)

  const missing = []
  if (idx.external_id == null) missing.push('ID')
  if (idx.at_utc == null && idx.at_local == null) missing.push('Appointment Date/Time')

  const leads = []
  for (const r of table.slice(1)) {
    const extId = get(r, 'external_id')
    if (!extId) continue
    const se = (get(r, 'setter_email') || '').toLowerCase() || null
    const ce = (get(r, 'closer_email') || '').toLowerCase() || null
    leads.push({
      source,
      external_id: String(extId),
      customer_name: join(get(r, 'first_name'), get(r, 'last_name')),
      address: get(r, 'address'),
      phone: get(r, 'phone'),
      email: get(r, 'email'),
      appointment_at: toIso(get(r, 'at_utc'), get(r, 'at_local')),
      status: statusFrom(get(r, 'category'), get(r, 'outcome')),
      disposition: get(r, 'outcome') || get(r, 'category'),
      setter_id: se ? profilesByEmail[se] ?? null : null,
      closer_id: ce ? profilesByEmail[ce] ?? null : null,
      setter_name: join(get(r, 'setter_first'), get(r, 'setter_last')) || se,
      closer_name: join(get(r, 'closer_first'), get(r, 'closer_last')) || ce,
      notes: get(r, 'notes'),
      raw: Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])),
      _setterEmail: se, _closerEmail: ce,   // for the unmatched report (stripped before save)
    })
  }
  return { leads, headers, missing }
}
