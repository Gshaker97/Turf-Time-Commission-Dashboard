/**
 * Turf Time dashboard server — serves the built SPA and hosts the user-admin
 * API, so the site is completely standalone (no Apps Script in the critical
 * path; the Apps Scripts only FEED data in via the sync).
 *
 * POST /api/user-admin — create logins, reset passwords, ban/unban a login.
 * Security model: the SUPABASE_SERVICE_KEY lives here (a Railway variable,
 * never in the browser). Every request carries the calling admin's own
 * Supabase access token; the endpoint verifies that token with GoTrue, looks
 * up the caller's profile, and only proceeds if they're an active admin
 * (role 'admin' OR is_admin = true).
 *
 * Railway variables on this service:
 *   VITE_SUPABASE_URL      — Kong URL (already set; used at build AND here)
 *   VITE_SUPABASE_ANON_KEY — already set (build-time only)
 *   SUPABASE_SERVICE_KEY   — the service_role key (runtime only, this file)
 */
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dealAmounts, setOverrideRateSchedule } from './src/utils/commission.js'

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist')
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const svcHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
const jsonHeaders = { ...svcHeaders, 'Content-Type': 'application/json' }

async function restGet(pathname) {
  const resp = await fetch(SUPABASE_URL + pathname, { headers: svcHeaders })
  if (!resp.ok) throw new Error(`Lookup failed (${resp.status}): ${(await resp.text()).slice(0, 200)}`)
  return resp.json()
}

const ok  = (data) => ({ ok: true, ...data })
const err = (msg)  => ({ ok: false, error: msg })

const tempPassword = () =>
  'TT-' + Math.random().toString(36).slice(2, 8) + Math.floor(10 + Math.random() * 89)

// Find an existing GoTrue user by email via the admin list endpoint (the
// roster is small, so paging through is fine).
async function findAuthUser(email) {
  const want = String(email).trim().toLowerCase()
  for (let page = 1; page <= 20; page++) {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=100`, { headers: svcHeaders })
    if (!resp.ok) return null
    const body = await resp.json()
    const users = body?.users || (Array.isArray(body) ? body : [])
    if (!users.length) return null
    const hit = users.find(u => String(u.email || '').toLowerCase() === want)
    if (hit) return hit
    if (users.length < 100) return null
  }
  return null
}

// Create the GoTrue auth login (auto-confirmed), link it to the profile
// explicitly, and VERIFY the link stuck. Self-healing: if the create fails
// because an auth user with this email already exists (a half-created login
// from an earlier attempt), ADOPT it — set the requested password and link it.
async function createLogin(target, password) {
  if (target.auth_id) return err(`${target.name} already has a login.`)
  const pw = password || tempPassword()
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ email: target.email, password: pw, email_confirm: true }),
  })

  let authUser
  if (resp.ok) {
    authUser = await resp.json()
  } else {
    const createErr = (await resp.text()).slice(0, 200)
    const existing = await findAuthUser(target.email)
    if (!existing) return err('Create failed: ' + createErr)
    const put = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${existing.id}`, {
      method: 'PUT', headers: jsonHeaders,
      body: JSON.stringify({ password: pw, email_confirm: true, ban_duration: 'none' }),
    })
    if (!put.ok) return err('A login for this email already exists but its password could not be set: ' + (await put.text()).slice(0, 200))
    authUser = existing
  }

  await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${target.id}`, {
    method: 'PATCH', headers: { ...jsonHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify({ auth_id: authUser.id }),
  })
  const check = await restGet(`/rest/v1/profiles?select=auth_id&id=eq.${target.id}`)
  if (check[0]?.auth_id !== authUser.id) {
    return err('The login exists but the profile would not link to it — run migration 032 (guard service bypass) and try again.')
  }
  return ok({ created: true, email: target.email, password: pw })
}

async function resetPassword(target, password) {
  if (!target.auth_id) return err(`${target.name} has no login yet — create one first.`)
  const pw = password || tempPassword()
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${target.auth_id}`, {
    method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ password: pw }),
  })
  if (!resp.ok) return err('Reset failed: ' + (await resp.text()).slice(0, 200))
  return ok({ reset: true, email: target.email, password: pw })
}

// Change a user's email — the LOGIN follows the email. Updates GoTrue first
// (that's the credential), then mirrors it onto the profile row, so the two
// can never diverge: whatever email is on the roster is the email they sign
// in with. Works pre-login too (profile only; the future login adopts it).
async function changeEmail(target, newEmail) {
  newEmail = String(newEmail || '').trim().toLowerCase()
  if (!newEmail || !/^\S+@\S+\.\S+$/.test(newEmail)) return err('That does not look like a valid email address.')
  if (target.auth_id) {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${target.auth_id}`, {
      method: 'PUT', headers: jsonHeaders,
      body: JSON.stringify({ email: newEmail, email_confirm: true }),
    })
    if (!resp.ok) return err('Could not change the login email: ' + (await resp.text()).slice(0, 200))
  }
  const patch = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${target.id}`, {
    method: 'PATCH', headers: { ...jsonHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify({ email: newEmail }),
  })
  if (!patch.ok) return err('The login email changed but the roster row did not — retry the save: ' + (await patch.text()).slice(0, 200))
  return ok({ changed: true, email: newEmail, login: !!target.auth_id })
}

// Disable/enable the login at the auth layer (ban). profiles.active is set by
// the dashboard separately; this makes the block real even for a live token.
async function setActive(target, active) {
  if (!target.auth_id) return ok({ note: 'No login to toggle.' })   // profile-only user
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${target.auth_id}`, {
    method: 'PUT', headers: jsonHeaders,
    body: JSON.stringify(active ? { ban_duration: 'none' } : { ban_duration: '876000h' }),   // ~100y
  })
  if (!resp.ok) return err('Toggle failed: ' + (await resp.text()).slice(0, 200))
  return ok({ active: !!active })
}

// Password-reset email (GoTrue /recover) — the link lands on /set-password.
async function recoverEmail(email, redirectTo) {
  const qs = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : ''
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/recover${qs}`, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ email }),
  })
  if (!resp.ok) {
    const t = (await resp.text()).slice(0, 300)
    const hint = /smtp|mail|sending|dial|connect/i.test(t)
      ? ' Email sending is not configured on the auth service yet (SMTP) — see SETUP.md, or set a password manually instead.'
      : ''
    return err(`Could not send the email: ${t}${hint}`)
  }
  return ok({ sent: true })
}

// Email an INVITE: GoTrue creates the auth user and emails them a link to set
// their own password (lands on /set-password). Links the profile with the
// same verify step as createLogin. Self-healing: if an auth user already
// exists for this email (half-created login), adopt it and send a
// password-reset email instead — same end result for the user.
async function inviteUser(target, redirectTo) {
  if (target.auth_id) return err(`${target.name} already has a login — send them a password-reset email instead.`)
  const qs = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : ''
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/invite${qs}`, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ email: target.email }),
  })
  let authUser = null
  if (resp.ok) {
    authUser = await resp.json()
  } else {
    const t = (await resp.text()).slice(0, 300)
    const existing = await findAuthUser(target.email)
    if (!existing) {
      const hint = /smtp|mail|sending|dial|connect/i.test(t)
        ? ' Email sending is not configured on the auth service yet (SMTP) — see SETUP.md, or use "set a password manually".'
        : ''
      return err(`Invite failed: ${t}${hint}`)
    }
    authUser = existing   // adopt the half-created login, then email a reset link
  }
  await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${target.id}`, {
    method: 'PATCH', headers: { ...jsonHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify({ auth_id: authUser.id }),
  })
  const check = await restGet(`/rest/v1/profiles?select=auth_id&id=eq.${target.id}`)
  if (check[0]?.auth_id !== authUser.id) {
    return err('The invite went out but the profile would not link to the login — run migration 032 (guard service bypass) and try again.')
  }
  if (!resp.ok) {
    const rec = await recoverEmail(target.email, redirectTo)
    if (!rec.ok) return rec
  }
  return ok({ invited: true, email: target.email })
}

async function handleUserAdmin(rawBody) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return err('User admin is not configured — set the SUPABASE_SERVICE_KEY variable on the site\'s Railway service and redeploy.')
  }
  let body
  try { body = JSON.parse(rawBody || '{}') } catch { return err('Bad request body.') }

  // 1) Authenticate the caller by their own access token.
  if (!body.token) return err('Not signed in')
  const meResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${body.token}` },
  })
  if (!meResp.ok) return err('Session invalid — sign in again')
  const authId = (await meResp.json()).id

  // 2) Authorize: caller must be an active admin.
  const caller = (await restGet(`/rest/v1/profiles?select=role,is_admin,active&auth_id=eq.${authId}`))[0]
  if (!caller || caller.active === false || !(caller.role === 'admin' || caller.is_admin === true)) {
    return err('Admins only')
  }

  // 3) Resolve the target profile by email (must already be on the roster).
  const email = String(body.email || '').trim().toLowerCase()
  if (!email) return err('Missing email')
  const target = (await restGet(`/rest/v1/profiles?select=id,email,auth_id,name&email=eq.${encodeURIComponent(email)}`))[0]
  if (!target) return err('No roster profile with that email — add the user first')

  // Where invite / reset emails should land — the site's own origin (sent by
  // the frontend; GoTrue's redirect allow-list is the real gate).
  const redirectTo = typeof body.origin === 'string' && /^https?:\/\/[^\s]+$/.test(body.origin)
    ? body.origin.replace(/\/+$/, '') + '/set-password'
    : null

  switch (body.action) {
    case 'create_login':   return createLogin(target, body.password)
    case 'reset_password': return resetPassword(target, body.password)
    case 'invite':         return inviteUser(target, redirectTo)
    case 'send_reset':     return target.auth_id
      ? recoverEmail(target.email, redirectTo)
      : err(`${target.name} has no login yet — send an invite instead.`)
    case 'change_email':   return changeEmail(target, body.newEmail)
    case 'set_active':     return setActive(target, body.active)
    default:               return err('Unknown action')
  }
}

// ── Deals export (feeds the daily Google Sheets backup) ─────────────────────
// GET /api/export/deals?since=YYYY-MM-DD  ·  Authorization: Bearer <service key>
//
// Serves deal rows COMPUTED BY THE SAME ENGINE the site/payroll uses (stored
// amounts, override exclusions, bonuses, splits, rate eras all respected) so
// the spreadsheet backup can never drift from what the site pays. Rows are
// grouped by closing month; the Apps Script exporter (scripts/DealsExport.gs)
// formats them into tabs. Auth = the service key itself, which only the Apps
// Script project holds.
const money = (v) => Math.round((Number(v) || 0) * 100) / 100
const pctOf = (amt, base) => (base > 0 ? Math.round((amt / base) * 10000) / 100 : null)

async function exportDeals(since) {
  // Rate eras from settings so engine defaults match the site.
  try {
    const cfg = await restGet(`/rest/v1/app_settings?select=value&key=eq.override_rates`)
    if (Array.isArray(cfg[0]?.value) && cfg[0].value.length) setOverrideRateSchedule(cfg[0].value)
  } catch { /* no schedule configured — legacy constants apply */ }

  const select = encodeURIComponent('*,setter:setter_id(name),closer:closer_id(name),manager:manager_id(name),director:director_id(name),vp:vp_id(name)')
  const deals = []
  for (let offset = 0; ; ) {
    const page = await restGet(`/rest/v1/deals?select=${select}&sale_date=gte.${since}&order=sale_date.asc&limit=1000&offset=${offset}`)
    deals.push(...page)
    if (!page.length) break
    offset += page.length
  }

  const months = {}
  for (const d of deals) {
    if (!d.sale_date) continue
    const a = dealAmounts(d)
    const solo = !d.closer_id || d.setter_id === d.closer_id
    const row = {
      deal: d.deal_name || '—',
      closing_date: d.sale_date,
      install_date: d.install_date || '',
      office: d.office || '',
      payment: d.payment_method || '',
      setter: d.setter?.name || '',
      closer: solo ? (d.setter?.name || d.closer?.name || '') : (d.closer?.name || ''),
      baseline: money(a.baseline),
      total_price: money(a.job),
      setter_commission: money(a.setter),
      closer_commission: solo ? null : money(a.closer),
      commission_pct: pctOf(a.repCommission, a.baseline),
      manager: d.manager?.name || '',
      manager_pct: d.manager_id ? pctOf(a.manager, a.baseline) : null,
      manager_amount: d.manager_id ? money(a.manager) : null,
      director: d.director?.name || '',
      director_pct: d.director_id ? pctOf(a.director, a.baseline) : null,
      director_amount: d.director_id ? money(a.director) : null,
      vp: d.vp?.name || '',
      vp_pct: d.vp_id ? pctOf(a.vp, a.baseline) : null,
      vp_amount: d.vp_id ? money(a.vp) : null,
      status: d.status || '',
    }
    const key = d.sale_date.slice(0, 7)   // YYYY-MM
    ;(months[key] ||= []).push(row)
  }
  const monthName = (key) => new Date(key + '-15T12:00:00Z')
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  // Newest first, matching the site: tabs order + row order within each tab.
  for (const key of Object.keys(months)) {
    months[key].sort((a, b) => b.closing_date.localeCompare(a.closing_date) || a.deal.localeCompare(b.deal))
  }
  return {
    generatedAt: new Date().toISOString(),
    since,
    months: Object.keys(months).sort().reverse().map(key => ({ key, label: monthName(key), rows: months[key] })),
  }
}

// ── Lead / appointment ingest (feeds the Leads tab) ─────────────────────────
// POST /api/leads/ingest  ·  Authorization: Bearer <service key>
//
// ONE normalized contract for every possible pipe — a CRM webhook posting
// directly, a Zapier/Make step, or a polling script. Whichever we end up
// with, only the thin adapter that shapes the payload changes; everything
// downstream (table, page, estimate counts) stays put.
//
// Body: a single appointment object, or { leads: [ … ] } for a batch.
//   external_id*   the CRM's own appointment id — the dedup key
//   customer_name, address, phone, email, office, notes
//   appointment_at ISO timestamp of the appointment
//   status         scheduled | completed | sold | no_show | canceled
//                  (or send `disposition` and let the map below normalize it)
//   setter_email / closer_email   matched to profiles by email
//   setter_name  / closer_name    fallback labels when no match
//
// Upserts on (source, external_id) so a webhook firing twice is harmless.
const LEAD_STATUSES = ['scheduled', 'completed', 'sold', 'no_show', 'canceled']
// Common CRM dispositions → our lifecycle. Anything unrecognized stays
// 'scheduled' and keeps its raw text in `disposition` for review.
const DISPOSITION_MAP = {
  scheduled: 'scheduled', set: 'scheduled', booked: 'scheduled', upcoming: 'scheduled', pending: 'scheduled',
  completed: 'completed', complete: 'completed', ran: 'completed', run: 'completed', demoed: 'completed',
  presented: 'completed', quoted: 'completed', 'not sold': 'completed', 'no sale': 'completed', lost: 'completed',
  sold: 'sold', closed: 'sold', won: 'sold', 'closed won': 'sold',
  'no show': 'no_show', no_show: 'no_show', noshow: 'no_show', missed: 'no_show',
  canceled: 'canceled', cancelled: 'canceled', rescheduled: 'canceled',
}
// statusMap = the admin's own disposition → lifecycle overrides (Settings),
// checked before the built-in list so a team's custom wording always wins.
const normalizeStatus = (status, disposition, statusMap = {}) => {
  const raw = String(disposition ?? status ?? '').trim()
  const custom = statusMap[raw] || statusMap[raw.toLowerCase()]
  if (LEAD_STATUSES.includes(custom)) return custom
  const s = String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (LEAD_STATUSES.includes(s)) return s
  const d = raw.toLowerCase()
  return DISPOSITION_MAP[d] || DISPOSITION_MAP[d.replace(/[\s-]+/g, '_')] || 'scheduled'
}

// Read a possibly-nested value by dot path ("data.customer.name") so a
// mapping can reach into whatever shape the CRM sends.
function atPath(obj, path) {
  if (!path) return undefined
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

// Flatten a payload to dot-path → value, so the Settings mapper can list the
// exact field names the CRM sent (capped so a huge payload can't blow up).
function flattenPayload(obj, prefix = '', out = {}, depth = 0) {
  if (depth > 4 || Object.keys(out).length > 200) return out
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenPayload(v, key, out, depth + 1)
    else out[key] = Array.isArray(v) ? `[${v.length} items]` : v
  }
  return out
}

// Admin-defined field + disposition mapping (Admin → Settings → Lead Feed).
async function loadLeadConfig() {
  try {
    const rows = await restGet('/rest/v1/app_settings?select=key,value&key=in.(lead_field_map,lead_status_map)')
    const cfg = {}
    for (const r of rows) cfg[r.key] = r.value
    return { fieldMap: cfg.lead_field_map || {}, statusMap: cfg.lead_status_map || {} }
  } catch { return { fieldMap: {}, statusMap: {} } }
}

// Remember the most recent payload so the Settings mapper can show exactly
// what the CRM sent, with real field names to pick from.
async function recordLastPayload(sample) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/app_settings?on_conflict=key`, {
      method: 'POST',
      headers: { ...jsonHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{
        key: 'lead_last_payload',
        value: { at: new Date().toISOString(), fields: flattenPayload(sample), sample },
      }]),
    })
  } catch { /* diagnostics only — never fail an ingest over this */ }
}

async function ingestLeads(rawBody) {
  let body
  try { body = JSON.parse(rawBody || '{}') } catch { return err('Bad JSON body.') }
  const items = Array.isArray(body) ? body : Array.isArray(body.leads) ? body.leads : [body]
  if (!items.length) return err('No leads in the payload.')
  if (items.length > 500) return err('Too many leads in one call (max 500).')

  const { fieldMap, statusMap } = await loadLeadConfig()
  await recordLastPayload(items[0])
  // Our field ← whatever the admin mapped it to, else the same-named field.
  // A mapping may name SEVERAL paths separated by spaces — their values are
  // joined with a space, so a CRM that splits "first name" / "last name"
  // (very common) still fills one Customer Name field.
  const pick = (item, field) => {
    const mapped = fieldMap[field]
    if (!mapped) {
      const v = item[field]
      return v === '' || v === undefined ? null : v
    }
    const parts = String(mapped).trim().split(/\s+/)
      .map(p => atPath(item, p))
      .filter(v => v !== null && v !== undefined && v !== '')
    if (!parts.length) return null
    return parts.length === 1 ? parts[0] : parts.map(String).join(' ')
  }

  // Resolve people by email in one lookup.
  const emails = [...new Set(items.flatMap(i =>
    [pick(i, 'setter_email'), pick(i, 'closer_email')].filter(Boolean).map(e => String(e).trim().toLowerCase())))]
  const byEmail = {}
  if (emails.length) {
    const list = emails.map(e => `"${e.replace(/"/g, '')}"`).join(',')
    const rows = await restGet(`/rest/v1/profiles?select=id,email&email=in.(${encodeURIComponent(list)})`)
    for (const p of rows) byEmail[String(p.email).toLowerCase()] = p.id
  }

  const rows = []
  const unmatched = []
  for (const i of items) {
    const se = pick(i, 'setter_email'), ce = pick(i, 'closer_email')
    const setterEmail = se ? String(se).trim().toLowerCase() : null
    const closerEmail = ce ? String(ce).trim().toLowerCase() : null
    const setterId = setterEmail ? byEmail[setterEmail] || null : null
    const closerId = closerEmail ? byEmail[closerEmail] || null : null
    if (setterEmail && !setterId) unmatched.push(setterEmail)
    if (closerEmail && !closerId) unmatched.push(closerEmail)
    const extId = pick(i, 'external_id')
    const rawStatus = pick(i, 'status')
    const disposition = pick(i, 'disposition') ?? rawStatus
    const row = {
      source: String(pick(i, 'source') || 'repcard'),
      external_id: extId != null ? String(extId) : null,
      customer_name: pick(i, 'customer_name'),
      address: pick(i, 'address'),
      phone: pick(i, 'phone'),
      email: pick(i, 'email'),
      appointment_at: pick(i, 'appointment_at'),
      setter_id: setterId, closer_id: closerId,
      setter_name: pick(i, 'setter_name') ?? setterEmail ?? null,
      closer_name: pick(i, 'closer_name') ?? closerEmail ?? null,
      office: pick(i, 'office'),
      notes: pick(i, 'notes'),
      raw: i,
    }
    // Only touch the status when the CRM actually SENT an outcome. Most event
    // types (appointment updated, closer reassigned) carry an empty
    // disposition — writing a default 'scheduled' from those would wipe a
    // real "Sold"/"Ran" the outcome event had already recorded.
    if (disposition != null && String(disposition).trim() !== '') {
      row.status = normalizeStatus(rawStatus, disposition, statusMap)
      row.disposition = disposition
    }
    rows.push(row)
  }

  // PostgREST requires every object in a bulk upsert to have identical keys,
  // so send the with-status and without-status rows as separate batches.
  const withStatus = rows.filter(r => 'status' in r)
  const noStatus   = rows.filter(r => !('status' in r))
  for (const batch of [withStatus, noStatus]) {
    if (!batch.length) continue
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/leads?on_conflict=source,external_id`, {
      method: 'POST',
      headers: { ...jsonHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(batch),
    })
    if (!resp.ok) return err(`Write failed (${resp.status}): ${(await resp.text()).slice(0, 300)}`)
  }
  return ok({
    received: rows.length,
    // Surfaced so a rep whose CRM email doesn't match the roster is visible
    // immediately instead of silently landing without an owner.
    unmatched_emails: [...new Set(unmatched)],
  })
}

const app = express()
app.use(express.text({ type: '*/*', limit: '1mb' }))

app.get('/api/export/deals', async (req, res) => {
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(503).json(err('Export is not configured — SUPABASE_SERVICE_KEY is missing on the site service.'))
  const auth = String(req.headers.authorization || '')
  if (auth !== `Bearer ${SERVICE_KEY}`) return res.status(401).json(err('Unauthorized'))
  const since = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.since)) ? String(req.query.since) : '2026-07-01'
  try { res.json(await exportDeals(since)) }
  catch (e) { res.status(500).json(err(e.message || 'Export failed')) }
})

// Health check — pinged hourly by the Watchdog. Reports whether the
// user-admin key is configured and which build is running, so a broken deploy
// or missing SUPABASE_SERVICE_KEY is caught within the hour.
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    userAdmin: !!(SUPABASE_URL && SERVICE_KEY),
    build: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || null,
    at: new Date().toISOString(),
  })
})

// Auth for the CRM feed. Prefer LEADS_INGEST_SECRET — a dedicated token that
// ONLY opens this endpoint — so the database master key never has to be
// pasted into a third-party vendor's webhook config. The service key still
// works (handy for curl tests) but the vendor should get the scoped secret.
// Also accepts ?secret= for senders that can't set custom headers.
function ingestAuthorized(req) {
  const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
    || String(req.headers['x-api-key'] || '').trim()
    || String(req.query.secret || '').trim()
  if (!supplied) return false
  const scoped = (process.env.LEADS_INGEST_SECRET || '').trim()
  return (scoped && supplied === scoped) || (SERVICE_KEY && supplied === SERVICE_KEY)
}

app.post('/api/leads/ingest', async (req, res) => {
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(503).json(err('Lead ingest is not configured — SUPABASE_SERVICE_KEY is missing on the site service.'))
  if (!ingestAuthorized(req)) return res.status(401).json(err('Unauthorized'))
  try { res.json(await ingestLeads(req.body)) }
  catch (e) { res.status(500).json(err(e.message || 'Ingest failed')) }
})

app.post('/api/user-admin', async (req, res) => {
  try { res.json(await handleUserAdmin(req.body)) }
  catch (e) { res.json(err(e.message || 'Server error')) }
})

app.use(express.static(dist))
// SPA fallback — every non-file route serves the app shell.
app.use((req, res) => res.sendFile(path.join(dist, 'index.html')))

const port = process.env.PORT || 3000
app.listen(port, () => console.log(`Turf Time dashboard on :${port} (user admin ${SERVICE_KEY ? 'ready' : 'NOT configured'})`))
