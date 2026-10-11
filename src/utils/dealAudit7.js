// ============================================================
// dealAudit7.js — the 7-item post-sale deal audit (PURE).
//
// Shared by server.js (which reads the install sheet and persists results) and
// the frontend (labels + display helpers). It only READS the commission engine
// (dealAmounts); it never changes commission math.
//
// The server builds a `booking` object from the install sheet and passes it in;
// this module decides pass/fail + reason per item. Name resolution helpers are
// ported from scripts/ScheduleSync.gs (schParseSetter_/schCleanRep_/
// schResolvePerson_) so the audit matches the sync exactly.
// ============================================================
import { dealAmounts } from './commission.js'

// Item order is the display order. `manual: true` = ticked by a human, never by
// the audit; the rest auto-check when they pass.
export const AUDIT_ITEMS = [
  { key: 'on_calendar',        label: 'On calendar',         manual: false },
  { key: 'install_date',       label: 'Install date',        manual: false },
  { key: 'financing',          label: 'Financing',           manual: true  },
  { key: 'setter_closer',      label: 'Setter / closer',     manual: false },
  { key: 'customer_info',      label: 'Customer info',       manual: false },
  { key: 'manager_override',   label: 'Manager & override',  manual: false },
  { key: 'drawing_commission', label: 'Drawing & commission', manual: true },
  { key: 'ghl_information',     label: 'GHL information',      manual: false },
]
export const AUDIT_ITEM_KEYS = AUDIT_ITEMS.map(i => i.key)
export const MANUAL_ITEM_KEYS = AUDIT_ITEMS.filter(i => i.manual).map(i => i.key)
export const AUTO_ITEM_KEYS   = AUDIT_ITEMS.filter(i => !i.manual).map(i => i.key)

// ── Name parsing/resolution (ported from ScheduleSync.gs) ───
const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase()

// "Outside Sales - Setter: Jane Doe" → "Jane Doe" (null when no setter named).
export function parseSetterName(leadSource) {
  const m = String(leadSource || '').match(/setter\s*[:\-–—=]\s*([^,;|/()\[\]]+)/i)
  return m ? m[1].trim() : null
}
// Strip a trailing "(...)" note from a rep cell.
export function cleanRep(v) { return String(v || '').replace(/\s*\(.*$/, '').trim() }

// Exact normalized name, then a UNIQUE first-name / prefix match; never guess.
// `profiles` = [{ id, name }]. Returns the profile or null.
export function resolvePerson(rawName, profiles) {
  const name = norm(rawName)
  if (!name) return null
  const exact = profiles.find(p => p.name && norm(p.name) === name)
  if (exact) return exact
  const cands = profiles.filter(p => {
    const pn = norm(p.name)
    return pn && (pn.startsWith(name + ' ') || pn.split(' ')[0] === name)
  })
  return cands.length === 1 ? cands[0] : null
}

// "Inside Sales" | "Outside Sales - Self Gen" | "Outside Sales - Setter: X".
export function saleTypeFromLead(leadSource) {
  const s = String(leadSource || '').trim()
  if (!s) return 'unknown'
  if (/inside/i.test(s)) return 'inside'
  if (/self\s*gen/i.test(s)) return 'outside_self_gen'
  if (/setter/i.test(s)) return 'outside_setter'
  return 'unknown'
}

const nameById = (id, usersById) => (id && usersById[id] && usersById[id].name) || null

// Compute the auto items' pass/fail + reasons + fix payloads.
//   deal     — the deals row (all columns)
//   booking  — null, or {
//                onCalendar, installDate ('YYYY-MM-DD'|null), status,
//                leadSourceRaw, saleType, setterName, closerName,
//                setterId, closerId,                // resolved profile ids (or null)
//                setterResolved, closerResolved,    // bool: name matched a profile
//                payment, customerPhone, customerAddress
//              }
//   usersById — { id: { id, name } } for showing site names
//   ghl      — null, or {
//                configured,                 // GHL token present server-side
//                matched,                    // a GHL contact matched the deal
//                error,                      // string if the GHL read failed
//                contactName,                // the matched contact's name
//                has: { sales_rep, install_date, commission, payment_method }
//                  each 'present' | 'empty' | 'no_field'
//              }
// Returns { items: [{ key, label, manual, pass, reason, fix }] } — manual
// items carry pass:null (their state lives in the stored checklist).
export function computeAudit(deal, booking, usersById = {}, ghl = null) {
  const onCal = !!(booking && booking.onCalendar)
  const items = []

  // 1 — On calendar
  items.push({
    key: 'on_calendar', label: 'On calendar', manual: false,
    pass: onCal,
    reason: onCal ? null : 'No non-cancelled install booking matched this deal on the calendar.',
    fix: null,
  })

  // 2 — Install date
  {
    let pass = false, reason = null, fix = null
    if (!onCal) {
      reason = 'Not on calendar — install date can’t be verified yet.'
    } else if (!booking.installDate) {
      reason = 'Calendar row has no install date.'
    } else if (deal.install_date === booking.installDate) {
      pass = true
    } else {
      reason = `Site: ${deal.install_date || '—'} · Calendar: ${booking.installDate}`
      fix = { type: 'use_calendar_date', calDate: booking.installDate }
    }
    items.push({ key: 'install_date', label: 'Install date', manual: false, pass, reason, fix })
  }

  // 3 — Financing (manual)
  items.push({
    key: 'financing', label: 'Financing', manual: true, pass: null,
    reason: booking && booking.payment ? `Sheet payment: ${booking.payment}` : 'Confirm GoodLeap/Sunlight docs signed + amount.',
    fix: null,
  })

  // 4 — Setter / closer
  {
    let pass = false, reason = null, fix = null
    const siteSetter = nameById(deal.setter_id, usersById)
    const siteCloser = nameById(deal.closer_id, usersById)
    if (!onCal) {
      reason = 'Not on calendar — can’t compare setter/closer yet.'
    } else {
      const calSetterId = booking.setterId || null
      const calCloserId = booking.closerId || null
      const bothResolve = booking.setterResolved && booking.closerResolved
      if (bothResolve && calSetterId === (deal.setter_id || null) && calCloserId === (deal.closer_id || null)) {
        pass = true
      } else {
        const calS = booking.setterName || (booking.setterResolved ? siteSetter : null) || '—'
        const calC = booking.closerName || '—'
        reason = `Calendar — setter: ${calS}, closer: ${calC}. Site — setter: ${siteSetter || '—'}, closer: ${siteCloser || '—'}.`
          + (bothResolve ? '' : ' (a calendar name did not match a profile)')
        if (bothResolve) fix = { type: 'use_calendar_people', setterId: calSetterId, closerId: calCloserId }
      }
    }
    items.push({ key: 'setter_closer', label: 'Setter / closer', manual: false, pass, reason, fix })
  }

  // 5 — Customer info (presence only)
  {
    const miss = []
    if (!String(deal.deal_name || '').trim()) miss.push('name')
    if (!String(deal.customer_phone || '').trim()) miss.push('phone')
    if (!String(deal.customer_address || '').trim()) miss.push('address')
    items.push({
      key: 'customer_info', label: 'Customer info', manual: false,
      pass: miss.length === 0,
      reason: miss.length ? `Missing: ${miss.join(', ')}` : null,
      fix: null,
    })
  }

  // 6 — Manager & override
  {
    let pass = false, reason = null, fix = null
    if (!deal.manager_id) {
      reason = 'No manager — assign the rep to a team.'
      fix = { type: 'assign_team' }
    } else {
      const a = dealAmounts(deal)
      const pct = Number(deal.manager_override_pct) || 0
      const stored = deal.manager_amount != null
      if (a.manager > 0 && (pct > 0 || stored)) {
        pass = true
      } else {
        reason = a.manager > 0
          ? 'Manager override has no rate (manager_override_pct is 0).'
          : 'Manager override computes to $0.'
      }
    }
    items.push({ key: 'manager_override', label: 'Manager & override', manual: false, pass, reason, fix })
  }

  // 7 — Drawing & commission (manual)
  items.push({
    key: 'drawing_commission', label: 'Drawing & commission', manual: true, pass: null,
    reason: 'Confirm the drawing matches and commission is right.',
    fix: null,
  })

  // 8 — GHL information: the deal's GoHighLevel contact has the sales rep,
  // install date, commission, and payment method filled in. Auto, read-only
  // (no in-app fix — GHL is edited in GHL).
  {
    let pass = false, reason = null
    if (!ghl || ghl.configured === false) {
      reason = 'GHL is not connected yet (set GHL_API_TOKEN on the site).'
    } else if (ghl.error) {
      reason = `Couldn’t read GHL: ${ghl.error}`
    } else if (!ghl.matched) {
      reason = 'No GHL contact matched this deal (by phone or name).'
    } else {
      const has = ghl.has || {}
      const word = (s) => s === 'present' ? 'in GHL' : s === 'no_field' ? 'no field in GHL' : 'missing'
      const FIELDS = [
        ['sales rep', has.sales_rep],
        ['install date', has.install_date],
        ['commission', has.commission],
        ['payment method', has.payment_method],
      ]
      pass = FIELDS.every(([, s]) => s === 'present')
      // Always summarise all four so the row shows each field's state, passing
      // or not. The frontend splits this on ' • ' into its own line each.
      reason = FIELDS.map(([label, s]) => `${label}: ${word(s)}`).join(' • ')
        + (ghl.contactName ? ` • contact: ${ghl.contactName}` : '')
    }
    items.push({ key: 'ghl_information', label: 'GHL information', manual: false, pass, reason, fix: null })
  }

  return { items }
}
