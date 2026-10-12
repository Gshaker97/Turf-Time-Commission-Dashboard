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
const GHL_LOCATION_ID = (process.env.GHL_LOCATION_ID || 'lm0glrcKsZ05EcZrGS9t').trim()
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

app.use(express.static(dist))
// SPA fallback — every non-file route serves the app shell.
app.use((req, res) => res.sendFile(path.join(dist, 'index.html')))

const port = process.env.PORT || 3000
app.listen(port, () => console.log(`Turf Time dashboard on :${port} (user admin ${SERVICE_KEY ? 'ready' : 'NOT configured'})`))
