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
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dealAmounts, setOverrideRateSchedule } from './src/utils/commission.js'
import {
  computeAudit, parseSetterName, cleanRep, resolvePerson, saleTypeFromLead,
  AUDIT_ITEM_KEYS, MANUAL_ITEM_KEYS,
} from './src/utils/dealAudit7.js'
import { dealNeedsReview } from './src/utils/needsReview.js'

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

async function restWrite(method, pathname, body, prefer) {
  const resp = await fetch(SUPABASE_URL + pathname, {
    method,
    headers: { ...jsonHeaders, ...(prefer ? { Prefer: prefer } : {}) },
    body: JSON.stringify(body),
  })
  if (!resp.ok) throw new Error(`Write failed (${resp.status}): ${(await resp.text()).slice(0, 200)}`)
  const text = await resp.text()
  return text ? JSON.parse(text) : null
}
const restPatch = (pathname, body) => restWrite('PATCH', pathname, body, 'return=minimal')

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
// ── Company-wide deals for the Dashboard / Competitions ──────
// WHY THIS EXISTS. `deals_select` (002_rls) shows a REP only the deals they
// set, closed, or hold an override on. That is right for the Deals page — but
// the Dashboard, the Record Book and competition standings are company-wide
// for everyone (per Keaton), and over that trimmed dataset they silently
// reported one rep's numbers as the company's. Corbin's phone showed $30,600
// revenue, 2 deals, and his own name on every record.
//
// So this endpoint serves every deal, read-only, to any signed-in user — with
// the override columns taken OUT. Reps must never see management override
// figures (a standing rule), and they do not need to: the Dashboard's
// commission is setter + closer only.
//
// THE SUBTLE PART, and the reason this is a server endpoint and not a database
// view. A rep's OWN commission depends on override data: `dealAmounts` clamps a
// management-funded rep bonus to what that manager actually earns
// (`Math.min(manager, bonus_manager)`). Strip the override columns naively and
// that clamp sees 0, the bonus vanishes, and the rep's commission comes out
// UNDERSTATED. The clamp cannot be reproduced in SQL either — the override is
// usually not stored, it is computed from the admin-editable rate eras.
//
// The fix: run the REAL engine here, where the full row is available, and emit
// the already-clamped contribution in place of each override amount. That value
// is the rep's own bonus money, not the manager's override. The browser's
// engine then computes an identical setter/closer, while `manager`/`director`/
// `vp` resolve to 0. One engine, exact figures, nothing sensitive sent.
const OVERRIDE_COLUMNS = [
  'manager_override_pct', 'director_override_pct', 'vp_override_pct',
  'manager_amount', 'director_amount', 'vp_amount',
]

async function companyDeals() {
  // Rate eras from settings so the engine here matches the site exactly.
  try {
    const cfg = await restGet(`/rest/v1/app_settings?select=value&key=eq.override_rates`)
    if (Array.isArray(cfg[0]?.value) && cfg[0].value.length) setOverrideRateSchedule(cfg[0].value)
  } catch { /* no schedule configured — legacy constants apply */ }

  const select = encodeURIComponent('*,setter:setter_id(id,name),closer:closer_id(id,name)')
  const rows = []
  for (let offset = 0; ; ) {
    const page = await restGet(`/rest/v1/deals?select=${select}&order=sale_date.desc&limit=1000&offset=${offset}`)
    rows.push(...page)
    if (!page.length) break
    offset += page.length
  }

  return rows.map(d => {
    const { bonusFrom } = dealAmounts(d)
    const safe = { ...d }
    for (const c of OVERRIDE_COLUMNS) delete safe[c]
    // ZERO the rates rather than leaving them absent. `dealAmounts` falls back
    // to the OFFICE rate when a director/VP pct is null, so simply deleting the
    // columns let the browser reconstruct the override as baseline x 5% — the
    // very figure this feed exists to withhold. Caught by the masking test.
    safe.manager_override_pct = 0
    safe.director_override_pct = 0
    safe.vp_override_pct = 0
    // The clamped contribution, carried in the *_amount slot so the browser's
    // engine reproduces the bonus exactly. Null when the role contributed
    // nothing, which keeps `manager`/`director`/`vp` at 0 for the viewer.
    safe.manager_amount  = d.manager_id  && bonusFrom.manager  > 0 ? bonusFrom.manager  : null
    safe.director_amount = d.director_id && bonusFrom.director > 0 ? bonusFrom.director : null
    safe.vp_amount       = d.vp_id       && bonusFrom.vp       > 0 ? bonusFrom.vp       : null
    // The people on a deal are needed for attribution, but management names
    // are not shown on these pages — drop the joins we did not request.
    delete safe.manager; delete safe.director; delete safe.vp
    return safe
  })
}

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
    // Hidden deals (migration 052) count toward nothing, so they stay out of
    // the backup spreadsheet entirely — including its per-month rep summary.
    // Canceled ones still ship: the script tints them red and the summary
    // excludes them, which is the right treatment for a job that fell through.
    if (d.hidden === true) continue
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
//   appointment_at ISO timestamp of the appointment (when it will HAPPEN)
//   set_at         ISO timestamp of when it was BOOKED — "Set" counts on this
//                  day, "ran"/"sold" on the appointment day (per Keaton).
//                  RepCard sends it as `createdAt` on every contact.
//   status         scheduled | completed | sold | no_show | canceled
//                  (or send `disposition` and let the map below normalize it)
//   setter_email / closer_email   matched to profiles by email
//   setter_name  / closer_name    fallback labels when no match
//
// Upserts on (source, external_id) so a webhook firing twice is harmless.
const LEAD_STATUSES = ['scheduled', 'completed', 'sold', 'no_show', 'canceled']

// Fallback field names, tried in order when the admin hasn't mapped one.
// Only `set_at` needs them: RepCard has no field called that — it sends the
// booking time as `createdAt` on every contact — and Set now counts on the
// day the appointment was BOOKED, so it has to resolve without anyone
// configuring it first. The admin's mapping still wins.
const LEAD_DEFAULTS = {
  set_at: ['createdAt', 'created_at', 'dateCreated', 'created', 'date_set', 'setDate'],
}
// Common CRM dispositions → our lifecycle. Anything unrecognized stays
// 'scheduled' and keeps its raw text in `disposition` for review.
const DISPOSITION_MAP = {
  scheduled: 'scheduled', set: 'scheduled', booked: 'scheduled', upcoming: 'scheduled', pending: 'scheduled',
  completed: 'completed', complete: 'completed', ran: 'completed', run: 'completed', demoed: 'completed',
  presented: 'completed', quoted: 'completed', 'not sold': 'completed', 'no sale': 'completed', lost: 'completed',
  sold: 'sold', closed: 'sold', won: 'sold', 'closed won': 'sold',
  'no show': 'no_show', no_show: 'no_show', noshow: 'no_show', missed: 'no_show',
  'no showed': 'no_show', 'no-showed': 'no_show',
  canceled: 'canceled', cancelled: 'canceled',
  // A RESCHEDULE IS NOT A CANCELLATION. Keaton confirmed with RepCard that a
  // rescheduled appointment KEEPS ITS external_id, so the feed updates the
  // same row and moves `appointment_at` to the new time — the appointment is
  // still going to happen. Mapping it to `canceled` (which it was, back when
  // we assumed a reschedule spawned a second record) left a live appointment
  // marked dead: it stopped counting as Ran even after it ran, until some
  // later event happened to carry a real outcome. It goes back to
  // `scheduled`. This is checked BEFORE the category fallback, so the
  // "(Not Held)" that rides along with it doesn't drag it back to canceled.
  rescheduled: 'scheduled', 're-scheduled': 'scheduled', reschedule: 'scheduled',
  'reschedule requested': 'scheduled', moved: 'scheduled',
  'canceled appointment': 'canceled', 'cancelled appointment': 'canceled',
  // RepCard's "Held" dispositions — the appointment RAN, sale or no sale.
  'signed up': 'sold',
  'not interested': 'completed', 'bad credit / not cash': 'completed',
  'follow up scheduled': 'completed', 'lost to competition': 'completed',
  'no urgency': 'completed', 'getting multiple bids': 'completed',
  // "Confirmation" dispositions say nothing about the outcome yet.
  confirmed: 'scheduled', 'not confirmed': 'scheduled',
}

// Some CRMs (RepCard) send the outcome as "<Disposition> (<Category>)" —
// "Signed Up (Held)", "No Showed (Not Held)", "Confirmed (Confirmation)".
// The category alone answers the only question we care about — did the
// appointment RUN? — so it backs up the disposition wording. That way a team
// inventing a new disposition still lands in the right lifecycle instead of
// silently falling through to 'scheduled'. "Not Held" defaults to canceled
// rather than no_show: two of its three options are cancel-ish, and pinning
// an unrecognised outcome on the customer as a no-show is the worse guess.
const CATEGORY_MAP = { held: 'completed', 'not held': 'canceled', confirmation: 'scheduled' }

// statusMap = the admin's own disposition → lifecycle overrides (Settings),
// checked before the built-in list so a team's custom wording always wins.
const normalizeStatus = (status, disposition, statusMap = {}) => {
  const raw = String(disposition ?? status ?? '').trim()
  const custom = statusMap[raw] || statusMap[raw.toLowerCase()]
  if (LEAD_STATUSES.includes(custom)) return custom
  const s = String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (LEAD_STATUSES.includes(s)) return s
  const paren = raw.match(/^(.*?)\s*\(([^)]*)\)\s*$/)
  const d = (paren ? paren[1] : raw).toLowerCase().trim()
  const category = paren ? paren[2].toLowerCase().trim() : ''
  return DISPOSITION_MAP[d]
    || DISPOSITION_MAP[d.replace(/[\s-]+/g, '_')]
    || CATEGORY_MAP[category]
    || 'scheduled'
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
async function recordLastPayload(sample, key = 'lead_last_payload') {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/app_settings?on_conflict=key`, {
      method: 'POST',
      headers: { ...jsonHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{
        key,
        value: { at: new Date().toISOString(), fields: flattenPayload(sample), sample },
      }]),
    })
  } catch { /* diagnostics only — never fail an ingest over this */ }
}

// Resolve people by email, FALLING BACK TO NAME — shared by every CRM feed.
// A CRM identifies a rep by their login there, which is usually a personal
// address (garrison.shaker@gmail.com) — not the company email on our
// roster. So email alone matched nobody and every feed event arrived
// ownerless. Names ("Garrison Shaker") do match, and the roster is small
// enough to fetch whole. A name shared by two people resolves to NEITHER —
// no owner beats the wrong owner.
async function loadRosterResolver() {
  const normName = (n) => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ')
  const byEmail = {}, byName = {}
  const dupes = new Set()
  const profs = await restGet('/rest/v1/profiles?select=id,name,email')
  for (const p of profs) {
    if (p.email) byEmail[String(p.email).toLowerCase()] = p.id
    const n = normName(p.name)
    if (!n) continue
    if (byName[n] && byName[n] !== p.id) dupes.add(n)
    byName[n] = p.id
  }
  for (const n of dupes) delete byName[n]
  return (email, name) => {
    const e = email ? String(email).trim().toLowerCase() : ''
    if (e && byEmail[e]) return byEmail[e]
    const n = normName(name)
    return (n && byName[n]) || null
  }
}

// Our field ← whatever the admin mapped it to, else the same-named field.
// A mapping may name SEVERAL paths separated by spaces — their values are
// joined with a space, so a CRM that splits "first name" / "last name"
// (very common) still fills one Customer Name field.
// `defaults` = per-field candidate paths tried IN ORDER when the admin hasn't
// mapped that field — how a known CRM shape (RepCard) works out of the box.
function makePicker(fieldMap, defaults = {}) {
  return (item, field) => {
    const mapped = fieldMap[field]
    if (!mapped) {
      for (const path of [field, ...(defaults[field] || [])]) {
        const v = atPath(item, path)
        if (v !== '' && v !== undefined && v !== null) return v
      }
      return null
    }
    const parts = String(mapped).trim().split(/\s+/)
      .map(p => atPath(item, p))
      .filter(v => v !== null && v !== undefined && v !== '')
    if (!parts.length) return null
    return parts.length === 1 ? parts[0] : parts.map(String).join(' ')
  }
}

async function ingestLeads(rawBody) {
  let body
  try { body = JSON.parse(rawBody || '{}') } catch { return err('Bad JSON body.') }
  const items = Array.isArray(body) ? body : Array.isArray(body.leads) ? body.leads : [body]
  if (!items.length) return err('No leads in the payload.')
  if (items.length > 500) return err('Too many leads in one call (max 500).')

  const { fieldMap, statusMap } = await loadLeadConfig()
  const pick = makePicker(fieldMap, LEAD_DEFAULTS)

  const resolvePerson = await loadRosterResolver()

  const rows = []
  const unmatched = []
  for (const i of items) {
    const se = pick(i, 'setter_email'), ce = pick(i, 'closer_email')
    const setterEmail = se ? String(se).trim().toLowerCase() : null
    const closerEmail = ce ? String(ce).trim().toLowerCase() : null
    const setterNamed = pick(i, 'setter_name')
    const closerNamed = pick(i, 'closer_name')
    const setterId = resolvePerson(setterEmail, setterNamed)
    const closerId = resolvePerson(closerEmail, closerNamed)
    if ((setterEmail || setterNamed) && !setterId) unmatched.push(setterNamed || setterEmail)
    if ((closerEmail || closerNamed) && !closerId) unmatched.push(closerNamed || closerEmail)
    const extId = pick(i, 'external_id')
    const rawStatus = pick(i, 'status')
    const disposition = pick(i, 'disposition') ?? rawStatus

    // A WEBHOOK EVENT IS A PARTIAL UPDATE, NOT A FULL RECORD.
    // RepCard's event types carry different blocks — an appointment-update
    // may omit the closer, an outcome may omit the contact. Writing every
    // column unconditionally meant any absent block landed as NULL and
    // silently erased good data (real bug: setters/closers vanishing).
    // So: only send a column when this payload actually provided it;
    // anything omitted keeps its stored value.
    const row = {
      source: String(pick(i, 'source') || 'repcard'),
      external_id: extId != null ? String(extId) : null,
      raw: i,
    }
    const put = (col, v) => { if (v !== null && v !== undefined && v !== '') row[col] = v }
    put('customer_name', pick(i, 'customer_name'))
    put('address', pick(i, 'address'))
    put('phone', pick(i, 'phone'))
    put('email', pick(i, 'email'))
    put('appointment_at', pick(i, 'appointment_at'))
    // When it was BOOKED, which is the date the Set stat counts on. Distinct
    // from appointment_at (when it happens) and from our own created_at (when
    // we first saw the row, which for a status-update event is long after).
    put('set_at', pick(i, 'set_at'))
    put('office', pick(i, 'office'))
    put('notes', pick(i, 'notes'))
    // People: THE FEED CAN SET SOMEONE, NEVER UNSET SOMEONE.
    // An id is written only on a positive roster match. If the event names a
    // person we can't match, we keep the name as text but leave the existing
    // id alone; if it says nothing about them, nothing is touched. A CRM event
    // that simply omits (or fails to resolve) a rep must never blank one that
    // was already correct — clearing a person stays a deliberate admin action.
    if (setterId) row.setter_id = setterId
    if (setterNamed || setterEmail) row.setter_name = setterNamed ?? setterEmail
    if (closerId) row.closer_id = closerId
    if (closerNamed || closerEmail) row.closer_name = closerNamed ?? closerEmail
    // Same rule for the outcome: most events carry an empty disposition, and
    // writing the 'scheduled' default from those would wipe a real Sold/Ran.
    if (disposition != null && String(disposition).trim() !== '') {
      row.status = normalizeStatus(rawStatus, disposition, statusMap)
      row.disposition = disposition
    }
    rows.push(row)
  }

  // PostgREST requires every object in a bulk upsert to have identical keys,
  // and rows now carry only the columns their event actually supplied — so
  // group by key signature and send one batch per shape.
  const batches = new Map()
  for (const r of rows) {
    const sig = Object.keys(r).sort().join(',')
    if (!batches.has(sig)) batches.set(sig, [])
    batches.get(sig).push(r)
  }
  for (const batch of batches.values()) {
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
    // Surfaced so a rep the CRM names but the roster can't place is visible
    // immediately instead of silently landing without an owner.
    unmatched_people: [...new Set(unmatched)],
  })
}

// ── Field activity feed (door knocking — migration 048) ─────────────────
// Same contract as the leads feed: admin-mapped fields (Admin → Settings →
// Field Activity Feed, `field_activity_field_map`), people resolved by email
// then name, partial updates only. Two payload shapes are accepted and both
// end up as ONE day row per rep:
//   • a DAILY SUMMARY carries a doors count (`doors_knocked`) for a day →
//     upserted on (source, rep_key, activity_date); the summary's numbers win.
//   • a PER-KNOCK EVENT carries a knock timestamp (`knock_at`) and the CRM's
//     event id → inserted into field_knocks (duplicates ignored) and the DB
//     trigger rolls it into the day row: doors +1, first/last knock min/max.
// The activity day is the ARIZONA calendar day of the timestamp (the DB does
// this for knocks; summaries send a plain date).
const FIELD_KEYS = ['field_activity_field_map']
// RepCard's door-knock event shape, seen live 2026-09-18: one contact object
// per knock — `id`, `createdAt` ("2026-09-18 23:07:45+00:00"), `user`/`owner`
// { name, email (personal — name is what matches), team }, `hasDoorKnock` /
// `verifiedDoorKnock` = 1. These paths are tried when the admin hasn't mapped
// the field, so the feed works the moment it is pointed here; an admin
// mapping always wins.
const FIELD_DEFAULTS = {
  external_id:  ['id', 'eventId', 'event_id'],
  rep_email:    ['user.email', 'owner.email', 'rep.email'],
  rep_name:     ['user.name', 'owner.name', 'rep.name', 'userName'],
  knock_at:     ['createdAt', 'created_at', 'knockedAt', 'timestamp'],
  knock_flag:   ['hasDoorKnock', 'verifiedDoorKnock', 'isDoorKnock'],
  activity_date: ['date', 'day'],
  doors_knocked: ['doors', 'doorsKnocked', 'door_knocks'],
  // no office default: RepCard's `user.location` is "Corporate Office", not a sales office
}
async function loadFieldConfig() {
  try {
    const rows = await restGet(`/rest/v1/app_settings?select=key,value&key=in.(${FIELD_KEYS.join(',')})`)
    const cfg = {}
    for (const r of rows) cfg[r.key] = r.value
    return { fieldMap: cfg.field_activity_field_map || {} }
  } catch { return { fieldMap: {} } }
}

const AZ_DAY = (ts) => {
  // 'yyyy-MM-dd' in America/Phoenix (no DST) for a timestamp — never a UTC slice.
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  const az = new Date(d.getTime() - 7 * 3600 * 1000)
  return az.toISOString().slice(0, 10)
}

async function ingestFieldActivity(rawBody) {
  let body
  try { body = JSON.parse(rawBody || '{}') } catch { return err('Bad JSON body.') }
  const items = Array.isArray(body) ? body
    : Array.isArray(body.activity) ? body.activity
    : Array.isArray(body.knocks) ? body.knocks
    : Array.isArray(body.events) ? body.events
    : [body]
  if (!items.length) return err('No activity in the payload.')
  if (items.length > 2000) return err('Too many rows in one call (max 2000).')

  const { fieldMap } = await loadFieldConfig()
  const pick = makePicker(fieldMap, FIELD_DEFAULTS)
  const resolvePerson = await loadRosterResolver()

  const summaries = [], knocks = [], unmatched = new Set(), skipped = [], detail = []
  for (const i of items) {
    const email = pick(i, 'rep_email'), name = pick(i, 'rep_name')
    const who = name || email || '(no rep on the event)'
    // RepCard posts the same contact shape for every door interaction; only
    // events flagged as a knock count. No flag at all = trust the webhook.
    const flag = pick(i, 'knock_flag')
    if (flag !== null && ['0', 'false', 'no', 'n'].includes(String(flag).trim().toLowerCase())) {
      skipped.push('not a door knock'); detail.push({ who, did: 'skipped', why: 'not a door knock (knock flag was 0/false)' }); continue
    }
    const profileId = resolvePerson(email, name)
    if ((email || name) && !profileId) unmatched.add(name || email)
    if (!profileId && !name && !email) { skipped.push('no rep on the event'); detail.push({ who, did: 'skipped', why: 'no rep name or email on the event' }); continue }
    const source = String(pick(i, 'source') || 'repcard')
    const office = pick(i, 'office')
    const doors = pick(i, 'doors_knocked')
    const knockAt = pick(i, 'knock_at')
    const extId = pick(i, 'external_id')

    if (doors !== null && doors !== undefined && doors !== '') {
      // Daily summary. The day is the payload's date, else the day of its
      // first knock, else today (Arizona).
      const dayRaw = pick(i, 'activity_date')
      const first = pick(i, 'first_knock_at'), last = pick(i, 'last_knock_at')
      const day = (dayRaw && /^\d{4}-\d{2}-\d{2}/.test(String(dayRaw))) ? String(dayRaw).slice(0, 10)
        : (dayRaw ? AZ_DAY(dayRaw) : null) || (first ? AZ_DAY(first) : null) || AZ_DAY(new Date().toISOString())
      const row = {
        source, activity_date: day, doors_knocked: Math.max(0, Math.round(Number(doors) || 0)),
        rep_name: name ?? email ?? null, raw: i,
      }
      const put = (col, v) => { if (v !== null && v !== undefined && v !== '') row[col] = v }
      if (profileId) row.profile_id = profileId
      put('rep_email', email ? String(email).trim().toLowerCase() : null)
      put('first_knock_at', first)
      put('last_knock_at', last)
      put('office', office)
      put('external_id', extId != null ? String(extId) : null)
      const mins = pick(i, 'field_minutes'), hrs = pick(i, 'field_hours')
      if (mins !== null && mins !== undefined && mins !== '') row.field_minutes = Math.round(Number(mins) || 0)
      else if (hrs !== null && hrs !== undefined && hrs !== '') row.field_minutes = Math.round((Number(hrs) || 0) * 60)
      summaries.push(row)
      detail.push({ who, did: 'day summary', matched: !!profileId, day, doors: row.doors_knocked })
    } else if (knockAt) {
      // Per-knock event — needs the CRM's event id so a re-fire is a no-op.
      const id = extId != null ? String(extId) : `${profileId || name || email}|${new Date(knockAt).toISOString()}`
      knocks.push({
        source, external_id: id, knock_at: knockAt,
        profile_id: profileId, rep_name: name ?? email ?? null,
        rep_email: email ? String(email).trim().toLowerCase() : null,
        office: office || null, raw: i,
      })
      detail.push({ who, did: 'knock', matched: !!profileId, day: AZ_DAY(knockAt), at: knockAt })
    } else {
      skipped.push('neither a doors count nor a knock time')
      detail.push({ who, did: 'skipped', why: 'neither a doors count nor a knock time — map Knock Time (or Doors Knocked + Date) in Settings' })
    }
  }

  // PostgREST needs identical keys within one bulk write → batch by shape.
  const byShape = (rows) => {
    const m = new Map()
    for (const r of rows) { const sig = Object.keys(r).sort().join(','); if (!m.has(sig)) m.set(sig, []); m.get(sig).push(r) }
    return [...m.values()]
  }
  for (const batch of byShape(summaries)) {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/field_activity?on_conflict=source,rep_key,activity_date`, {
      method: 'POST',
      headers: { ...jsonHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(batch),
    })
    if (!resp.ok) return err(`Write failed (${resp.status}): ${(await resp.text()).slice(0, 300)}`)
  }
  for (const batch of byShape(knocks)) {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/field_knocks?on_conflict=source,external_id`, {
      method: 'POST',
      headers: { ...jsonHeaders, Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(batch),
    })
    if (!resp.ok) return err(`Write failed (${resp.status}): ${(await resp.text()).slice(0, 300)}`)
  }
  return ok({
    received: items.length, summaries: summaries.length, knocks: knocks.length,
    skipped: skipped.length ? [...new Set(skipped)] : [],
    unmatched_people: [...unmatched],
    detail: detail.slice(0, 20),
  })
}

// Remember what the site DID with the last webhook call (not just what it
// received) so Admin → Settings can say "1 knock recorded for Joseph Burgos"
// or "skipped: not a door knock" or the write error — the vendor's webhook
// screen never shows our response, so this is the only place to read it.
async function recordLastResult(key, result) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/app_settings?on_conflict=key`, {
      method: 'POST',
      headers: { ...jsonHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ key, value: { at: new Date().toISOString(), ...result } }]),
    })
  } catch { /* diagnostics only */ }
}


// ── One webhook URL, two kinds of event ─────────────────────────────────────
// RepCard posts the SAME contact object for an appointment and for a door
// knock, and a vendor webhook usually points at ONE url. So both endpoints
// CLASSIFY each event and hand it to the right handler instead of trusting
// the url it arrived at:
//   • an appointment time  → the leads feed
//   • a knock flag / knock time / doors count → the field-activity feed
//   • both  → both (a knock that booked an appointment is genuinely both)
//   • neither → whichever endpoint it was sent to
// Without this, a door knock posted to /api/leads/ingest became a junk
// "Not Home" appointment and never reached the Performance page.
const TRUTHY = (v) => v !== null && v !== undefined && v !== ''
  && !['0', 'false', 'no', 'n'].includes(String(v).trim().toLowerCase())

async function routeCrmEvents(rawBody, arrivedAt) {
  let body
  try { body = JSON.parse(rawBody || '{}') } catch { return err('Bad JSON body.') }
  const items = Array.isArray(body) ? body
    : Array.isArray(body.leads) ? body.leads
    : Array.isArray(body.activity) ? body.activity
    : Array.isArray(body.knocks) ? body.knocks
    : Array.isArray(body.events) ? body.events
    : [body]
  if (!items.length) return err('No events in the payload.')
  if (items.length > 2000) return err('Too many events in one call (max 2000).')

  const [{ fieldMap: leadMap }, { fieldMap: fldMap }] = await Promise.all([loadLeadConfig(), loadFieldConfig()])
  const lp = makePicker(leadMap), fp = makePicker(fldMap, FIELD_DEFAULTS)

  // A knock time alone is NOT a knock signal unless the admin mapped that
  // field on purpose: the default path reads RepCard's `createdAt`, which
  // every contact carries, so trusting it would turn every appointment into
  // a door knock too.
  const knockTimeIsExplicit = !!fldMap.knock_at
  const apptItems = [], knockItems = []
  for (const i of items) {
    const hasAppt = TRUTHY(lp(i, 'appointment_at'))
    const flag = fp(i, 'knock_flag')
    const hasKnock = flag !== null && flag !== undefined && flag !== ''
      ? TRUTHY(flag)                                   // an explicit flag decides it outright
      : TRUTHY(fp(i, 'doors_knocked')) || (knockTimeIsExplicit && TRUTHY(fp(i, 'knock_at')))
    if (hasAppt) apptItems.push(i)
    if (hasKnock) knockItems.push(i)
    if (!hasAppt && !hasKnock) (arrivedAt === 'field' ? knockItems : apptItems).push(i)
  }

  const leadRes  = apptItems.length  ? await ingestLeads(JSON.stringify(apptItems)) : null
  const fieldRes = knockItems.length ? await ingestFieldActivity(JSON.stringify(knockItems)) : null

  const routed = { appointments: apptItems.length, knocks: knockItems.length }
  const merged = {
    received: items.length,
    routed,
    // Field-feed figures so the Settings "Last result" box reads the same
    // whichever panel you look at.
    knocks: fieldRes?.knocks ?? 0,
    summaries: fieldRes?.summaries ?? 0,
    appointments: leadRes?.received ?? 0,
    skipped: [...new Set([...(fieldRes?.skipped || []), ...(leadRes?.skipped || [])])],
    detail: fieldRes?.detail || [],
    unmatched_people: [...new Set([...(leadRes?.unmatched_people || []), ...(fieldRes?.unmatched_people || [])])],
  }
  const failed = [leadRes, fieldRes].find(r => r && r.ok === false)
  const result = failed ? { ...failed, routed } : ok(merged)

  // Record the payload + outcome under the feed(s) that actually handled it,
  // so the right Settings panel shows it no matter which url the CRM uses.
  const jobs = []
  if (apptItems.length)  jobs.push(recordLastPayload(apptItems[0]), recordLastResult('lead_last_result', result))
  if (knockItems.length) jobs.push(recordLastPayload(knockItems[0], 'field_last_payload'), recordLastResult('field_last_result', result))
  await Promise.all(jobs)
  return result
}

// ── Deal audit — install sheet (read-only) + 7-item checklist ───────────────
// Reads the install Google Sheet with a service account (server-side only;
// never exposed to the browser), matches each deal to its booking, and persists
// the auto-check results into deal_checklist. See src/utils/dealAudit7.js.
const INSTALL_SHEET_ID = (process.env.INSTALL_SHEET_ID || '').trim()
const AUDIT_TABS = ['Jobs', 'Schedule']

let _sheetCache = { at: 0, data: null }
let _googleToken = { token: null, exp: 0 }

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

// Service-account access token (RS256 JWT → oauth2), cached until ~1m before
// expiry. No google client library needed — Node's crypto signs the assertion.
async function googleAccessToken() {
  if (_googleToken.token && Date.now() < _googleToken.exp - 60000) return _googleToken.token
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set on the site service')
  let sa
  try { sa = JSON.parse(raw) } catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON') }
  if (!sa.client_email || !sa.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON missing client_email/private_key')
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }))
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(`${header}.${claim}`)
  const assertion = `${header}.${claim}.${b64url(signer.sign(sa.private_key))}`
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  if (!resp.ok) throw new Error(`Google token failed (${resp.status}): ${(await resp.text()).slice(0, 160)}`)
  const j = await resp.json()
  _googleToken = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 }
  return _googleToken.token
}

function parseTab(rows) {
  if (!rows || rows.length < 2) return { headers: [], rows: [] }
  const headers = rows[0].map(x => String(x || '').trim())
  const out = []
  for (let r = 1; r < rows.length; r++) {
    const o = {}
    headers.forEach((h, i) => { o[h] = rows[r][i] != null ? String(rows[r][i]) : '' })
    out.push(o)
  }
  return { headers, rows: out }
}

// Both tabs in one values.batchGet, cached 60s.
async function readInstallSheet() {
  if (_sheetCache.data && Date.now() - _sheetCache.at < 60000) return _sheetCache.data
  if (!INSTALL_SHEET_ID) throw new Error('INSTALL_SHEET_ID is not set on the site service')
  const token = await googleAccessToken()
  const qs = AUDIT_TABS.map(t => `ranges=${encodeURIComponent(t)}`).join('&')
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${INSTALL_SHEET_ID}/values:batchGet?${qs}&majorDimension=ROWS`
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!resp.ok) throw new Error(`Install sheet read failed (${resp.status}): ${(await resp.text()).slice(0, 160)}`)
  const j = await resp.json()
  const byTab = {}
  for (const vr of j.valueRanges || []) {
    const tab = String(vr.range || '').split('!')[0].replace(/^'|'$/g, '')
    byTab[tab] = vr.values || []
  }
  const data = { jobs: parseTab(byTab.Jobs), schedule: parseTab(byTab.Schedule) }
  _sheetCache = { at: Date.now(), data }
  return data
}

// ── Deal audit — GoHighLevel (read-only) ────────────────────────────────────
// Item 8 (ghl_information): confirm the deal's GHL contact has the sales rep,
// install date, commission, and payment method filled in. Uses a read-only
// Private Integration token (GHL_API_TOKEN) scoped to contacts + custom fields;
// the location defaults to Turf Time's sub-account. Entirely non-fatal — any
// failure (no token, Cloudflare block, no match) just fails item 8 and leaves
// the other seven checks working.
// Two tokens, least-privilege: GHL_API_TOKEN (read-only) does every read — the
// verify side that runs on every audit — and GHL_WRITE_TOKEN (write-scoped) is
// used ONLY for the "Fill blanks" write. GHL_WRITE_TOKEN falls back to
// GHL_API_TOKEN when unset, so a single-token setup still works.
const GHL_API_TOKEN   = (process.env.GHL_API_TOKEN || '').trim()
const GHL_WRITE_TOKEN = (process.env.GHL_WRITE_TOKEN || '').trim() || GHL_API_TOKEN
// Media upload needs its OWN token: GHL scopes medias.write separately, so the
// opportunity-write token 401s on /medias. Falls back to the write token.
const GHL_MEDIA_TOKEN = (process.env.GHL_MEDIA_TOKEN || '').trim() || GHL_WRITE_TOKEN
const GHL_LOCATION_ID = (process.env.GHL_LOCATION_ID || 'lm0glrcKsZ05EcZrGS9t').trim()
// New-sale TEXT alerts need their OWN token: GHL scopes conversations
// message-send separately, so the opportunity token 401s on /conversations.
// Without this set, sale-alert texts simply don't send (everything else works).
const GHL_SMS_TOKEN = (process.env.GHL_SMS_TOKEN || '').trim()
// Who gets the new-sale text — GHL contact ids, comma-separated. Defaults to
// Tanner / Keaton / Garrison; override with SALE_ALERT_CONTACT_IDS.
const SALE_ALERT_CONTACTS = (process.env.SALE_ALERT_CONTACT_IDS
  || 'OjhxskL9Tc6kE6wXPcFU,QPCjvSdLNjsfFnhC07YM,tyHlLNS6nuB1BdQRe1hH')
  .split(',').map(s => s.trim()).filter(Boolean)
const GHL_BASE = 'https://services.leadconnectorhq.com'
// Known custom-field ids (fallbacks when name resolution misses them).
const GHL_KNOWN_FIELDS = { sales_rep: 'QoJSUx7z3LIeaZw6fwDb', install_date: 'IMYajaM4Jv4eOG65exQZ' }
// GHL custom-field NAMES (lowercased) that map to each thing we confirm.
const GHL_FIELD_NAMES = {
  sales_rep:      ['sales rep', 'sales representative', 'rep', 'closer'],
  install_date:   ['install date', 'installation date'],
  commission:     ['commission'],
  payment_method: ['payment method', 'payment type', 'payment'],
}
let _ghlFields = { at: 0, map: null }  // our key -> resolved field id

// GHL sits behind Cloudflare, which 1010-blocks non-browser agents — a browser
// User-Agent + the Version header are required.
function ghlHeaders(token = GHL_API_TOKEN) {
  return {
    Authorization: `Bearer ${token}`,
    Version: '2021-07-28',
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  }
}

async function ghlGet(path) {
  const resp = await fetch(`${GHL_BASE}${path}`, { headers: ghlHeaders() })
  if (!resp.ok) throw new Error(`GHL ${resp.status}: ${(await resp.text()).slice(0, 120)}`)
  return resp.json()
}

// Resolve the 4 target fields by NAME (cached 10m) → { id, dataType }, with the
// known ids as fallbacks — so a renamed/added GHL field is picked up without a
// code change. dataType drives how a written value is formatted.
async function ghlFieldMap() {
  if (_ghlFields.map && Date.now() - _ghlFields.at < 600000) return _ghlFields.map
  const j = await ghlGet(`/locations/${GHL_LOCATION_ID}/customFields`)
  const byName = {}
  for (const f of j.customFields || []) {
    byName[String(f.name || '').trim().toLowerCase()] = {
      id: f.id, dataType: f.dataType || null,
      options: f.picklistOptions || f.options || null,   // dropdown choices, when any
    }
  }
  const map = {}
  for (const [key, names] of Object.entries(GHL_FIELD_NAMES)) {
    map[key] = names.map(n => byName[n]).find(Boolean)
      || (GHL_KNOWN_FIELDS[key] ? { id: GHL_KNOWN_FIELDS[key], dataType: null, options: null } : null)
  }
  _ghlFields = { at: Date.now(), map }
  return map
}

// GHL custom-field value → a comparable 'YYYY-MM-DD' (install date is epoch ms).
function ghlFieldToYMD(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!isNaN(n) && n > 10000000000) return toYMD(new Date(n).toISOString())
  return toYMD(String(v))
}
const ghlToNumber = (v) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n }

// Match a site value to one of a dropdown field's options (exact first, then
// either-contains), returning the option's exact text or null. Options may be
// plain strings or { name|label|value } objects.
function matchGhlOption(value, options) {
  if (!options || !options.length) return null
  const optText = (o) => String(typeof o === 'string' ? o : (o.name || o.label || o.value || '')).trim()
  // Strip spaces/punctuation so "Self-Pay" matches "Self Pay",
  // "Self-Pay + Sunlight" matches "Selfpay + Sunlight", etc.
  const strip = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const want = strip(value)
  if (!want) return null
  let hit = options.find(o => strip(optText(o)) === want)
  if (!hit) hit = options.find(o => { const n = strip(optText(o)); return n && (n.includes(want) || want.includes(n)) })
  return hit ? optText(hit) : null
}

const ghlDigits = (s) => String(s || '').replace(/\D/g, '').slice(-10)
const ghlNorm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()
// Customer name = the deal name up to the first dash/comma (deal names look
// like "Smith — 1 Maple Rd" / "Smith, 1 Maple Rd").
const ghlCustomerName = (deal) => String(deal.deal_name || '').split(/[—–-]|,/)[0].trim()

// Find the GHL contact for a deal: phone first (exact 10 digits), then name.
async function ghlFindContact(deal) {
  const phone = ghlDigits(deal.customer_phone)
  if (phone) {
    try {
      const j = await ghlGet(`/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&number=%2B1${phone}`)
      if (j.contact && j.contact.id) return j.contact.id
    } catch { /* fall through to a name match */ }
  }
  const name = ghlCustomerName(deal)
  if (name) {
    const j = await ghlGet(`/contacts/?locationId=${GHL_LOCATION_ID}&query=${encodeURIComponent(name)}&limit=10`)
    const want = ghlNorm(name)
    const hit = (j.contacts || []).find(c => ghlNorm(c.contactName || `${c.firstName || ''} ${c.lastName || ''}`) === want)
    if (hit) return hit.id
  }
  return null
}

const GHL_KEYS = ['install_date', 'sales_rep', 'commission', 'payment_method']

// The GHL side of item 8 for ONE deal. Never throws — returns the shape
// computeAudit() reads: the per-field GHL value, whether the field exists, and
// whether it's populated. computeAudit does the three-way compare vs site/sheet.
async function readDealGhl(deal) {
  if (!GHL_API_TOKEN) return { configured: false }
  try {
    const fields = await ghlFieldMap()
    const contactId = await ghlFindContact(deal)
    if (!contactId) return { configured: true, matched: false }
    const { contact } = await ghlGet(`/contacts/${contactId}`)
    const cf = {}
    for (const f of (contact && contact.customFields) || []) cf[f.id] = f.value
    const raw = (key) => (fields[key] ? cf[fields[key].id] : undefined)
    const present = (v) => Array.isArray(v) ? v.length > 0 : String(v ?? '').trim() !== ''
    const nm = contact && (contact.contactName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim())
    const fieldExists = {}, isPresent = {}, values = {}
    for (const key of GHL_KEYS) {
      fieldExists[key] = !!fields[key]
      isPresent[key] = present(raw(key))
      values[key] = !isPresent[key] ? null
        : key === 'install_date' ? ghlFieldToYMD(raw(key))
        : key === 'commission'   ? ghlToNumber(raw(key))
        : String(raw(key)).trim()
    }
    return { configured: true, matched: true, contactId, contactName: nm || null, fieldExists, present: isPresent, values }
  } catch (e) {
    return { configured: true, error: e.message || 'request failed' }
  }
}

// "9626 W MITCHELL DR, Phoenix, AZ 85037" → { address1, city, state, postalCode }.
function parseAddress(s) {
  const parts = String(s || '').split(',').map(x => x.trim()).filter(Boolean)
  if (!parts.length) return null
  const out = { address1: parts[0] }
  if (parts[1]) out.city = parts[1]
  const m = parts.slice(2).join(' ').match(/([A-Za-z]{2})\s*(\d{5})?/)
  if (m) { out.state = m[1].toUpperCase(); if (m[2]) out.postalCode = m[2] }
  return out
}

// WRITE: fill ONLY the empty GHL fields with the site's values — never
// overwrites a value already there (a conflicting value is flagged by the
// audit, not clobbered). Fills the 4 custom fields AND the customer's phone /
// address on the contact. Needs a write-scoped token; a 401/403 says so.
async function ghlFillBlanks(deal, usersById) {
  if (!GHL_API_TOKEN) throw new Error('GHL is not connected (GHL_API_TOKEN not set).')
  const fields = await ghlFieldMap()
  const contactId = await ghlFindContact(deal)
  if (!contactId) throw new Error('No GHL contact matched this deal (by phone or name).')
  const { contact } = await ghlGet(`/contacts/${contactId}`)
  const cf = {}
  for (const f of (contact && contact.customFields) || []) cf[f.id] = f.value
  const present = (v) => Array.isArray(v) ? v.length > 0 : String(v ?? '').trim() !== ''

  const amt = dealAmounts(deal)
  const closerName = (deal.closer_id && usersById[deal.closer_id] && usersById[deal.closer_id].name)
    || (deal.setter_id && usersById[deal.setter_id] && usersById[deal.setter_id].name) || null
  const site = {
    install_date: deal.install_date || null,
    sales_rep: closerName,
    commission: amt.repCommission != null ? Math.round(amt.repCommission * 100) / 100 : null,
    payment_method: deal.payment_method || null,
  }

  const writes = []
  for (const key of GHL_KEYS) {
    const f = fields[key]
    if (!f) continue                                      // no such GHL field
    if (present(cf[f.id])) continue                       // already set — never overwrite
    if (site[key] == null || site[key] === '') continue   // nothing to write
    const dt = String(f.dataType || '').toUpperCase()
    const isSingleOpt = dt === 'SINGLE_OPTIONS' || dt === 'RADIO'
    const isMultiOpt  = dt === 'MULTIPLE_OPTIONS' || dt === 'CHECKBOX'
    let value
    // GHL DATE custom fields want a 'YYYY-MM-DD' string on write (epoch ms is
    // rejected with "Invalid Custom Field Value"), even though reads come back
    // as epoch ms. site.install_date is already 'YYYY-MM-DD'.
    if (key === 'install_date' || dt.includes('DATE')) value = String(site[key])
    else if (dt.includes('MONET') || dt.includes('NUMER') || dt === 'NUMBER') value = Number(site[key])
    else if (isSingleOpt || isMultiOpt) {
      // A dropdown/radio/checkbox only accepts one of its own options — send the
      // matching option, never a raw string (which 400s like the date did). No
      // match → skip this field rather than break the whole write.
      const opt = matchGhlOption(site[key], f.options)
      if (!opt) continue
      value = isMultiOpt ? [opt] : opt
    }
    else value = String(site[key])
    writes.push({ id: f.id, value })
  }

  // Customer info → standard contact fields (phone + address), blanks only.
  const std = {}
  if (!present(contact && contact.phone) && String(deal.customer_phone || '').trim()) {
    std.phone = String(deal.customer_phone).trim()
  }
  if (!present(contact && contact.address1) && String(deal.customer_address || '').trim()) {
    const a = parseAddress(deal.customer_address)
    if (a) Object.assign(std, a)
  }

  const count = writes.length + Object.keys(std).length
  if (!count) return { filled: 0 }
  const body = { ...std }
  if (writes.length) body.customFields = writes
  const resp = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    method: 'PUT',
    headers: { ...ghlHeaders(GHL_WRITE_TOKEN), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const txt = (await resp.text()).slice(0, 160)
    if (resp.status === 401 || resp.status === 403) throw new Error(`GHL write denied (${resp.status}) — the token needs the contacts.write scope. ${txt}`)
    throw new Error(`GHL write failed (${resp.status}): ${txt}`)
  }
  return { filled: count }
}

// A sheet date cell → 'YYYY-MM-DD' (date only). Handles ISO, M/D/YYYY, and a
// parseable date (resolved in Phoenix). null when unparseable/empty.
function toYMD(v) {
  const s = String(v || '').trim()
  if (!s) return null
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (m) {
    let [, mo, d, y] = m
    if (y.length === 2) y = '20' + y
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  const dt = new Date(s)
  if (!isNaN(dt.getTime())) {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(dt)
    const g = (t) => p.find(x => x.type === t).value
    return `${g('year')}-${g('month')}-${g('day')}`
  }
  return null
}

// Match ONE deal to its calendar booking (see the prompt's matching rules).
function buildBooking(deal, sheet, profiles) {
  const dealPid = String(deal.project_id || '').trim()
  if (!dealPid) return { onCalendar: false, matched: false }

  const jIx = {}
  for (const j of sheet.jobs.rows) {
    const pid = String(j['Proposal ID'] || '').trim()
    if (!pid) continue
    jIx[pid] = {
      projectId: String(j['Project ID'] || '').trim(),
      phone: String(j['Customer Phone'] || '').trim(),
      address: String(j['Install Address'] || '').trim(),
    }
  }

  const cands = []
  sheet.schedule.rows.forEach((row, i) => {
    const prop = String(row['Proposal ID'] || '').trim()
    if (!prop || prop.indexOf('CAL-') === 0) return
    const job = jIx[prop]
    const projectId = job && job.projectId ? job.projectId : prop
    if (projectId === dealPid || prop === dealPid) cands.push({ row, i, job })
  })
  if (!cands.length) return { onCalendar: false, matched: false }

  const isCancelled = (c) => String(c.row['Status'] || '').trim().toUpperCase() === 'CANCELLED'
  const live = cands.filter(c => !isCancelled(c))
  // Most recent non-cancelled wins (later sheet row = more recent); if all are
  // cancelled, treat as not on the calendar.
  if (!live.length) return { onCalendar: false, matched: true, allCancelled: true }
  const win = live.reduce((a, b) => (b.i >= a.i ? b : a))

  const row = win.row
  const lead = String(row['Lead Source'] || '').trim()
  const closerName = cleanRep(row['Sales Rep'])
  const setterName = parseSetterName(lead) || closerName
  const setterP = resolvePerson(setterName, profiles)
  const closerP = resolvePerson(closerName, profiles)
  return {
    onCalendar: true,
    matched: true,
    installDate: toYMD(row['Install Date']),
    status: String(row['Status'] || '').trim(),
    leadSourceRaw: lead || null,
    saleType: saleTypeFromLead(lead),
    setterName, closerName,
    setterId: setterP ? setterP.id : null,
    closerId: closerP ? closerP.id : null,
    setterResolved: !!setterP,
    closerResolved: !!closerP,
    payment: String(row['Payment'] || '').trim() || null,
    customerPhone: win.job ? win.job.phone : '',
    customerAddress: win.job ? win.job.address : '',
  }
}

// Authenticate + authorize the caller as an admin OR Keaton (same rule as the
// /audit page). Returns the caller profile, or throws a message string.
async function verifyAuditor(body) {
  if (!body.token) throw new Error('Not signed in')
  const meResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${body.token}` },
  })
  if (!meResp.ok) throw new Error('Session invalid — sign in again')
  const authId = (await meResp.json()).id
  const caller = (await restGet(`/rest/v1/profiles?select=id,name,email,role,is_admin,active&auth_id=eq.${authId}`))[0]
  const isKeaton = caller && (String(caller.email || '').toLowerCase() === 'keaton@turftime.com' || caller.name === 'Keaton Shaker')
  if (!caller || caller.active === false || !(caller.role === 'admin' || caller.is_admin === true || isKeaton)) {
    throw new Error('Admins (or Keaton) only')
  }
  return caller
}

async function auditDataStart() {
  try {
    const r = await restGet(`/rest/v1/app_settings?select=value&key=eq.data_start_date`)
    const v = r[0] && r[0].value
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '2026-06-01'
  } catch { return '2026-06-01' }
}

// Run the audit for ONE deal (deal object already loaded), with the shared
// sheet + roster. Persists auto items, backfills contact info, flips the deal
// to Deal Reviewed when all items are checked. Returns the per-item result.
async function auditOneDeal(deal, sheet, profiles, usersById, callerId, autoFill = false) {
  const booking = buildBooking(deal, sheet, profiles)

  // Item 5 backfill: fill empty contact fields from the Jobs tab, never
  // overwrite a non-empty value. Informational only.
  if (booking.matched) {
    const patch = {}
    if (!String(deal.customer_phone || '').trim() && booking.customerPhone) patch.customer_phone = booking.customerPhone
    if (!String(deal.customer_address || '').trim() && booking.customerAddress) patch.customer_address = booking.customerAddress
    if (Object.keys(patch).length) {
      await restPatch(`/rest/v1/deals?id=eq.${deal.id}`, patch)
      Object.assign(deal, patch)
    }
  }

  // Item 8 (GHL) — read-only, non-fatal; failures just fail that one item.
  let ghl = await readDealGhl(deal)
  // Auto-fill: when asked (the queue + per-deal re-run), push the site's values
  // into the empty GHL fields automatically — no button click. Fills blanks
  // only, never overwrites a conflict, and is non-fatal (a write failure just
  // leaves the field blank + the manual "Fill blanks" button). Re-read after a
  // successful write so the row reflects what GHL now holds.
  if (autoFill && ghl.matched && GHL_WRITE_TOKEN) {
    const blanks = GHL_KEYS.some(k => ghl.fieldExists?.[k] && !ghl.present?.[k])
    if (blanks) {
      try { const r = await ghlFillBlanks(deal, usersById); if (r.filled > 0) ghl = await readDealGhl(deal) }
      catch { /* non-fatal — manual fill stays available */ }
    }
  }
  const { items } = computeAudit(deal, booking, usersById, ghl)

  // Existing checklist rows for this deal.
  const existing = {}
  for (const row of await restGet(`/rest/v1/deal_checklist?select=item_key,checked,source,note&deal_id=eq.${deal.id}`)) {
    existing[row.item_key] = row
  }

  // Persist AUTO items only — manual items are never touched by the audit.
  for (const it of items) {
    if (it.manual) continue
    const want = !!it.pass
    const prev = existing[it.key]
    if (prev && prev.source === 'audit' && prev.checked === want && (prev.note || null) === (it.reason || null)) continue
    await restWrite('POST', '/rest/v1/deal_checklist?on_conflict=deal_id,item_key',
      { deal_id: deal.id, item_key: it.key, checked: want, source: 'audit', checked_by: null, checked_at: new Date().toISOString(), note: it.reason || null },
      'resolution=merge-duplicates,return=minimal')
    await restWrite('POST', '/rest/v1/deal_checklist_history',
      { deal_id: deal.id, item_key: it.key, checked: want, source: 'audit', checked_by: null, note: it.reason || null }, 'return=minimal')
    existing[it.key] = { item_key: it.key, checked: want, source: 'audit', note: it.reason || null }
  }

  // Current checked state per item: auto items follow the computed pass; manual
  // items follow the stored row.
  const result = items.map(it => ({
    key: it.key, label: it.label, manual: it.manual,
    pass: it.manual ? null : !!it.pass,
    checked: it.manual ? !!(existing[it.key] && existing[it.key].checked) : !!it.pass,
    reason: it.reason || null,
    fix: it.fix || null,
  }))
  const doneCount = result.filter(r => r.checked).length
  const allChecked = doneCount === AUDIT_ITEM_KEYS.length

  // All items checked → Deal Reviewed + gold check, in one write. Never auto-revert.
  if (allChecked && (deal.status !== 'Deal Reviewed' || deal.commission_verified !== true)) {
    await restPatch(`/rest/v1/deals?id=eq.${deal.id}`, { status: 'Deal Reviewed', commission_verified: true })
    deal.status = 'Deal Reviewed'; deal.commission_verified = true
  }

  return {
    deal_id: deal.id, deal_name: deal.deal_name,
    done: doneCount, total: AUDIT_ITEM_KEYS.length,
    reviewed: allChecked, on_calendar: !!booking.onCalendar,
    items: result,
  }
}

async function loadRosterForAudit() {
  const profiles = await restGet('/rest/v1/profiles?select=id,name')
  const usersById = {}
  profiles.forEach(p => { usersById[p.id] = p })
  return { profiles, usersById }
}

const DEAL_COLS = 'id,deal_name,project_id,status,sale_date,install_date,pay_date,baseline_revenue,job_price,office,payment_method,setter_id,closer_id,manager_id,director_id,vp_id,setter_split_pct,manager_override_pct,director_override_pct,vp_override_pct,manager_to_rep_pct,director_to_rep_pct,vp_to_rep_pct,setter_amount,closer_amount,manager_amount,director_amount,vp_amount,deduction_amount,deduction_paid_by,deduction_split_pct,financed_amount,dealer_fee_pct,override_exclusions,bonus_company,bonus_manager,bonus_director,bonus_vp,bonus_recipient,bonus_split_pct,commission_verified,change_alert,customer_phone,customer_address,hidden'

async function handleAuditDeal(rawBody) {
  if (!SUPABASE_URL || !SERVICE_KEY) return err('Audit is not configured — SUPABASE_SERVICE_KEY is missing on the site service.')
  let body; try { body = JSON.parse(rawBody || '{}') } catch { return err('Bad request body.') }
  let caller; try { caller = await verifyAuditor(body) } catch (e) { return err(e.message) }
  if (!body.deal_id) return err('Missing deal_id')
  const deal = (await restGet(`/rest/v1/deals?select=${DEAL_COLS}&id=eq.${body.deal_id}`))[0]
  if (!deal) return err('Deal not found')
  let sheet; try { sheet = await readInstallSheet() } catch (e) { return err(e.message) }
  const { profiles, usersById } = await loadRosterForAudit()
  return ok({ audit: await auditOneDeal(deal, sheet, profiles, usersById, caller.id, true) })
}

async function handleAuditQueue(rawBody) {
  if (!SUPABASE_URL || !SERVICE_KEY) return err('Audit is not configured — SUPABASE_SERVICE_KEY is missing on the site service.')
  let body; try { body = JSON.parse(rawBody || '{}') } catch { return err('Bad request body.') }
  let caller; try { caller = await verifyAuditor(body) } catch (e) { return err(e.message) }
  let sheet; try { sheet = await readInstallSheet() } catch (e) { return err(e.message) }
  const { profiles, usersById } = await loadRosterForAudit()
  const cutoff = await auditDataStart()
  // The queue is EXACTLY the frontend's Deals → Needs review set: fetch all
  // deals and filter with the shared dealNeedsReview() (same rule, same
  // data-start-date + dealMissingInfo conditions, canceled/hidden excluded).
  const all = await restGet(`/rest/v1/deals?select=${DEAL_COLS}&order=sale_date.desc`)
  const deals = all.filter(d => dealNeedsReview(d, cutoff))
  const audits = []
  for (const d of deals) {
    try { audits.push(await auditOneDeal(d, sheet, profiles, usersById, caller.id, true)) }
    catch (e) { audits.push({ deal_id: d.id, deal_name: d.deal_name, error: e.message }) }
  }
  return ok({ count: audits.length, audits })
}

async function handleAuditCheck(rawBody) {
  if (!SUPABASE_URL || !SERVICE_KEY) return err('Audit is not configured — SUPABASE_SERVICE_KEY is missing on the site service.')
  let body; try { body = JSON.parse(rawBody || '{}') } catch { return err('Bad request body.') }
  let caller; try { caller = await verifyAuditor(body) } catch (e) { return err(e.message) }
  const { deal_id, item_key } = body
  if (!deal_id || !item_key) return err('Missing deal_id or item_key')
  if (!MANUAL_ITEM_KEYS.includes(item_key)) return err('Only manual items can be toggled by hand.')
  const checked = body.checked === true
  await restWrite('POST', '/rest/v1/deal_checklist?on_conflict=deal_id,item_key',
    { deal_id, item_key, checked, source: 'manual', checked_by: caller.id, checked_at: new Date().toISOString(), note: body.note || null },
    'resolution=merge-duplicates,return=minimal')
  await restWrite('POST', '/rest/v1/deal_checklist_history',
    { deal_id, item_key, checked, source: 'manual', checked_by: caller.id, note: body.note || null }, 'return=minimal')
  // Re-run the full audit so auto items are fresh and the deal flips to
  // Reviewed if this was the last box. Never auto-reverts a reviewed deal.
  const deal = (await restGet(`/rest/v1/deals?select=${DEAL_COLS}&id=eq.${deal_id}`))[0]
  if (!deal) return err('Deal not found')
  let sheet; try { sheet = await readInstallSheet() } catch (e) { return err(e.message) }
  const { profiles, usersById } = await loadRosterForAudit()
  return ok({ audit: await auditOneDeal(deal, sheet, profiles, usersById, caller.id) })
}

// Fill the empty GHL fields for ONE deal from the site's values, then re-audit.
async function handleGhlFill(rawBody) {
  if (!SUPABASE_URL || !SERVICE_KEY) return err('Audit is not configured — SUPABASE_SERVICE_KEY is missing on the site service.')
  let body; try { body = JSON.parse(rawBody || '{}') } catch { return err('Bad request body.') }
  let caller; try { caller = await verifyAuditor(body) } catch (e) { return err(e.message) }
  if (!body.deal_id) return err('Missing deal_id')
  const deal = (await restGet(`/rest/v1/deals?select=${DEAL_COLS}&id=eq.${body.deal_id}`))[0]
  if (!deal) return err('Deal not found')
  const { profiles, usersById } = await loadRosterForAudit()
  let fill; try { fill = await ghlFillBlanks(deal, usersById) } catch (e) { return err(e.message) }
  let sheet; try { sheet = await readInstallSheet() } catch (e) { return err(e.message) }
  return ok({ filled: fill.filled, audit: await auditOneDeal(deal, sheet, profiles, usersById, caller.id) })
}

// Admin/Keaton discovery: the location's custom fields + which ones we resolved
// to install date / sales rep / commission / payment. Used to confirm the
// mapping once the token is live (no secret ever leaves the server).
async function handleGhlFields(rawBody) {
  let body; try { body = JSON.parse(rawBody || '{}') } catch { return err('Bad request body.') }
  try { await verifyAuditor(body) } catch (e) { return err(e.message) }
  if (!GHL_API_TOKEN) return err('GHL_API_TOKEN is not set on the site service.')
  try {
    const j = await ghlGet(`/locations/${GHL_LOCATION_ID}/customFields`)
    const fields = (j.customFields || []).map(f => ({ name: f.name, id: f.id, dataType: f.dataType }))
    return ok({ resolved: await ghlFieldMap(), fields })
  } catch (e) { return err(e.message) }
}

// ── RepCard leaderboard (door knocks + appointments) ────────────────────────
// RepCard tallies every pin a rep drops onto its D2D leaderboard; its public
// API returns those per-rep totals for any date range. We read that board so
// the Home card shows the SAME door numbers reps see inside RepCard. The
// /customers API and the knock WEBHOOK only expose pins attached to a saved
// contact card, so both badly undercount (Charlie read 3 of 33 one week); the
// leaderboard is the only source that reconciles. Entirely non-fatal: no token
// → { configured: false } and the card simply hides its door metrics.
const REPCARD_API_TOKEN   = (process.env.REPCARD_API_TOKEN || '').trim()
const REPCARD_API_BASE    = (process.env.REPCARD_API_BASE_URL || 'https://app.repcard.com/api/').replace(/\/*$/, '/')
const REPCARD_LEADERBOARD = (process.env.REPCARD_LEADERBOARD_NAME || 'D2D Leaderboard').trim()
const _rcCache = new Map()            // `${from}|${to}` -> { at, rows }
const RC_TTL = 10 * 60 * 1000         // 10 min — every rep loads the same board

// RepCard sits behind the same Cloudflare posture as GHL; a browser User-Agent
// avoids the 1010 bot block.
function repcardHeaders() {
  return {
    'x-api-key': REPCARD_API_TOKEN,
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  }
}

// Per-rep rows of the D2D board for [from,to] (YYYY-MM-DD): each is
// { item_id, name, doors, appts, ran, sold, knockDays }. Metrics are resolved
// by the board's own short_name → mapped_field map (DK/APPT/RAN/SALE/DKD), so a
// renamed stat column fails soft instead of reading a stale field name.
async function repcardLeaderboard(from, to) {
  if (!REPCARD_API_TOKEN) return { configured: false, rows: [] }
  const key = `${from}|${to}`
  const hit = _rcCache.get(key)
  if (hit && Date.now() - hit.at < RC_TTL) return { configured: true, cached: true, rows: hit.rows }

  const url = `${REPCARD_API_BASE}leaderboards?from_date=${encodeURIComponent(from)}&to_date=${encodeURIComponent(to)}`
  const resp = await fetch(url, { headers: repcardHeaders() })
  if (!resp.ok) throw new Error(`RepCard ${resp.status}: ${(await resp.text()).slice(0, 120)}`)
  const body = await resp.json()

  const boards = Array.isArray(body?.result) ? body.result : []
  const board = boards.find(b => String(b?.leaderboard_name || '').trim().toLowerCase() === REPCARD_LEADERBOARD.toLowerCase()) || boards[0]
  const headers = board?.stats?.headers || []
  const fieldFor = (short) => headers.find(h => String(h?.short_name || '').toUpperCase() === short)?.mapped_field || null
  const fDK = fieldFor('DK'), fAPPT = fieldFor('APPT'), fRAN = fieldFor('RAN'), fSALE = fieldFor('SALE'), fDKD = fieldFor('DKD')
  const num = (v) => { const n = Number(v); return isNaN(n) ? 0 : n }

  const rows = (board?.stats?.stats || [])
    .filter(r => r && r.item_type !== 'team' && r.item_type !== 'office' && String(r.item_title || '').trim())
    .map(r => ({
      item_id: r.item_id,
      name: String(r.item_title || '').trim(),
      doors: fDK ? num(r[fDK]) : 0,
      appts: fAPPT ? num(r[fAPPT]) : 0,
      ran: fRAN ? num(r[fRAN]) : 0,
      sold: fSALE ? num(r[fSALE]) : 0,
      knockDays: fDKD ? num(r[fDKD]) : 0,
    }))
  _rcCache.set(key, { at: Date.now(), rows })
  return { configured: true, rows }
}

// ============================================================================
// ArcSite → site → GHL native integration (replaces the Zapier ArcSite→GHL zap)
// ----------------------------------------------------------------------------
// ArcSite POSTs `proposal.status_changed` here when a proposal is committed. We
// verify the signature, fetch full detail from ArcSite's API, and upsert the
// GHL contact + opportunity keyed by ArcSite's project_id (stable across change
// orders, so a re-fire UPDATES the same opportunity instead of duplicating).
//
// Routing: a deal CLOSED by an estimator (Rhett/Ronnie/Josh) goes to the Inside
// Sales (Estimators) pipeline; everyone else to Outside Sales. Field sources:
// price/PDF/line-items from ArcSite; baseline/install/payment/setter/closer/
// commission from the dashboard deal (which the sheet sync already populated).
// Estimator deals have no dashboard deal (outside-sales only) and no commission
// (salaried) — their setter/closer come from the ArcSite sales rep.
// Non-fatal everywhere: anything missing (no token, no deal yet, a GHL error)
// is logged and the call still 200s so ArcSite does not retry forever.
// ============================================================================
const ARCSITE_API_TOKEN      = (process.env.ARCSITE_API_TOKEN || '').trim()
const ARCSITE_API_BASE       = (process.env.ARCSITE_API_BASE || 'https://api.arcsite.com/v1').replace(/\/+$/, '')
const ARCSITE_WEBHOOK_SECRET = (process.env.ARCSITE_WEBHOOK_SECRET || '').trim()
// Statuses that mean "a real deal exists" (lower-cased, punctuation-insensitive).
// A committed proposal. The webhook sends API-style status CODES (APPROVED,
// APPROVED_ON_DEVICE, ESIGNED, SIGNED_ON_DEVICE, …), NOT the UI labels
// ("Approved Online"), so match on the key words rather than an exact list —
// any "approved"/"signed"/"esigned", excluding pending/draft/expired/paid/void.
function arcCommitted(status) {
  const n = arcNorm(status)
  if (!n) return false
  if (/pending|draft|expired|void|cancel|reject|paid/.test(n)) return false
  return /approv|sign/.test(n)
}
// Inside-sales estimators → Estimators pipeline. Name tokens, admin-overridable.
const ARC_ESTIMATORS = (process.env.ARCSITE_ESTIMATOR_NAMES || 'rhett,ronnie,josh')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

// GHL opportunity custom-field ids (Turf Time location). Resolved live by name
// too (ghlOppFields) so a renamed field still works; these are the fallback.
const GHL_OPP_FIELD_IDS = {
  project_id: 'OEpWsIX1eOfXHqrSI273', price: 'dScpoYWZbeghBsAMBR4o',
  baseline: 'rI6UeVz5CTQcXsssBqIm', install_date: 'j3gHe7eeXd2yfujzpln8',
  payment_method: 'IpcldbuGsu2HeNCZeZYl', commission: 'P5PdaF8CnR4ru4Xru3UA',
  setter: 'u3sMxbOvn2jHK53XrAu0', closer: 'q2AwMVrGnqaLTeosTpd7',
  sales_rep: 'mVfmImqXyOUQacAOAX5K', markup: 'Vi6FxBjJ1iVcSPEH8tFE',
}
const GHL_CHANGE_ORDER_PRICE = '7V3m3DhffrhMuOurTQ0N'   // "Change Order Price" (MONETORY)
const GHL_PIPELINES = {
  outside:   { id: (process.env.GHL_OUTSIDE_PIPELINE_ID   || 'EWGmXwXP63Da5eBMNiDU').trim(), closed: (process.env.GHL_OUTSIDE_CLOSED_STAGE   || '7f686159-9e37-4ffb-9311-3f10106cf250').trim(), changeOrder: (process.env.GHL_OUTSIDE_CO_STAGE   || '7ee61ae8-7b86-4300-bdf7-d7a0fa4d8471').trim() },
  estimator: { id: (process.env.GHL_ESTIMATOR_PIPELINE_ID || 'jfhZWICxnmISGllte9Rv').trim(), closed: (process.env.GHL_ESTIMATOR_CLOSED_STAGE || '72a74bdf-a2ab-4412-89b0-52142a1e8c0b').trim(), changeOrder: (process.env.GHL_ESTIMATOR_CO_STAGE || 'be9cde80-5545-477c-8e27-706a529ac952').trim() },
}

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
async function arcGet(path) {
  const resp = await fetch(`${ARCSITE_API_BASE}${path}`, { headers: { Authorization: `Bearer ${ARCSITE_API_TOKEN}`, Accept: 'application/json', 'User-Agent': BROWSER_UA } })
  if (!resp.ok) throw new Error(`ArcSite ${resp.status}: ${(await resp.text()).slice(0, 120)}`)
  return resp.json()
}
const arcNorm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
const isEstimatorRep = (name) => { const n = arcNorm(name); return !!n && ARC_ESTIMATORS.some(e => n.includes(e)) }

// Opportunity custom-field definitions (id → {dataType, options}), cached 10m,
// so dropdown writes send a real option and date/money writes are typed right.
let _ghlOppFields = { at: 0, byId: null }
async function ghlOppFields() {
  if (_ghlOppFields.byId && Date.now() - _ghlOppFields.at < 600000) return _ghlOppFields.byId
  const byId = {}
  try {
    const j = await ghlGet(`/locations/${GHL_LOCATION_ID}/customFields?model=opportunity`)
    for (const f of (j.customFields || [])) byId[f.id] = { dataType: f.dataType, options: f.options || [], name: f.name }
  } catch { /* fall back to untyped writes */ }
  _ghlOppFields = { at: Date.now(), byId }
  return byId
}
// Format one opportunity custom-field write by its GHL data type.
function oppFieldWrite(fieldId, rawValue, defs) {
  if (rawValue == null || rawValue === '') return null
  const dt = String((defs[fieldId] || {}).dataType || '').toUpperCase()
  const opts = (defs[fieldId] || {}).options || []
  if (dt.includes('DATE')) { const d = toYMD(rawValue); return d ? { id: fieldId, field_value: d } : null }
  if (dt.includes('MONET') || dt.includes('NUMER') || dt === 'NUMBER') { const n = Number(rawValue); return isNaN(n) ? null : { id: fieldId, field_value: n } }
  if (dt === 'MULTIPLE_OPTIONS' || dt === 'CHECKBOX') {
    // Payment Method combos arrive as "Self Pay + Goodleap" (and the calendar's
    // order can differ from GHL's), so split on + / , / & and match EACH part to
    // an option — order-independent, multi-select friendly.
    const parts = String(rawValue).split(/\s*[+,]\s*/).map(s => s.trim()).filter(Boolean)
    const matched = []
    for (const part of parts) { const m = matchGhlOption(part, opts); if (m && !matched.includes(m)) matched.push(m) }
    if (!matched.length) { const m = matchGhlOption(rawValue, opts); if (m) matched.push(m) }   // whole string as one option
    return matched.length ? { id: fieldId, field_value: matched } : null
  }
  if (dt === 'SINGLE_OPTIONS' || dt === 'RADIO') {
    const opt = matchGhlOption(rawValue, opts); return opt ? { id: fieldId, field_value: opt } : null
  }
  return { id: fieldId, field_value: String(rawValue) }
}

// GHL contact upsert (dedupes by email/phone — one contact per person).
async function ghlUpsertContact(person) {
  const body = { locationId: GHL_LOCATION_ID }
  if (person.name) body.name = person.name
  if (person.phone) body.phone = person.phone
  if (person.email) body.email = person.email
  if (person.address1) body.address1 = person.address1
  if (person.city) body.city = person.city
  if (person.state) body.state = person.state
  if (person.postalCode) body.postalCode = person.postalCode
  const resp = await fetch(`${GHL_BASE}/contacts/upsert`, {
    method: 'POST', headers: { ...ghlHeaders(GHL_WRITE_TOKEN), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!resp.ok) throw new Error(`GHL contact upsert ${resp.status}: ${(await resp.text()).slice(0, 140)}`)
  const j = await resp.json()
  return (j.contact && j.contact.id) || j.id || null
}
// A contact's opportunities (to find the one for this project_id).
async function ghlContactOpps(contactId) {
  const j = await ghlGet(`/opportunities/search?location_id=${GHL_LOCATION_ID}&contact_id=${contactId}&limit=100`)
  return j.opportunities || []
}
const oppProjectId = (opp) => {
  for (const c of (opp.customFields || [])) if (c.id === GHL_OPP_FIELD_IDS.project_id) return String(c.fieldValueString || c.fieldValue || c.value || '').trim()
  return ''
}
// A custom field's raw value on an opportunity (search/GET shapes differ).
const oppFieldVal = (opp, fieldId) => {
  for (const c of (opp.customFields || [])) if (c.id === fieldId) return c.fieldValueString ?? c.fieldValueNumber ?? c.fieldValue ?? c.value ?? null
  return null
}
async function ghlCreateOpp(body) {
  const resp = await fetch(`${GHL_BASE}/opportunities/`, {
    method: 'POST', headers: { ...ghlHeaders(GHL_WRITE_TOKEN), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!resp.ok) throw new Error(`GHL opp create ${resp.status}: ${(await resp.text()).slice(0, 140)}`)
  const j = await resp.json(); return (j.opportunity && j.opportunity.id) || j.id || null
}
async function ghlUpdateOpp(id, body) {
  const resp = await fetch(`${GHL_BASE}/opportunities/${id}`, {
    method: 'PUT', headers: { ...ghlHeaders(GHL_WRITE_TOKEN), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!resp.ok) throw new Error(`GHL opp update ${resp.status}: ${(await resp.text()).slice(0, 140)}`)
  return true
}

// Resolve a rep name → GHL user id, for the opportunity owner (assignedTo).
// Exact normalized full name first, then a UNIQUE first-name match; cached 10m.
let _ghlUsers = { at: 0, byName: null }
async function ghlUserIdByName(name) {
  if (!name) return null
  if (!_ghlUsers.byName || Date.now() - _ghlUsers.at > 600000) {
    const byName = {}
    try {
      const j = await ghlGet(`/users/?locationId=${GHL_LOCATION_ID}`)
      for (const u of (j.users || [])) {
        const nm = (u.name || `${u.firstName || ''} ${u.lastName || ''}`).trim()
        if (nm) byName[ghlNorm(nm)] = u.id
      }
    } catch { /* leave owner unset if users can't be read */ }
    _ghlUsers = { at: Date.now(), byName }
  }
  const want = ghlNorm(name)
  if (_ghlUsers.byName[want]) return _ghlUsers.byName[want]
  const first = want.split(' ')[0]
  const hits = Object.entries(_ghlUsers.byName).filter(([n]) => n.startsWith(want + ' ') || n.split(' ')[0] === first)
  return hits.length === 1 ? hits[0][1] : null
}

const GHL_PDF_FIELD = 'uluDL3vxcRVmeHSqpaj4'   // "Contract / PDF" (FILE_UPLOAD)
// Download the ArcSite PDF (its CDN link expires) and re-host it in GHL so the
// Contract/PDF field holds a permanent file. Needs the token's medias.write
// scope; a 401 here means that scope is missing. Returns the hosted URL.
async function ghlHostPdf(pdfUrl, name) {
  const dl = await fetch(pdfUrl)
  if (!dl.ok) throw new Error(`pdf download ${dl.status}`)
  const buf = Buffer.from(await dl.arrayBuffer())
  const form = new FormData()
  form.append('file', new Blob([buf], { type: 'application/pdf' }), name)
  form.append('hosted', 'false')
  form.append('name', name)
  form.append('locationId', GHL_LOCATION_ID)
  const resp = await fetch(`${GHL_BASE}/medias/upload-file`, { method: 'POST', headers: ghlHeaders(GHL_MEDIA_TOKEN), body: form })
  if (!resp.ok) throw new Error(`medias upload ${resp.status}: ${(await resp.text()).slice(0, 120)}`)
  const j = await resp.json()
  return j.url || j.fileUrl || (j.file && j.file.url) || j.link || null
}

// Pull the dashboard deal (sheet-synced) + rep names for the money/people fields
// that live on OUR side, keyed by project_id. Null when no deal exists yet.
async function dealForProject(projectId) {
  if (!SUPABASE_URL || !SERVICE_KEY) return null
  const rows = await restGet(`/rest/v1/deals?project_id=eq.${encodeURIComponent(projectId)}&select=*&limit=1`).catch(() => [])
  const deal = Array.isArray(rows) ? rows[0] : null
  if (!deal) return null
  const ids = [deal.setter_id, deal.closer_id].filter(Boolean)
  let byId = {}
  if (ids.length) {
    const profs = await restGet(`/rest/v1/profiles?id=in.(${ids.join(',')})&select=id,name`).catch(() => [])
    for (const p of (profs || [])) byId[p.id] = p.name
  }
  const amt = dealAmounts(deal)
  return {
    deal,
    setter: deal.setter_id ? (byId[deal.setter_id] || null) : null,
    closer: deal.closer_id ? (byId[deal.closer_id] || null) : null,
    commission: amt.repCommission != null ? Math.round(amt.repCommission * 100) / 100 : null,
  }
}

// The Jobs-tab row for a project (the ArcSite "sold" sheet), keyed by Project
// ID. Source of truth for baseline, job price and commission across ALL reps —
// including estimators, who have no dashboard deal. Columns are matched by
// header keyword so a column move doesn't break it. Fails soft to null (sheet
// not reachable, or the row not written yet — it lands a few seconds after the
// sale). Parenthesised negatives like "($1,356.73)" parse as -1356.73.
async function jobRowForProject(projectId, { fresh = false } = {}) {
  if (fresh) _sheetCache = { at: 0, data: null }   // bypass the 60s cache for a retry
  let data
  try { data = await readInstallSheet() } catch { return null }
  const jobs = data && data.jobs
  if (!jobs || !jobs.headers || !jobs.headers.length) return null
  const h = (re) => jobs.headers.find(x => re.test(String(x).toLowerCase()))
  const pidH = h(/project\s*id/)
  if (!pidH) return null
  const want = String(projectId).trim()
  const row = jobs.rows.find(r => String(r[pidH] || '').trim() === want)
  if (!row) return null
  const num = (v) => {
    if (v == null || String(v).trim() === '') return null
    const s = String(v).trim(), neg = /^\(.*\)$/.test(s) || s.trim().startsWith('-')
    const n = Number(s.replace(/[^0-9.]/g, ''))
    return isNaN(n) ? null : (neg ? -n : n)
  }
  const baseH = h(/baseline/)
  const priceH = h(/pre.?tax\s*sale/) || h(/approved\s*total/)
  const commH = jobs.headers.find(x => /commission/.test(String(x).toLowerCase()) && !String(x).includes('%'))
  return {
    baseline:   baseH  ? num(row[baseH])  : null,
    jobPrice:   priceH ? num(row[priceH]) : null,
    commission: commH  ? num(row[commH])  : null,
  }
}

// The LATE-arriving field values for an opp, re-pulled from their live sources:
// baseline/markup/commission from the Jobs sheet (lands seconds after the sale)
// and install_date/payment_method from the dashboard deal, which the Schedule
// sync fills from the INSTALL CALENDAR — usually a while after the sale. Only
// non-null values are returned; commission stays blank for salaried estimators.
async function arcLateValues(projectId, estimator) {
  const [job, enriched] = await Promise.all([
    jobRowForProject(projectId, { fresh: true }).catch(() => null),
    estimator ? Promise.resolve(null) : dealForProject(projectId).catch(() => null),
  ])
  const deal = enriched && enriched.deal
  const out = {}
  if (job) {
    if (job.baseline != null) out.baseline = job.baseline
    if (job.jobPrice != null && job.baseline != null) out.markup = Math.round((job.jobPrice - job.baseline) * 100) / 100
    if (!estimator && job.commission != null) out.commission = job.commission
  }
  if (deal) {
    if (deal.install_date) out.install_date = deal.install_date
    if (deal.payment_method) out.payment_method = deal.payment_method
  }
  // Setter/closer also live on the dashboard deal and used to be set ONLY at
  // webhook time — so a deal that landed late lost them. Back-fill them here.
  if (enriched) {
    if (enriched.setter) out.setter = enriched.setter
    if (enriched.closer) out.closer = enriched.closer
  }
  return out
}

// Reconciliation queue. Two jobs, both needed because the webhook fires before
// the data is ready:
//   1. HARDENING — if applying the custom fields right after creating the opp
//      failed (a transient GHL/Cloudflare blip left a blank opp, as happened to
//      Jalyn Robbins), re-apply the FULL field set (`baseFields`) so nothing is
//      lost.
//   2. LATE FIELDS — keep pulling the sheet money and the install-calendar
//      fields (install_date, payment_method) and patch them on as they land.
// Retries every 45s for ~30 min (MAX_TRIES), long enough for an install to be
// put on the calendar "shortly after" the sale. Writes only values that have
// CHANGED since last time, so it doesn't hammer GHL.
const ARC_ENRICH_MAX_TRIES = 40
const _arcEnrich = new Map()   // oppId -> { projectId, estimator, baseFields, needBase, alert, tries, wrote, alerted }
let _arcEnrichTimer = null
function arcEnrichQueue(oppId, projectId, estimator, { baseFields = null, needBase = false, alert = null } = {}) {
  if (!oppId || !projectId) return
  _arcEnrich.set(oppId, { projectId, estimator, baseFields, needBase, alert, tries: 0, wrote: {}, alerted: false })
  if (!_arcEnrichTimer) {
    _arcEnrichTimer = setInterval(arcEnrichSweep, 45000)
    _arcEnrichTimer.unref?.()   // don't keep the process alive just for the sweep
  }
}
async function arcEnrichSweep() {
  if (!_arcEnrich.size) return
  for (const [oppId, item] of [..._arcEnrich]) {
    item.tries++
    try {
      // 1. Restore the full field set once, if the initial apply failed.
      if (item.needBase && item.baseFields && item.baseFields.length) {
        await ghlUpdateOpp(oppId, { customFields: item.baseFields })
        item.needBase = false
      }
      // 2. Patch on whatever late values have shown up since last tick.
      const vals = await arcLateValues(item.projectId, item.estimator)
      const defs = await ghlOppFields()
      const toWrite = []
      for (const [k, v] of Object.entries(vals)) {
        if (item.wrote[k] === v) continue           // already pushed this value
        const w = oppFieldWrite(GHL_OPP_FIELD_IDS[k], v, defs)
        if (w) { toWrite.push(w); item.wrote[k] = v }
      }
      if (toWrite.length) await ghlUpdateOpp(oppId, { customFields: toWrite })

      // Send the deferred new-sale text as soon as the money (baseline) is known.
      if (item.alert && !item.alerted && vals.baseline != null) {
        await sendSaleAlert(item.projectId, { ...item.alert, baseline: vals.baseline, markup: vals.markup ?? null })
        item.alerted = true
      }

      // Done when the money AND (for outside sales) the calendar fields are in.
      const moneyDone = vals.baseline != null
      const schedDone = item.estimator || (vals.install_date != null && vals.payment_method != null)
      if (moneyDone && schedDone && !item.needBase) _arcEnrich.delete(oppId)
    } catch { /* transient — try again next tick */ }

    if (_arcEnrich.has(oppId) && item.tries >= ARC_ENRICH_MAX_TRIES) {
      // Gave up waiting on the calendar — never leave a new sale untexted.
      if (item.alert && !item.alerted) {
        const vals = await arcLateValues(item.projectId, item.estimator).catch(() => ({}))
        try { await sendSaleAlert(item.projectId, { ...item.alert, baseline: vals.baseline ?? null, markup: vals.markup ?? null }) } catch {}
      }
      _arcEnrich.delete(oppId)
    }
  }
  if (!_arcEnrich.size && _arcEnrichTimer) { clearInterval(_arcEnrichTimer); _arcEnrichTimer = null }
}

// ── Durable reconciliation (survives redeploys + long calendar lag) ─────────
// The in-memory sweep above only runs ~30 min and is wiped by a redeploy, so
// install_date / payment_method (put on the install calendar hours or days
// later) and setter/closer (when the deal lands late) could be missed for good.
// This persists the still-incomplete opps in app_settings and re-fills them on
// a 5-minute timer, using the stored oppId so no contact lookup is needed.
const ARC_PENDING_KEY = 'arcsite_pending'
const ARC_PENDING_MAX_DAYS = 21
async function arcPendingRead() {
  if (!SUPABASE_URL || !SERVICE_KEY) return {}
  const rows = await restGet(`/rest/v1/app_settings?key=eq.${ARC_PENDING_KEY}&select=value`).catch(() => [])
  return (Array.isArray(rows) && rows[0] && rows[0].value) || {}
}
async function arcPendingWrite(map) {
  if (!SUPABASE_URL || !SERVICE_KEY) return
  await restWrite('POST', `/rest/v1/app_settings?on_conflict=key`,
    { key: ARC_PENDING_KEY, value: map }, 'resolution=merge-duplicates').catch(() => {})
}
async function arcPendingAdd(projectId, oppId, estimator) {
  if (!oppId || !projectId || !SUPABASE_URL || !SERVICE_KEY) return
  try {
    const map = await arcPendingRead()
    const prev = map[projectId] || {}
    map[projectId] = { oppId, estimator: !!estimator, firstAt: prev.firstAt || Date.now(), wrote: prev.wrote || {} }
    await arcPendingWrite(map)
  } catch { /* best-effort */ }
}
async function arcPendingReconcile() {
  let map
  try { map = await arcPendingRead() } catch { return }
  if (!map || !Object.keys(map).length) return
  const now = Date.now()
  let changed = false, defs = null
  for (const [projectId, e] of Object.entries(map)) {
    try {
      if (!e || !e.oppId) { delete map[projectId]; changed = true; continue }
      const est = !!e.estimator
      const wrote = e.wrote || {}
      const vals = await arcLateValues(projectId, est).catch(() => ({}))
      const toWrite = []
      for (const [k, v] of Object.entries(vals)) {
        if (wrote[k] === v) continue
        if (!defs) defs = await ghlOppFields()
        const w = oppFieldWrite(GHL_OPP_FIELD_IDS[k], v, defs)
        if (w) { toWrite.push(w); wrote[k] = v }
      }
      if (toWrite.length) { await ghlUpdateOpp(e.oppId, { customFields: toWrite }); e.wrote = wrote; changed = true }
      // Done when the money is in and (for outside sales) the install-calendar
      // fields are too; setter/closer are filled opportunistically above.
      const complete = wrote.baseline != null && (est || (wrote.install_date != null && wrote.payment_method != null))
      if (complete || now - (e.firstAt || now) > ARC_PENDING_MAX_DAYS * 864e5) { delete map[projectId]; changed = true }
    } catch { /* keep for next tick */ }
  }
  if (changed) await arcPendingWrite(map)
}

// ── Value reconcile sweep ───────────────────────────────────────────────────
// Safety net for a committed proposal ArcSite never delivered a webhook for (or
// that failed): a CHANGE ORDER whose new signed total never reached the opp, or
// a brand-new sale missed entirely. Polls ArcSite's recently-approved proposals
// and, for any whose signed total doesn't match the GHL opportunity's value — or
// that has no opp yet — REPROCESSES the project through the same real mapping the
// webhook runs, so the change-order stage move, the PDF append and the new-sale
// text all apply exactly as they would have. A persistent "confirmed total" map
// (app_settings.arcsite_value_seen) keeps steady state nearly free: a project is
// looked up in GHL only when its ArcSite total changed or was never confirmed.
const ARC_VALUE_SEEN_KEY = 'arcsite_value_seen'
const ARC_VALUE_PAGES = Number(process.env.ARC_VALUE_PAGES || 4)         // recent proposal pages to scan (×20)
const ARC_VALUE_MAX_PROJECTS = Number(process.env.ARC_VALUE_MAX || 40)   // GHL lookups to spend per tick
const ARC_VALUE_SEEN_CAP = 1000                                          // keep the seen map bounded

async function arcValueSeenRead() {
  if (!SUPABASE_URL || !SERVICE_KEY) return {}
  const rows = await restGet(`/rest/v1/app_settings?key=eq.${ARC_VALUE_SEEN_KEY}&select=value`).catch(() => [])
  return (Array.isArray(rows) && rows[0] && rows[0].value) || {}
}
async function arcValueSeenWrite(map) {
  if (!SUPABASE_URL || !SERVICE_KEY) return
  await restWrite('POST', `/rest/v1/app_settings?on_conflict=key`,
    { key: ARC_VALUE_SEEN_KEY, value: map }, 'resolution=merge-duplicates').catch(() => {})
}
// The GHL opp (with its monetaryValue) for an ArcSite proposal-list item, found
// by customer email then name and matched on project_id. Returns the opp or null.
async function arcOppForProposal(p) {
  const pid = String(p.project_id || '').trim()
  const tryQuery = async (q) => {
    if (!q) return []
    try { const j = await ghlGet(`/contacts/?locationId=${GHL_LOCATION_ID}&query=${encodeURIComponent(q)}&limit=10`); return j.contacts || [] }
    catch { return [] }
  }
  // Search by email AND name and merge — an email query that returns the wrong
  // contacts must not suppress the name match (which left healthy sales unable
  // to take the cheap "already correct" shortcut, so they got reprocessed once).
  const byId = new Map()
  for (const c of [...await tryQuery(p.customer_email), ...await tryQuery(p.customer_name)]) {
    if (c && c.id) byId.set(c.id, c)
  }
  for (const c of byId.values()) {
    const opps = await ghlContactOpps(c.id).catch(() => [])
    const hit = opps.find(o => oppProjectId(o) === pid)
    if (hit) return hit
  }
  return null
}
// ── Change orders: the targeted path ─────────────────────────────────────────
// A 2nd/3rd/… signed proposal on a Project ID. The live webhook handles it in
// arcsiteToGhl; everything below is for the SAFETY NET (a webhook ArcSite never
// sent) and the manual endpoint, and it deliberately does NOT run the full
// reprocess: that re-maps every field, re-assigns the owner and sets the stage
// to Closed — which knocked Jacob Smith's opp back from Ready For Install. This
// touches only what a change order means: the contracts, the value + stage,
// the contact's New Price, and the install calendar.
const GHL_CONTACT_NEW_PRICE_FIELD = 'X6s8Kc6QVEVyzSIISktA'   // contact "New Price" — the install calendar's 6h sync reads it FIRST
const GHL_CONTACT_JOB_PRICE_FIELD = 'gz5Xoix8Sd37hUbrvQuQ'   // contact "Job Price" — follows the change order too (per Garrison)
const CALENDAR_SYNC_URL = (process.env.CALENDAR_SYNC_URL || '').replace(/\/+$/, '')
const CALENDAR_SYNC_SECRET = (process.env.CALENDAR_SYNC_SECRET || '').trim()
const arcUsd = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// The contract files currently on an opp's Contract/PDF field (search and GET
// shapes differ; contact-style values are keyed objects). Deleted ones excluded.
function oppContractEntries(opp) {
  for (const c of (opp.customFields || [])) {
    if (c.id !== GHL_PDF_FIELD) continue
    let v = c.fieldValueFiles ?? c.fieldValue ?? c.fieldValueArray ?? c.value ?? null
    if (typeof v === 'string') v = v.trim() ? [{ url: v }] : []
    if (v && !Array.isArray(v) && typeof v === 'object') v = Object.values(v)
    return (Array.isArray(v) ? v : [])
      .filter(x => x && !x.deleted && (x.url || (x.meta && x.meta.url)))
      .map(x => ({ url: x.url || x.meta.url, name: (x.meta && (x.meta.originalname || x.meta.name)) || 'contract.pdf' }))
  }
  return []
}

// Every SIGNED contract ArcSite holds for a project — committed proposals with
// a proposal-level (signed) pdf — oldest first, so the newest contract is last.
async function arcSignedContracts(projectId) {
  const refs = (await arcGet(`/proposals?project_id=${projectId}&per_page=20`).catch(() => [])) || []
  const out = []
  for (const pr of (Array.isArray(refs) ? refs : [])) {
    const full = pr.proposal_options ? pr : await arcGet(`/proposals/${pr.proposal_id}`).catch(() => null)
    if (full && arcCommitted(full.status) && full.pdf_url) {
      out.push({ proposal_id: String(full.proposal_id || ''), document_number: full.document_number || null, pdf_url: full.pdf_url, total: Number(full.total) || null })
    }
  }
  return out.reverse()
}

async function ghlContactSetFields(contactId, fields) {
  const resp = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    method: 'PUT', headers: { ...ghlHeaders(GHL_WRITE_TOKEN), 'Content-Type': 'application/json' },
    body: JSON.stringify({ customFields: fields.map(f => ({ id: f.id, field_value: f.value })) }),
  })
  if (!resp.ok) throw new Error(`GHL contact update ${resp.status}: ${(await resp.text()).slice(0, 140)}`)
  return true
}

// What the CALENDAR needs from a change order, pushed the moment we have it:
// the contact's New Price (so the calendar's own 6h GHL sync agrees with the
// new total instead of reverting it) and the ingest call that sets the job's
// value, files the contracts, writes the PM note and logs the revenue-dashboard
// delta. Best-effort — the GHL opp is already right either way. ArcSite exposes
// no signing timestamp, so the signed date is the day we caught it (same day
// for the live webhook, minutes for the safety net).
async function arcPropagateChangeOrder({ oppId, contactId, projectId, customer, newTotal, previousTotal, contracts, newestContract }) {
  const out = { contact_new_price: null, calendar: null }
  if (contactId && newTotal != null) {
    // Both contact price fields follow the change order: New Price (what the
    // calendar reads first) AND Job Price (per Garrison — the card's price).
    try {
      await ghlContactSetFields(contactId, [{ id: GHL_CONTACT_NEW_PRICE_FIELD, value: newTotal }, { id: GHL_CONTACT_JOB_PRICE_FIELD, value: newTotal }])
      out.contact_new_price = 'set (New Price + Job Price)'
    } catch (e) { out.contact_new_price = 'failed: ' + (e.message || 'update failed') }
  }
  if (!CALENDAR_SYNC_URL || !CALENDAR_SYNC_SECRET) { out.calendar = 'not configured'; return out }
  try {
    const resp = await fetch(`${CALENDAR_SYNC_URL}/api/change-orders/ingest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sync-secret': CALENDAR_SYNC_SECRET },
      body: JSON.stringify({
        ghlOpportunityId: oppId, ghlContactId: contactId, projectId,
        customerName: customer.name || null,
        customerAddress: [customer.address1, customer.city, customer.state, customer.postalCode].filter(Boolean).join(', ') || null,
        customerPhone: customer.phone || null,
        newTotal, previousTotal, newestContract,
        // GHL's own file-field shape, so the calendar files each contract under
        // the same key its 6h import would — one attachment, never two.
        contracts: (contracts || []).map(c => ({ url: c.url, meta: { mimetype: 'application/pdf', name: c.name || 'contract.pdf' } })),
      }),
    })
    const j = await resp.json().catch(() => ({}))
    out.calendar = resp.ok ? j : { error: `calendar ${resp.status}`, ...j }
  } catch (e) { out.calendar = { error: e.message || 'calendar push failed' } }
  return out
}

async function arcApplyChangeOrder(projectId, { opp, contactId, customer, signed, newTotal, via }) {
  const pipe = opp.pipelineId === GHL_PIPELINES.estimator.id ? GHL_PIPELINES.estimator : GHL_PIPELINES.outside
  const cur = opp.monetaryValue != null ? Math.round(Number(opp.monetaryValue) * 100) / 100 : null
  const want = newTotal != null ? Math.round(newTotal * 100) / 100 : cur
  const totalChanged = want != null && cur != null && Math.abs(want - cur) > 0.01
  const attached = oppContractEntries(opp)
  const r = {
    ok: true, via, action: 'change_order', project_id: projectId, customer: customer.name, opportunity_id: opp.id,
    was: cur, now: want, stage_moved: false, contracts: `${attached.length} attached / ${signed.length} signed`, pdf: 'kept',
  }
  let contracts = attached
  // 1. Contracts: ArcSite has more signed proposals than the opp carries → rebuild
  //    the FULL set (host every signed pdf fresh, then clear + set each), so the
  //    opp ends with exactly today's contracts, oldest → newest. Host everything
  //    BEFORE clearing: a failed download must never cost the existing document.
  if (signed.length > attached.length) {
    try {
      const hosted = []
      for (const s of signed) {
        const name = `${customer.name} - contract ${s.document_number || s.proposal_id}.pdf`.replace(/[\/\\]/g, '-')
        hosted.push({ url: await ghlHostPdf(s.pdf_url, name), name })
      }
      if (hosted.some(h => !h.url)) throw new Error('upload returned no url')
      await ghlUpdateOpp(opp.id, { customFields: [{ id: GHL_PDF_FIELD, field_value: '' }] })
      for (const h of hosted) await ghlUpdateOpp(opp.id, { customFields: [{ id: GHL_PDF_FIELD, field_value: h.url }] })
      contracts = hosted; r.pdf = `rebuilt ${hosted.length}`
    } catch (e) { r.ok = false; r.pdf = 'skipped: ' + (e.message || 'upload failed') }
  }
  // 2. Value + stage — the same rule as the live webhook: a changed total lands
  //    in Change Order, and the value is re-sent ALONE (GHL drops it on a stage move).
  if (totalChanged) {
    try {
      await ghlUpdateOpp(opp.id, { pipelineId: pipe.id, pipelineStageId: pipe.changeOrder })
      await ghlUpdateOpp(opp.id, { monetaryValue: want })
      const defs = await ghlOppFields().catch(() => null)
      const w = defs ? oppFieldWrite(GHL_OPP_FIELD_IDS.price, want, defs) : null
      if (w) await ghlUpdateOpp(opp.id, { customFields: [w] }).catch(() => {})
      r.stage_moved = true
      // Sheet money follows the change order too (the ArcSite feed updates the
      // Jobs row's baseline / sale price): re-read the row and re-stamp Baseline,
      // Markup and Commission exactly as the live webhook does (commission blank
      // for salaried estimators). If the sheet hasn't caught up yet, the durable
      // reconciler keeps re-applying the sheet money for up to 21 days.
      const estimator = pipe === GHL_PIPELINES.estimator
      const job = await jobRowForProject(projectId).catch(() => null)
      if (job && defs) {
        const money = {
          baseline: job.baseline != null ? job.baseline : null,
          markup: job.jobPrice != null && job.baseline != null ? Math.round((job.jobPrice - job.baseline) * 100) / 100 : null,
          commission: estimator ? null : (job.commission != null ? job.commission : null),
        }
        const fields = Object.entries(money).map(([k, v]) => oppFieldWrite(GHL_OPP_FIELD_IDS[k], v, defs)).filter(Boolean)
        if (fields.length) await ghlUpdateOpp(opp.id, { customFields: fields }).catch(() => {})
        r.sheet_money = money
      } else r.sheet_money = job ? 'fields unavailable' : 'no Jobs-sheet row yet (reconciler will fill it)'
      arcPendingAdd(projectId, opp.id, estimator).catch(() => {})
    } catch (e) { r.ok = false; r.error = e.message || 'value update failed' }
  }
  // 3. The calendar + the contact's New Price.
  const newest = signed[signed.length - 1]
  Object.assign(r, await arcPropagateChangeOrder({
    oppId: opp.id, contactId, projectId, customer, newTotal: want, previousTotal: cur, contracts,
    newestContract: newest ? `Proposal ${newest.document_number || newest.proposal_id}${newest.total ? ` (${arcUsd(newest.total)})` : ''}` : null,
  }))
  return r
}

// Manual entry point (and the backfill tool): run the targeted change-order
// path for one project. Finds the opp by the project's customer; a project
// with NO opp yet is a missed sale — that is what /reprocess is for.
async function arcChangeOrderForProject(projectId, via) {
  const project = await arcGet(`/projects/${projectId}`)
  const c = project.customer || {}, a = c.address || {}
  const customer = { name: c.name || project.name || 'Customer', phone: c.phone || null, email: c.email || null, address1: a.street || null, city: a.city || null, state: a.state || null, postalCode: a.zip_code || null }
  const signed = await arcSignedContracts(projectId)
  if (!signed.length) return { ok: false, via, project_id: projectId, customer: customer.name, error: 'no signed proposal in ArcSite' }
  const opp = await arcOppForProposal({ project_id: projectId, customer_name: customer.name, customer_email: customer.email })
  if (!opp) return { ok: false, via, project_id: projectId, customer: customer.name, error: 'no GHL opportunity for this project — /api/arcsite/reprocess creates one' }
  const newest = signed[signed.length - 1]
  return arcApplyChangeOrder(projectId, { opp, contactId: opp.contactId || null, customer, signed, newTotal: newest.total, via })
}

// ── Daily contract audit ─────────────────────────────────────────────────────
// The 10-min sweep only sees the ~80 newest ArcSite proposals. This is the daily
// FULL pass (per Garrison: "a daily check that will make sure all the change
// orders are in"): every GHL opp with a Project ID installing in the last
// ARC_AUDIT_DAYS_BACK days or the future, compared against ArcSite — signed
// contracts vs attached, newest signed total vs value — and any gap fixed through
// the targeted change-order path (GHL + the calendar), never the full reprocess.
// Runs once a day in the ARC_AUDIT_HOUR hour (Phoenix); the result is stored in
// app_settings.arcsite_contract_audit (GET /api/arcsite/contract-audit) and the
// stored day stops a redeploy from running it twice. POST the same path to run
// it by hand ({ fix: false } = report only).
const ARC_AUDIT_KEY = 'arcsite_contract_audit'
const ARC_AUDIT_HOUR = Number(process.env.ARC_AUDIT_HOUR || 6)
const ARC_AUDIT_DAYS_BACK = Number(process.env.ARC_AUDIT_DAYS_BACK || 14)
const ARC_AUDIT_MAX_FIX = Number(process.env.ARC_AUDIT_MAX_FIX || 60)   // fixes per run; the rest are listed as gaps for tomorrow

// The opp's Install Date as yyyy-mm-dd. The search endpoint returns DATE fields
// as fieldValueDate (epoch ms); GET-by-id returns the string.
function oppInstallDay(opp) {
  for (const c of (opp.customFields || [])) {
    if (c.id !== GHL_OPP_FIELD_IDS.install_date) continue
    if (c.fieldValueDate != null) return new Date(Number(c.fieldValueDate)).toISOString().slice(0, 10)
    const v = c.fieldValueString || c.fieldValue || c.value
    return v ? String(v).slice(0, 10) : null
  }
  return null
}
function phoenixNow(dt = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' }).formatToParts(dt)
  const g = t => (p.find(x => x.type === t) || {}).value || ''
  return { day: `${g('year')}-${g('month')}-${g('day')}`, hour: Number(g('hour')) % 24 }   // en-CA can report midnight as "24"
}

async function arcContractAudit({ fix = true, daysBack = ARC_AUDIT_DAYS_BACK, maxFix = ARC_AUDIT_MAX_FIX } = {}) {
  const out = { at: new Date().toISOString(), day: phoenixNow().day, fix, days_back: daysBack, scanned: 0, candidates: 0, checked: 0, ok: 0, gaps: [], fixed: [], failed: [], skipped: null }
  if (!ARCSITE_API_TOKEN || !GHL_WRITE_TOKEN) { out.skipped = 'not configured'; return out }
  const floor = new Date(Date.now() - daysBack * 864e5).toISOString().slice(0, 10)
  const pause = ms => new Promise(res => setTimeout(res, ms))
  // 1. Every opp installing on/after the floor (whole location, 100 a page).
  const cands = []
  let path = `/opportunities/search?location_id=${GHL_LOCATION_ID}&limit=100`, pages = 0
  while (path && pages < 300) {
    const j = await ghlGet(path).catch(() => null)
    if (!j) break
    for (const op of (j.opportunities || [])) {
      out.scanned++
      const pid = oppProjectId(op), inst = oppInstallDay(op)
      if (pid && inst && inst >= floor) cands.push({ op, pid, inst })
    }
    pages++
    const next = j.meta && j.meta.nextPageUrl
    path = next && next.startsWith(GHL_BASE) ? next.slice(GHL_BASE.length) : null
    await pause(150)
  }
  out.candidates = cands.length
  // 2. Compare each against ArcSite. A gap is re-read by id before acting — the
  //    search index lags writes by minutes, so a fix from an hour ago can still
  //    look missing there.
  for (const { op, pid, inst } of cands) {
    try {
      const signed = await arcSignedContracts(pid)
      if (!signed.length) continue
      const newest = signed[signed.length - 1]
      const want = newest.total != null ? Math.round(newest.total * 100) / 100 : null
      const stale = o => {
        const cur = o.monetaryValue != null ? Math.round(Number(o.monetaryValue) * 100) / 100 : null
        return signed.length > oppContractEntries(o).length || (want != null && cur != null && Math.abs(cur - want) > 0.01)
      }
      out.checked++
      if (!stale(op)) { out.ok++; continue }
      const fresh = (await ghlGet(`/opportunities/${op.id}`).catch(() => null)) || {}
      const opp = fresh.opportunity || fresh
      if (!opp.id || !stale(opp)) { out.ok++; continue }
      const gap = { project_id: pid, customer: opp.name, install: inst, contracts: `${oppContractEntries(opp).length} attached / ${signed.length} signed`, value: opp.monetaryValue, signed_total: want }
      out.gaps.push(gap)
      if (!fix || out.fixed.length + out.failed.length >= maxFix) continue
      const project = await arcGet(`/projects/${pid}`).catch(() => null)
      const c = (project && project.customer) || {}, a = c.address || {}
      const customer = { name: c.name || opp.name || 'Customer', phone: c.phone || null, email: c.email || null, address1: a.street || null, city: a.city || null, state: a.state || null, postalCode: a.zip_code || null }
      const r = await arcApplyChangeOrder(pid, { opp, contactId: opp.contactId || null, customer, signed, newTotal: want, via: 'daily_audit' })
      await arcLog(r)
      const cal = r.calendar && typeof r.calendar === 'object' ? (r.calendar.job ? r.calendar.job.jobNumber : r.calendar.error || null) : r.calendar
      ;(r.ok ? out.fixed : out.failed).push({ ...gap, pdf: r.pdf, stage_moved: r.stage_moved, calendar: cal, error: r.error })
      await pause(500)
    } catch (e) { out.failed.push({ project_id: pid, install: inst, error: e.message || 'audit failed' }) }
  }
  if (SUPABASE_URL && SERVICE_KEY) {
    await restWrite('POST', `/rest/v1/app_settings?on_conflict=key`,
      { key: ARC_AUDIT_KEY, value: { ...out, gaps: out.gaps.slice(0, 100) } }, 'resolution=merge-duplicates').catch(() => {})
  }
  return out
}
async function arcContractAuditLast() {
  if (!SUPABASE_URL || !SERVICE_KEY) return null
  const rows = await restGet(`/rest/v1/app_settings?key=eq.${ARC_AUDIT_KEY}&select=value`).catch(() => [])
  return (Array.isArray(rows) && rows[0] && rows[0].value) || null
}
let _arcAuditRunning = false
async function arcContractAuditTick() {
  if (_arcAuditRunning) return
  const { day, hour } = phoenixNow()
  if (hour !== ARC_AUDIT_HOUR) return
  const last = await arcContractAuditLast()
  if (last && last.day === day) return   // already ran today (survives a redeploy)
  _arcAuditRunning = true
  try { await arcContractAudit({ fix: true }) } finally { _arcAuditRunning = false }
}

async function arcValueSweep() {
  const out = { scanned: 0, verified: 0, confirmed: 0, reprocessed: [], skipped: null }
  if (!ARCSITE_API_TOKEN || !GHL_WRITE_TOKEN || !SUPABASE_URL || !SERVICE_KEY) { out.skipped = 'not configured'; return out }
  // Newest committed proposal per project across the recent pages (list is
  // newest-first, so the first APPROVED we see for a project is the current one).
  // Its proposal_id is the change-order signal: a 2nd/3rd/… signing is a NEW
  // proposal id even when the total didn't move — watching the value alone let
  // a same-price re-sign (new signed contract, nothing to append) slip by forever.
  const latest = new Map()
  for (let page = 1; page <= ARC_VALUE_PAGES; page++) {
    let arr
    try { arr = await arcGet(`/proposals?per_page=20&page=${page}`) } catch { break }
    if (!Array.isArray(arr) || !arr.length) break
    for (const p of arr) {
      const pid = String(p.project_id || '').trim()
      if (!pid || latest.has(pid)) continue
      const total = Number(p.total)
      if (!arcCommitted(p.status) || !isFinite(total)) continue
      latest.set(pid, { total, proposal_id: String(p.proposal_id || ''), project_id: pid, customer_name: p.customer_name, customer_email: p.customer_email })
    }
  }
  out.scanned = latest.size
  if (!latest.size) return out
  const seen = await arcValueSeenRead()
  let changed = false
  for (const [pid, info] of latest) {
    if (out.verified >= ARC_VALUE_MAX_PROJECTS) break
    const want = Math.round(info.total * 100) / 100
    const s = seen[pid]
    // Confirmed at this total AND this newest proposal → nothing to do. (Entries
    // written before the proposal id was tracked are a bare number, so they get
    // one more verification, which also checks their contracts.)
    if (s && typeof s === 'object' && Math.round(Number(s.t) * 100) / 100 === want && s.p === info.proposal_id) continue
    out.verified++
    const mark = { t: want, p: info.proposal_id }
    try {
      const opp = await arcOppForProposal(info)
      if (!opp) {
        // Missed sale entirely → the real mapping creates it (contact, opp, fields, text).
        const r = await arcsiteToGhl(JSON.stringify({ status: 'APPROVED', project_id: pid })).catch(e => ({ ok: false, error: e.message }))
        await arcLog({ ...(r || { ok: false }), via: 'value_sweep' })
        out.reprocessed.push({ project_id: pid, customer: info.customer_name, was: null, now: want, action: r && r.action, ok: !!(r && r.ok && !r.ignored) })
        if (r && r.ok && !r.ignored && r.fields_ok !== false) { seen[pid] = mark; changed = true }
        continue
      }
      const cur = opp.monetaryValue != null ? Math.round(Number(opp.monetaryValue) * 100) / 100 : null
      const signed = await arcSignedContracts(pid)
      const attached = oppContractEntries(opp).length
      // Value right AND every signed contract on the opp → confirmed.
      if (cur === want && signed.length <= attached) { seen[pid] = mark; changed = true; out.confirmed++; continue }
      // Stale value (missed change order) or a signed contract the opp doesn't
      // carry → the targeted change-order path, never the full reprocess.
      const project = await arcGet(`/projects/${pid}`).catch(() => null)
      const c = (project && project.customer) || {}, a = c.address || {}
      const customer = { name: c.name || info.customer_name || 'Customer', phone: c.phone || null, email: c.email || info.customer_email || null, address1: a.street || null, city: a.city || null, state: a.state || null, postalCode: a.zip_code || null }
      const r = await arcApplyChangeOrder(pid, { opp, contactId: opp.contactId || null, customer, signed, newTotal: want, via: 'value_sweep' }).catch(e => ({ ok: false, error: e.message }))
      await arcLog(r)
      out.reprocessed.push({ project_id: pid, customer: customer.name, was: cur, now: want, action: 'change_order', contracts: r.contracts, pdf: r.pdf, ok: !!r.ok })
      if (r.ok) { seen[pid] = mark; changed = true }
    } catch { /* retry next tick */ }
  }
  if (changed) {
    const keys = Object.keys(seen)
    const map = keys.length > ARC_VALUE_SEEN_CAP
      ? Object.fromEntries(keys.slice(-ARC_VALUE_SEEN_CAP).map(k => [k, seen[k]]))
      : seen
    await arcValueSeenWrite(map)
  }
  return out
}

// ── Duplicate-opportunity audit ─────────────────────────────────────────────
// One Project ID should map to exactly ONE opportunity; two usually means a job
// landed in BOTH the outside and estimator pipelines (a routing slip) or was
// created twice. Pages the whole location, groups by Project ID, returns every
// group with 2+ opps. READ-ONLY: fixing a duplicate (deleting the stray) is a
// per-case human call — the keeper is normally the one in the correct pipeline.
async function arcDuplicateOppScan({ max = 20000 } = {}) {
  const PIPE = { [GHL_PIPELINES.outside.id]: 'outside', [GHL_PIPELINES.estimator.id]: 'estimator' }
  const byProj = new Map()
  let path = `/opportunities/search?location_id=${GHL_LOCATION_ID}&limit=100`
  let pages = 0, seen = 0
  while (path && seen < max && pages < 300) {
    const j = await ghlGet(path).catch(() => null)
    if (!j) break
    for (const op of (j.opportunities || [])) {
      seen++
      const pid = oppProjectId(op)
      if (!pid) continue
      if (!byProj.has(pid)) byProj.set(pid, [])
      byProj.get(pid).push({ id: op.id, name: op.name, value: op.monetaryValue, pipeline: PIPE[op.pipelineId] || op.pipelineId, status: op.status, created: op.createdAt })
    }
    pages++
    const next = j.meta && j.meta.nextPageUrl
    path = next && next.startsWith(GHL_BASE) ? next.slice(GHL_BASE.length) : null
  }
  const duplicates = [...byProj.entries()]
    .filter(([, v]) => v.length > 1)
    .map(([project_id, opps]) => ({ project_id, name: opps[0].name, count: opps.length, opps }))
    .sort((a, b) => b.count - a.count)
  return { scanned: seen, pages, distinct_projects: byProj.size, duplicate_count: duplicates.length, duplicates }
}

// ── New-sale text alert ─────────────────────────────────────────────────────
// When a deal comes in, text a fixed set of GHL contacts a one-line summary.
// Fires once per project; needs GHL_SMS_TOKEN (a key with the Conversations
// message-send scope — the opportunity token lacks it). Safe no-op otherwise.
const _arcAlerted = new Set()
function usd(n) {
  if (n == null || isNaN(n)) return 'n/a'
  const s = '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < 0 ? '-' + s : s
}
function saleAlertText(d) {
  return [
    `Customer Name: ${d.customer || 'Customer'}`,
    `Address: ${d.address || 'n/a'}`,
    `Job Price: ${usd(d.price)}`,
    `Sales Rep: ${d.rep || 'n/a'}`,
    `Baseline: ${usd(d.baseline)}`,
    `Markup: ${usd(d.markup)}`,
  ].join('\n')
}
async function ghlSendSms(contactId, message) {
  const resp = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST',
    headers: { ...ghlHeaders(GHL_SMS_TOKEN), 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'SMS', contactId, message }),
  })
  if (!resp.ok) throw new Error(`GHL SMS ${resp.status}: ${(await resp.text()).slice(0, 120)}`)
  return resp.json()
}
async function sendSaleAlert(projectId, data) {
  if (!GHL_SMS_TOKEN || !SALE_ALERT_CONTACTS.length) return { sent: 0, skipped: 'not configured' }
  if (projectId && _arcAlerted.has(projectId)) return { sent: 0, skipped: 'already alerted' }
  if (projectId) _arcAlerted.add(projectId)
  const text = saleAlertText(data)
  let sent = 0
  for (const cid of SALE_ALERT_CONTACTS) {
    try { await ghlSendSms(cid, text); sent++ } catch { /* one bad contact shouldn't block the others */ }
  }
  return { sent }
}

// In-memory dedupe: collapse a burst of retries for the same project+status.
const _arcSeen = new Map()
function arcRecentlyHandled(key) {
  const now = Date.now()
  for (const [k, t] of _arcSeen) if (now - t > 120000) _arcSeen.delete(k)
  if (_arcSeen.has(key) && now - _arcSeen.get(key) < 120000) return true
  _arcSeen.set(key, now); return false
}

// Verify ArcSite-Signature: header `t=<ts>,v=<hmac>`, HMAC-SHA256 of `<ts>.<body>`
// with the shared secret. Skipped (returns true) until the secret is configured,
// so the endpoint can be wired up before the signing secret is set in ArcSite.
// (If a real delivery shows ArcSite signs the body alone, drop the `t.` prefix.)
function arcSignatureOk(rawBody, header) {
  if (!ARCSITE_WEBHOOK_SECRET) return true
  const m = String(header || '').match(/t=(\d+)\s*,\s*v=([a-f0-9]+)/i)
  if (!m) return false
  const [, ts, v] = m
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 600) return false   // 10-min window
  const expect = crypto.createHmac('sha256', ARCSITE_WEBHOOK_SECRET).update(`${ts}.${rawBody}`).digest('hex')
  try { return crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(v)) } catch { return false }
}

async function arcLog(result) {
  if (!SUPABASE_URL || !SERVICE_KEY) return
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/app_settings?on_conflict=key`, {
      method: 'POST', headers: { ...jsonHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ key: 'arcsite_last_result', value: { ...result, at: new Date().toISOString() } }),
    })
  } catch { /* logging is best-effort */ }
}

// The orchestrator. `dryRun` returns the plan without writing to GHL.
async function arcsiteToGhl(rawBody, { dryRun = false } = {}) {
  if (!ARCSITE_API_TOKEN) return { ok: false, error: 'ARCSITE_API_TOKEN not set' }
  if (!GHL_WRITE_TOKEN)   return { ok: false, error: 'GHL token not set' }

  let evt
  try { evt = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody } catch { return { ok: false, error: 'invalid JSON' } }
  const type = evt.event || evt.type || evt.event_type || ''
  const status = evt.status || (evt.proposal && evt.proposal.status) || (evt.data && evt.data.status) || ''
  let projectId = String(evt.project_id || (evt.proposal && evt.proposal.project_id) || (evt.data && evt.data.project_id) || '').trim()
  const proposalId = evt.proposal_id || (evt.proposal && evt.proposal.proposal_id) || null

  // Only act on a committed proposal.
  const normStatus = arcNorm(status)
  if (type && !/status.?changed|proposal/i.test(type)) return { ok: true, ignored: true, reason: `event ${type}` }
  if (!arcCommitted(status)) return { ok: true, ignored: true, reason: `status "${status}" not a committed status` }

  // Resolve project_id from the proposal if the payload didn't carry it.
  if (!projectId && proposalId) {
    const p = await arcGet(`/proposals/${proposalId}`).catch(() => null)
    if (p) projectId = String(p.project_id || '').trim()
  }
  if (!projectId) return { ok: false, error: 'no project_id in event' }

  if (!dryRun && arcRecentlyHandled(`${projectId}:${normStatus}`)) return { ok: true, deduped: true, project_id: projectId }

  // ── Pull ArcSite detail: project (customer/address/rep) + proposal total + PDF.
  const project = await arcGet(`/projects/${projectId}`)
  const customer = project.customer || {}
  const rep = (project.sales_rep && project.sales_rep.name) || evt.sales_representative || ''
  const estimator = isEstimatorRep(rep)

  // Approved total + PDF url: from the event, else the committed proposal.
  // IMPORTANT: ArcSite exposes TWO PDFs per proposal. The PROPOSAL-level
  // `pdf_url` is the SIGNED contract — the customer's signature is rendered on
  // it. The option-level `proposal_options[].pdf_url` is the UNSIGNED estimate
  // (blank signature lines). Always upload the signed proposal-level pdf; only
  // fall back to the option pdf if a proposal has no top-level pdf at all.
  let sellTotal = Number(evt.total) || (evt.approved_option && Number(evt.approved_option.total)) || null
  let pdfUrl = null, signedDoc = null
  if (proposalId || projectId) {
    const refs = proposalId
      ? [{ proposal_id: proposalId }]
      : ((await arcGet(`/proposals?project_id=${projectId}&per_page=20`).catch(() => [])) || [])
    let fallbackOptPdf = null
    for (const pr of refs) {
      const full = pr.proposal_options ? pr : await arcGet(`/proposals/${pr.proposal_id}`).catch(() => null)
      if (!full) continue
      const opt = (full.proposal_options || [])[0]
      // Take the total ONLY from a committed proposal. With an explicit
      // proposalId (the real webhook) that one IS the committed one; without it
      // (reprocess / value sweep) the list is newest-first, so the newest
      // APPROVED wins — never a later PENDING/DRAFT edit's option total, which
      // used to overwrite the signed amount with an unsigned estimate.
      if (sellTotal == null && (proposalId || arcCommitted(full.status))) {
        sellTotal = Number(full.total) || (opt && Number(opt.total)) || null
      }
      if (!fallbackOptPdf && opt && opt.pdf_url) fallbackOptPdf = opt.pdf_url
      // Signed proposal-level pdf from the committed/approved proposal wins.
      if (!pdfUrl && full.pdf_url && (proposalId || arcCommitted(full.status))) {
        pdfUrl = full.pdf_url; signedDoc = full.document_number || full.proposal_id || null
      }
      if (pdfUrl && sellTotal != null) break
    }
    if (!pdfUrl) pdfUrl = fallbackOptPdf   // keep a document if no signed pdf exists yet
  }

  // ── Money from the SHEET (Jobs tab), the source of truth for ALL reps —
  // baseline, job price and commission. install/payment/setter-closer still come
  // from the dashboard deal (outside sales), and estimators have no deal.
  const [job, enriched] = await Promise.all([
    jobRowForProject(projectId).catch(() => null),
    estimator ? Promise.resolve(null) : dealForProject(projectId).catch(() => null),
  ])
  const deal = enriched && enriched.deal
  const pipeline = estimator ? GHL_PIPELINES.estimator : GHL_PIPELINES.outside

  const baseline = job && job.baseline != null ? job.baseline : null
  // Markup = job price − baseline (per Keaton). Both from the sheet so they agree.
  const markup = job && job.jobPrice != null && job.baseline != null
    ? Math.round((job.jobPrice - job.baseline) * 100) / 100 : null
  // Commission = the sheet's Commission column (a formula, source of truth);
  // BLANK for salaried estimators.
  const commission = estimator ? null : (job && job.commission != null ? job.commission : null)

  // People: outside sales from the deal; estimator = the ArcSite rep (inside
  // sales sets+closes, salaried → no commission).
  const setterName = estimator ? rep : (enriched && enriched.setter) || null
  const closerName = estimator ? rep : (enriched && enriched.closer) || rep || null
  const custName = customer.name || evt.customer_name || (deal && deal.deal_name) || 'Customer'

  // ── Field plan.
  const addr = customer.address || {}
  const person = {
    name: custName, phone: customer.phone || null, email: customer.email || evt.customer_email || null,
    address1: addr.street || null, city: addr.city || null, state: addr.state || null, postalCode: addr.zip_code || null,
  }
  const defs = await ghlOppFields()
  const F = GHL_OPP_FIELD_IDS
  const planned = {
    project_id: projectId,
    price: sellTotal,
    baseline, markup, commission,
    install_date: deal && deal.install_date || null,
    payment_method: deal && deal.payment_method || null,
    setter: setterName, closer: closerName, sales_rep: closerName,
  }
  const customFields = []
  for (const [key, id] of Object.entries(F)) {
    const w = oppFieldWrite(id, planned[key], defs)
    if (w) customFields.push(w)
  }

  // Opportunity owner = the closer/rep, matched to a GHL user.
  const ownerId = await ghlUserIdByName(closerName).catch(() => null)

  const plan = {
    project_id: projectId, pipeline: estimator ? 'estimator' : 'outside', rep, estimator,
    customer: custName, sell: sellTotal, hasDeal: !!deal, fields: customFields.length,
    owner: ownerId ? closerName : null, pdf: !!pdfUrl,
  }
  if (dryRun) return { ok: true, dryRun: true, plan, planned }

  // ── Upsert contact, then find-or-create the opportunity by project_id.
  const contactId = await ghlUpsertContact(person)
  if (!contactId) return { ok: false, error: 'contact upsert returned no id', plan }

  const opps = await ghlContactOpps(contactId).catch(() => [])
  let existing = opps.find(o => oppProjectId(o) === projectId) || null
  if (!existing) existing = opps.find(o => o.status === 'open' && !oppProjectId(o) && o.pipelineId === pipeline.id) || null
  let oppId = existing ? existing.id : null

  // CHANGE ORDER: a committed proposal for a Project ID that ALREADY has an
  // opportunity whose value differs from the new total = a 2nd (revised)
  // contract. Move it to the Change Order stage and KEEP BOTH drawings (append
  // the new PDF). The VALUE itself updates to the new total just like any other
  // sync (per Keaton — the opp always shows the current job amount). Compare
  // against the opp's live monetaryValue, since the Price custom field is often
  // empty on older opps (an empty field read as $0 made every 2nd proposal look
  // like a change order and the value never updated).
  const curVal = existing && existing.monetaryValue != null
    ? Math.round(Number(existing.monetaryValue) * 100) / 100 : NaN
  const isChangeOrder = !!existing && oppProjectId(existing) === projectId
    && sellTotal != null && !isNaN(curVal) && Math.abs(Math.round(sellTotal * 100) / 100 - curVal) > 0.01

  const oppBody = {
    pipelineId: pipeline.id,
    pipelineStageId: isChangeOrder ? pipeline.changeOrder : pipeline.closed,
    name: custName, contactId, status: 'open', customFields,
  }
  if (sellTotal != null) oppBody.monetaryValue = sellTotal   // value always reflects the current total
  if (ownerId) oppBody.assignedTo = ownerId

  let action, fieldsOk = true
  if (oppId) {
    await ghlUpdateOpp(oppId, oppBody); action = isChangeOrder ? 'change_order' : 'updated'
    // GHL drops monetaryValue when the SAME update also moves the pipeline stage
    // (same class of quirk as CREATE dropping monetary custom fields). On a change
    // order the stage moves to Change Order, so the new total silently didn't
    // stick — re-send it alone so it always lands (verified: value-only PUT works).
    if (isChangeOrder && sellTotal != null) {
      try { await ghlUpdateOpp(oppId, { monetaryValue: sellTotal }) } catch { fieldsOk = false }
    }
  }
  else {
    oppBody.locationId = GHL_LOCATION_ID; oppId = await ghlCreateOpp(oppBody); action = 'created'
    // GHL's opportunity CREATE silently drops MONETARY custom fields (Price,
    // Baseline, Commission) though it keeps text ones; a follow-up UPDATE sets
    // every field type, so re-apply them so a brand-new opp isn't missing price.
    // If that UPDATE blips (it left Jalyn Robbins' opp blank once), DON'T throw
    // the whole push away — flag it so the sweep re-applies the full set.
    if (customFields.length) {
      try { await ghlUpdateOpp(oppId, { customFields }) }
      catch { fieldsOk = false }
    }
  }

  // ── Contract PDF (best-effort; needs the token's medias.write scope). On a
  // change order the new contract is APPENDED so both contracts are kept.
  let pdf = pdfUrl ? 'pending' : 'none', hostedUrl = null
  if (pdfUrl && oppId) {
    try {
      const hosted = await ghlHostPdf(pdfUrl, `${custName} - contract.pdf`.replace(/[\/\\]/g, '-'))
      if (hosted) {
        hostedUrl = hosted
        // GHL's FILE_UPLOAD field takes a single URL STRING per write and APPENDS
        // it (an array 400s; "" clears). So a change order APPENDS the new
        // contract (keeping the original), while a normal set CLEARS first so a
        // webhook re-fire can't stack duplicate copies of the same contract.
        if (!isChangeOrder) await ghlUpdateOpp(oppId, { customFields: [{ id: GHL_PDF_FIELD, field_value: '' }] })
        await ghlUpdateOpp(oppId, { customFields: [{ id: GHL_PDF_FIELD, field_value: hosted }] })
        pdf = isChangeOrder ? 'appended' : 'uploaded'
      } else pdf = 'skipped: no url from upload'
    } catch (e) { pdf = 'skipped: ' + (e.message || 'upload failed') }
  }

  // ── Change order → the install calendar + the contact's "New Price" (so the
  // calendar's own 6h GHL sync agrees with the new total instead of reverting
  // it). Best-effort: the opp above is already right either way.
  let calendar
  if (isChangeOrder && oppId) {
    calendar = await arcPropagateChangeOrder({
      oppId, contactId, projectId, customer: person, newTotal: sellTotal, previousTotal: isNaN(curVal) ? null : curVal,
      contracts: hostedUrl ? [{ url: hostedUrl, name: `${custName} - contract.pdf` }] : [],
      newestContract: signedDoc ? `Proposal ${signedDoc}${sellTotal != null ? ` (${arcUsd(sellTotal)})` : ''}` : null,
    }).catch(e => ({ calendar: { error: e.message } }))
  }

  // ── New-sale text alert. A brand-new opportunity = a deal just came in, so
  // text the team the summary. (Updates and change orders don't re-text.)
  const isNewSale = action === 'created' && !isChangeOrder
  const alertData = {
    customer: custName,
    address: [addr.street, addr.city, addr.state].filter(Boolean).join(', ') || null,
    price: sellTotal, rep: closerName,
  }
  // What still has to catch up after the webhook: the sheet money (seconds) and
  // the install-calendar fields (install_date / payment_method, often a while
  // later). Plus: did the field apply above actually stick?
  const scheduleIncomplete = !estimator && (planned.install_date == null || planned.payment_method == null)
  const needEnrich = !isChangeOrder && (!fieldsOk || !job || scheduleIncomplete)

  let alert
  const moneyKnown = job && baseline != null
  if (isNewSale && fieldsOk && moneyKnown) {
    // Numbers already in hand and the opp is populated — text now.
    alert = await sendSaleAlert(projectId, { ...alertData, baseline, markup }).catch(() => null)
  }
  if (needEnrich) {
    // Keep reconciling: re-apply fields if the push blipped, fill the sheet
    // money, and fill install_date/payment_method once the job hits the
    // calendar. Defer the text to the sweep only if it hasn't gone out yet.
    arcEnrichQueue(oppId, projectId, estimator, {
      baseFields: customFields, needBase: !fieldsOk,
      alert: (isNewSale && !alert) ? alertData : null,
    })
    // Also persist it so the durable reconciler keeps filling setter/closer/
    // payment/install after the in-memory window closes or a redeploy.
    arcPendingAdd(projectId, oppId, estimator).catch(() => {})
  }

  return { ok: true, ...plan, action, change_order: isChangeOrder, opportunity_id: oppId, contact_id: contactId, owner: oppBody.assignedTo ? closerName : null, pdf, calendar, fields_ok: fieldsOk, enrich: needEnrich ? 'queued' : undefined, alert: alert ? alert.sent : (needEnrich && isNewSale ? 'deferred' : undefined) }
}

const app = express()
app.use(express.text({ type: '*/*', limit: '1mb' }))

// Read-only RepCard door/appointment numbers for a date range. Low-sensitivity
// (no money, already shown company-wide on the Home/Dashboard cards), so it is
// a plain GET with no per-user token. Always 200s: on any failure it returns
// { ok:false } with empty rows so the card degrades to hiding doors.
app.get('/api/repcard/leaderboard', async (req, res) => {
  const from = String(req.query.from || '').trim()
  const to   = String(req.query.to || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json(err('from and to must be YYYY-MM-DD'))
  }
  try { res.json({ ok: true, ...(await repcardLeaderboard(from, to)) }) }
  catch (e) { res.json({ ok: false, configured: !!REPCARD_API_TOKEN, rows: [], error: e.message || 'RepCard read failed' }) }
})

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
// ── View as a rep, for real (impersonation) ──────────────────
// "Viewing as <user>" used to swap the profile object in React only: the
// Supabase session stayed the ADMIN's, so every query still ran with admin
// rights. It showed a rep's INTERFACE over an admin's DATA and therefore
// could never reproduce what a rep actually sees — which is exactly how the
// company-wide Dashboard bug hid for so long.
//
// This mints a REAL session for the target user (admin magic link, exchanged
// immediately and never emailed), so RLS treats the browser as that person.
// Admin-only, logged, and the app refuses every write while it is active
// (see the read-only guard in src/lib/db.js).
async function impersonationLog(entry) {
  if (!SUPABASE_URL || !SERVICE_KEY) return
  try {
    const rows = await restGet(`/rest/v1/app_settings?select=value&key=eq.impersonation_log`)
    const prev = Array.isArray(rows[0]?.value) ? rows[0].value : []
    const next = [{ ...entry, at: new Date().toISOString() }, ...prev].slice(0, 100)
    await fetch(`${SUPABASE_URL}/rest/v1/app_settings?on_conflict=key`, {
      method: 'POST', headers: { ...jsonHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ key: 'impersonation_log', value: next }),
    })
  } catch { /* logging is best-effort — never block the view */ }
}

async function impersonate(body) {
  const fail = (error) => ({ ok: false, error })
  if (!SUPABASE_URL || !SERVICE_KEY) return fail('Not configured — SUPABASE_SERVICE_KEY is missing on the site service.')
  if (!body.token) return fail('Not signed in')

  // 1) Who is asking, and are they an admin?
  const meResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${body.token}` },
  })
  if (!meResp.ok) return fail('Session invalid — sign in again')
  const authId = (await meResp.json()).id
  const caller = (await restGet(`/rest/v1/profiles?select=id,name,role,is_admin,active&auth_id=eq.${authId}`))[0]
  if (!caller || caller.active === false || !(caller.role === 'admin' || caller.is_admin === true)) {
    return fail('Admins only')
  }

  // 2) Who are they becoming? Must be an ACTIVE roster member with a login.
  const targetId = String(body.profile_id || '')
  if (!targetId) return fail('Pick someone to view as')
  if (targetId === caller.id) return fail('That is already you')
  const target = (await restGet(`/rest/v1/profiles?select=id,name,email,role,active,auth_id&id=eq.${targetId}`))[0]
  if (!target) return fail('That person is not on the roster')
  if (target.active === false) return fail(`${target.name} is deactivated — they cannot sign in, so there is nothing to view`)
  if (!target.auth_id || !target.email) return fail(`${target.name} has no login yet — create one on Admin → People first`)

  // 3) Mint a session for them. A magic link is generated and redeemed here;
  //    it is never emailed and never leaves the server except as the tokens.
  const linkResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST', headers: { ...jsonHeaders },
    body: JSON.stringify({ type: 'magiclink', email: target.email }),
  })
  if (!linkResp.ok) {
    const detail = (await linkResp.text()).slice(0, 200)
    return fail(`Could not start the session (${linkResp.status}). ${detail}`)
  }
  const link = await linkResp.json()
  const props  = link.properties || link
  const hashed = props.hashed_token
  const otp    = props.email_otp
  if (!hashed && !otp) return fail('The auth service did not return a usable link.')

  // GoTrue's /verify has changed shape across versions and self-hosted
  // deployments differ, so try each known form rather than guessing one.
  // A 400 here previously reported only its status code, which told neither
  // of us anything — the body is now carried through to the message.
  const attempts = [
    hashed && { label: 'token_hash', body: { type: 'magiclink', token_hash: hashed } },
    otp    && { label: 'email_otp',  body: { type: 'magiclink', token: otp, email: target.email } },
    hashed && { label: 'hashed+email', body: { type: 'magiclink', token: hashed, email: target.email } },
  ].filter(Boolean)

  let session = null
  const tried = []

  // FIRST: redeem the action link itself. That is exactly what clicking the
  // email would do, so it is the form least likely to disagree with whatever
  // GoTrue version is deployed. It answers 302 with the tokens in the URL
  // fragment — not sent to a server normally, but readable here in Location.
  // It goes first because a magic-link token is single use: a POST attempt
  // that half-consumed it would leave nothing for this to redeem.
  if (props.action_link) {
    try {
      const r = await fetch(props.action_link, { redirect: 'manual' })
      const loc = r.headers.get('location') || ''
      const q = new URLSearchParams(loc.split('#')[1] || '')
      if (q.get('access_token') && q.get('refresh_token')) {
        session = { access_token: q.get('access_token'), refresh_token: q.get('refresh_token') }
      } else {
        tried.push(`action_link → ${r.status} ${(loc || '(no redirect)').slice(0, 140)}`)
      }
    } catch (e) {
      tried.push(`action_link → ${e.message}`)
    }
  }

  for (const attempt of (session ? [] : attempts)) {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
      method: 'POST', headers: { apikey: SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(attempt.body),
    })
    const text = await resp.text()
    if (resp.ok) {
      try { session = JSON.parse(text) } catch { session = null }
      if (session?.access_token) break
      session = null
    }
    tried.push(`${attempt.label} → ${resp.status} ${text.slice(0, 160)}`)
  }
  if (!session?.access_token || !session?.refresh_token) {
    return fail(`Could not complete the session. The auth service refused every form: ${tried.join(' | ')}`)
  }

  await impersonationLog({ by: caller.name, by_id: caller.id, viewed: target.name, viewed_id: target.id })
  return {
    ok: true,
    session: { access_token: session.access_token, refresh_token: session.refresh_token },
    profile: { id: target.id, name: target.name, role: target.role },
  }
}

// POST /api/company/deals — every deal, override columns removed, for the
// company-wide pages. Any ACTIVE signed-in user; the browser sends only its
// own session token (same shape as the audit endpoints).
app.post('/api/company/deals', async (req, res) => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.json({ ok: false, error: 'Not configured — SUPABASE_SERVICE_KEY is missing on the site service.' })
  }
  let body
  try { body = JSON.parse(req.body || '{}') } catch { return res.json({ ok: false, error: 'Bad request body.' }) }
  if (!body.token) return res.json({ ok: false, error: 'Not signed in' })
  try {
    const meResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${body.token}` },
    })
    if (!meResp.ok) return res.json({ ok: false, error: 'Session invalid — sign in again' })
    const authId = (await meResp.json()).id
    // Any ACTIVE roster member may read company figures. A deactivated person
    // is blocked at login anyway; this stops a live token outliving that.
    const caller = (await restGet(`/rest/v1/profiles?select=id,active&auth_id=eq.${authId}`))[0]
    if (!caller || caller.active === false) return res.json({ ok: false, error: 'No active profile' })
    res.json({ ok: true, deals: await companyDeals() })
  } catch (e) {
    res.json({ ok: false, error: e.message || 'Could not load company deals' })
  }
})

// POST /api/impersonate — become another user, read-only. Admin-only.
app.post('/api/impersonate', async (req, res) => {
  let body
  try { body = JSON.parse(req.body || '{}') } catch { return res.json({ ok: false, error: 'Bad request body.' }) }
  try { res.json(await impersonate(body)) }
  catch (e) { res.json({ ok: false, error: e.message || 'Could not start the view' }) }
})

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    userAdmin: !!(SUPABASE_URL && SERVICE_KEY),
    repcard: !!REPCARD_API_TOKEN,
    arcsite: !!ARCSITE_API_TOKEN,
    saleAlerts: !!GHL_SMS_TOKEN,
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
  try { res.json(await routeCrmEvents(req.body, 'leads')) }
  catch (e) { res.status(500).json(err(e.message || 'Ingest failed')) }
})

// Door-knocking activity from the CRM — same auth as the leads feed.
app.post('/api/field/ingest', async (req, res) => {
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(503).json(err('Field ingest is not configured — SUPABASE_SERVICE_KEY is missing on the site service.'))
  if (!ingestAuthorized(req)) return res.status(401).json(err('Unauthorized'))
  try { res.json(await routeCrmEvents(req.body, 'field')) }
  catch (e) { res.status(500).json(err(e.message || 'Ingest failed')) }
})

// ArcSite → GHL native webhook (replaces the Zapier ArcSite→GHL zap). Signature
// is verified once ARCSITE_WEBHOOK_SECRET is set; until then it accepts and
// processes so the endpoint can be wired up first. Always 200s on a handler
// error so ArcSite's retries don't hammer a transient failure forever.
app.post('/api/arcsite/webhook', async (req, res) => {
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})
  if (!arcSignatureOk(rawBody, req.headers['arcsite-signature'])) return res.status(401).json(err('bad signature'))
  try { const r = await arcsiteToGhl(rawBody); await arcLog(r); res.json(r) }
  catch (e) { const r = { ok: false, error: e.message || 'ArcSite webhook failed' }; await arcLog(r); res.status(200).json(r) }
})
// Dry-run: same mapping, NO GHL writes — returns the plan. Guarded by the feed
// secret. Body = a sample event, or just { "status": "...", "project_id": "..." }.
app.post('/api/arcsite/dry-run', async (req, res) => {
  if (!ingestAuthorized(req)) return res.status(401).json(err('Unauthorized'))
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})
  try { res.json(await arcsiteToGhl(rawBody, { dryRun: true })) }
  catch (e) { res.status(200).json({ ok: false, error: e.message }) }
})

// Reprocess: run the REAL mapping (writes to GHL, sends the text) for a sale
// the webhook missed or failed on. Guarded by the feed secret — no ArcSite
// signature needed, so a missed sale can be pushed without a re-fire from
// ArcSite. Body = { project_id, status? } (status defaults to APPROVED).
app.post('/api/arcsite/reprocess', async (req, res) => {
  if (!ingestAuthorized(req)) return res.status(401).json(err('Unauthorized'))
  let body = {}
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch {}
  const projectId = String(body.project_id || '').trim()
  if (!projectId) return res.status(400).json(err('project_id is required'))
  const rawBody = JSON.stringify({ status: body.status || 'APPROVED', project_id: projectId })
  try { const r = await arcsiteToGhl(rawBody); await arcLog(r); res.json(r) }
  catch (e) { const r = { ok: false, error: e.message || 'reprocess failed' }; await arcLog(r); res.status(200).json(r) }
})

// Change order, by hand: the TARGETED path for one project (contracts rebuilt
// if ArcSite holds more signed proposals than the opp carries, value + Change
// Order stage if the total moved, the contact's New Price, and the install
// calendar). Unlike /reprocess it never re-maps fields or moves a job back to
// Closed. Body = { project_id }. Same guard as the feed.
app.post('/api/arcsite/change-order', async (req, res) => {
  if (!ingestAuthorized(req)) return res.status(401).json(err('Unauthorized'))
  let body = {}
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch {}
  const projectId = String(body.project_id || '').trim()
  if (!projectId) return res.status(400).json(err('project_id is required'))
  try { const r = await arcChangeOrderForProject(projectId, 'manual'); await arcLog(r); res.json(r) }
  catch (e) { const r = { ok: false, error: e.message || 'change order failed' }; await arcLog(r); res.status(200).json(r) }
})

// The daily contract audit by hand (POST, takes a few minutes; body
// { fix?: false, days_back?: n }) and its last stored result (GET).
app.get('/api/arcsite/contract-audit', async (req, res) => {
  if (!ingestAuthorized(req)) return res.status(401).json(err('Unauthorized'))
  res.json((await arcContractAuditLast().catch(() => null)) || { ok: false, error: 'no audit has run yet' })
})
app.post('/api/arcsite/contract-audit', async (req, res) => {
  if (!ingestAuthorized(req)) return res.status(401).json(err('Unauthorized'))
  let body = {}
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch {}
  const fix = body.fix !== false && body.fix !== 'false'
  const daysBack = Number(body.days_back) > 0 ? Number(body.days_back) : undefined
  try { res.json(await arcContractAudit({ fix, daysBack })) }
  catch (e) { res.status(200).json({ ok: false, error: e.message || 'audit failed' }) }
})

// Run the value-reconcile sweep on demand (same auth as the feed). Returns a
// summary of what it scanned, confirmed and reprocessed — no body needed.
app.post('/api/arcsite/value-sweep', async (req, res) => {
  if (!ingestAuthorized(req)) return res.status(401).json(err('Unauthorized'))
  try { res.json(await arcValueSweep()) }
  catch (e) { res.status(200).json({ ok: false, error: e.message }) }
})
// Read-only audit of opportunities sharing a Project ID (same auth as the feed).
app.post('/api/arcsite/duplicate-opps', async (req, res) => {
  if (!ingestAuthorized(req)) return res.status(401).json(err('Unauthorized'))
  try { res.json(await arcDuplicateOppScan()) }
  catch (e) { res.status(200).json({ ok: false, error: e.message }) }
})

app.post('/api/user-admin', async (req, res) => {
  try { res.json(await handleUserAdmin(req.body)) }
  catch (e) { res.json(err(e.message || 'Server error')) }
})

// ── Deal audit (admin/Keaton — verified inside each handler) ────────────────
app.post('/api/audit/deal', async (req, res) => {
  try { res.json(await handleAuditDeal(req.body)) }
  catch (e) { res.json(err(e.message || 'Audit failed')) }
})
app.post('/api/audit/queue', async (req, res) => {
  try { res.json(await handleAuditQueue(req.body)) }
  catch (e) { res.json(err(e.message || 'Audit failed')) }
})
app.post('/api/audit/check', async (req, res) => {
  try { res.json(await handleAuditCheck(req.body)) }
  catch (e) { res.json(err(e.message || 'Audit failed')) }
})
app.post('/api/audit/ghl-fill', async (req, res) => {
  try { res.json(await handleGhlFill(req.body)) }
  catch (e) { res.json(err(e.message || 'Fill failed')) }
})
app.post('/api/audit/ghl-fields', async (req, res) => {
  try { res.json(await handleGhlFields(req.body)) }
  catch (e) { res.json(err(e.message || 'Request failed')) }
})

// ── Scheduled team moves (migration 058) ───────────────────────────────────
// A move dated ahead changes nothing until its day, so SOMETHING has to
// perform it on that day. This is that something: the site server is always
// running, so it needs no cron and no Apps Script (which would mean a manual
// paste to deploy).
//
// Admin → People also sweeps on load, deliberately — either path alone is a
// single point of failure, and apply_due_team_moves() is idempotent, so
// running both costs nothing. 15 minutes is plenty of resolution for a change
// whose granularity is a calendar day.
//
// Repeated identical failures are logged ONCE. Before the migration has been
// run this call 404s, and a line every 15 minutes forever would bury the logs
// that matter.
const TEAM_MOVE_SWEEP_MS = 15 * 60 * 1000
let _lastMoveSweepError = null
async function teamMoveSweep() {
  if (!SUPABASE_URL || !SERVICE_KEY) return
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/apply_due_team_moves`, {
      method: 'POST', headers: jsonHeaders, body: '{}',
    })
    const text = await resp.text()
    if (!resp.ok) throw new Error(`${resp.status}: ${text.slice(0, 200)}`)
    _lastMoveSweepError = null
    let applied = 0
    try { applied = Number(JSON.parse(text)?.applied || 0) } catch { /* empty body = nothing due */ }
    if (applied) console.log(`[team-moves] applied ${applied} scheduled move(s)`)
  } catch (e) {
    const msg = e.message || String(e)
    if (msg !== _lastMoveSweepError) {
      _lastMoveSweepError = msg
      console.warn(`[team-moves] sweep failed (will keep retrying quietly): ${msg}`)
    }
  }
}
// A short delay at boot so a deploy isn't racing the database coming up.
setTimeout(teamMoveSweep, 20_000).unref?.()
setInterval(teamMoveSweep, TEAM_MOVE_SWEEP_MS).unref?.()

// Durable ArcSite→GHL field reconciliation (setter/closer/payment/install/money)
// for sales whose deal/calendar data landed after the webhook. Every 5 min.
setTimeout(() => arcPendingReconcile().catch(() => {}), 30_000).unref?.()
setInterval(() => arcPendingReconcile().catch(() => {}), 5 * 60_000).unref?.()

// Catch committed proposals ArcSite never delivered a webhook for — missed
// change-order totals and missed sales. Every 10 min (cheap: only changed/new
// approvals hit GHL, the rest skip via the confirmed-total map).
setTimeout(() => arcValueSweep().catch(() => {}), 90_000).unref?.()
setInterval(() => arcValueSweep().catch(() => {}), 10 * 60_000).unref?.()

// The daily FULL contract audit — every opp installing recently or in the
// future, checked against ArcSite's signed contracts. The tick runs every 15
// min and does the work once, in the ARC_AUDIT_HOUR hour (Phoenix).
setInterval(() => arcContractAuditTick().catch(() => {}), 15 * 60_000).unref?.()

app.use(express.static(dist))
// SPA fallback — every non-file route serves the app shell.
app.use((req, res) => res.sendFile(path.join(dist, 'index.html')))

const port = process.env.PORT || 3000
app.listen(port, () => console.log(`Turf Time dashboard on :${port} (user admin ${SERVICE_KEY ? 'ready' : 'NOT configured'})`))
