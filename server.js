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

  switch (body.action) {
    case 'create_login':   return createLogin(target, body.password)
    case 'reset_password': return resetPassword(target, body.password)
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
  return {
    generatedAt: new Date().toISOString(),
    since,
    months: Object.keys(months).sort().map(key => ({ key, label: monthName(key), rows: months[key] })),
  }
}

const app = express()
app.use(express.text({ type: '*/*', limit: '16kb' }))

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

app.post('/api/user-admin', async (req, res) => {
  try { res.json(await handleUserAdmin(req.body)) }
  catch (e) { res.json(err(e.message || 'Server error')) }
})

app.use(express.static(dist))
// SPA fallback — every non-file route serves the app shell.
app.use((req, res) => res.sendFile(path.join(dist, 'index.html')))

const port = process.env.PORT || 3000
app.listen(port, () => console.log(`Turf Time dashboard on :${port} (user admin ${SERVICE_KEY ? 'ready' : 'NOT configured'})`))
