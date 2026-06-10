/**
 * Thin data-access layer — the SINGLE gateway to data.
 * Every page goes through here. In demo mode it returns in-memory data;
 * in live mode it queries Supabase. No page should import `supabase` directly.
 */
import { supabase, DEMO_MODE } from './supabase'
import {
  DEMO_USERS,
  DEMO_DEALS_JOINED,
  DEMO_PAYMENTS,
  DEMO_GOALS,
  DEMO_WEEKLY_STATS,
  DEMO_SETTINGS,
  DEMO_COMPETITIONS,
} from './demoData'

// Local mutable copies for demo CRUD
let _deals       = DEMO_DEALS_JOINED.map(d => ({ ...d }))
let _users       = DEMO_USERS.map(u => ({ ...u }))
let _payments    = DEMO_PAYMENTS.map(p => ({ ...p }))
let _goals       = { ...DEMO_GOALS } // keyed "YYYY-M" -> baseline_target
let _weeklyStats = DEMO_WEEKLY_STATS.map(s => ({ ...s }))
let _settings    = JSON.parse(JSON.stringify(DEMO_SETTINGS))
let _competitions = (DEMO_COMPETITIONS || []).map(c => ({ ...c }))

const goalKey = (y, m) => `${y}-${m}`

const DEAL_SELECT = `
  *,
  setter:setter_id(id,name),
  closer:closer_id(id,name),
  manager:manager_id(id,name),
  director:director_id(id,name),
  vp:vp_id(id,name)
`

// ── Deals ─────────────────────────────────────────────────────

// Pre-migration safety: if a live write fails because the database doesn't
// have a column yet (e.g. `payment_method` before 006_settings.sql is run),
// drop that column from the payload and retry. Lets new fields ship before
// the matching migration is applied, without breaking deal saves.
async function writeWithSchemaFallback(run, payload) {
  let res = await run(payload)
  let guard = 0
  while (res?.error && guard++ < 6) {
    const col = /Could not find the '([^']+)' column/.exec(res.error.message || '')?.[1]
    if (!col || !(col in payload)) break
    const { [col]: _omit, ...rest } = payload
    payload = rest
    res = await run(payload)
  }
  return res
}

export async function fetchDeals() {
  if (DEMO_MODE) return { data: _deals, error: null }
  return supabase.from('deals').select(DEAL_SELECT).order('sale_date', { ascending: false })
}

export async function insertDeal(data, profileId) {
  if (DEMO_MODE) {
    const id = 'deal-' + Math.random().toString(36).slice(2, 9)
    const newDeal = {
      ...data,
      id,
      created_by: profileId,
      created_at: new Date().toISOString(),
      setter:   _users.find(u => u.id === data.setter_id)  ?? null,
      closer:   _users.find(u => u.id === data.closer_id)  ?? null,
      manager:  _users.find(u => u.id === data.manager_id) ?? null,
      director: _users.find(u => u.id === data.director_id)?? null,
      vp:       _users.find(u => u.id === data.vp_id)      ?? null,
    }
    _deals = [newDeal, ..._deals]
    return { error: null }
  }
  return writeWithSchemaFallback(
    p => supabase.from('deals').insert([p]),
    { ...data, created_by: profileId }
  )
}

// Edit history for one deal (written by the 019 DB trigger, newest first).
// Returns [] in demo mode or before the migration has run, so callers can
// render unconditionally.
export async function fetchDealHistory(dealId) {
  if (DEMO_MODE) return { data: [], error: null }
  const { data, error } = await supabase
    .from('deal_history')
    .select('*')
    .eq('deal_id', dealId)
    .order('changed_at', { ascending: false })
    .limit(50)
  return { data: error ? [] : (data ?? []), error }
}

export async function updateDeal(id, data) {
  if (DEMO_MODE) {
    _deals = _deals.map(d =>
      d.id === id
        ? {
            ...d, ...data,
            setter:   _users.find(u => u.id === (data.setter_id   ?? d.setter_id))   ?? d.setter,
            closer:   _users.find(u => u.id === (data.closer_id   ?? d.closer_id))   ?? d.closer,
            manager:  _users.find(u => u.id === (data.manager_id  ?? d.manager_id))  ?? d.manager,
            director: _users.find(u => u.id === (data.director_id ?? d.director_id)) ?? d.director,
            vp:       _users.find(u => u.id === (data.vp_id       ?? d.vp_id))       ?? d.vp,
          }
        : d
    )
    return { error: null }
  }
  return writeWithSchemaFallback(
    p => supabase.from('deals').update(p).eq('id', id),
    { ...data }
  )
}

export async function deleteDeal(id) {
  if (DEMO_MODE) {
    _deals = _deals.filter(d => d.id !== id)
    return { error: null, data: [{ id }] }
  }
  // .select() returns the rows actually deleted — so the caller can tell when
  // RLS silently blocked the delete (0 rows, no error).
  return supabase.from('deals').delete().eq('id', id).select('id')
}

// ── Competitions ──────────────────────────────────────────────
export async function fetchCompetitions() {
  if (DEMO_MODE) return { data: _competitions, error: null }
  const res = await supabase.from('competitions').select('*').order('created_at', { ascending: false })
  // Table may not exist yet (before 009 is run) — degrade gracefully.
  if (res.error) return { data: [], error: res.error }
  return res
}

export async function insertCompetition(data, profileId) {
  if (DEMO_MODE) {
    const c = { ...data, id: 'comp-' + Math.random().toString(36).slice(2, 9), created_by: profileId, created_at: new Date().toISOString() }
    _competitions = [c, ..._competitions]
    return { data: [c], error: null }
  }
  return writeWithSchemaFallback(
    p => supabase.from('competitions').insert([p]).select(),
    { ...data, created_by: profileId }
  )
}

export async function updateCompetition(id, data) {
  if (DEMO_MODE) {
    _competitions = _competitions.map(c => c.id === id ? { ...c, ...data } : c)
    return { error: null }
  }
  return writeWithSchemaFallback(
    p => supabase.from('competitions').update(p).eq('id', id),
    { ...data }
  )
}

export async function deleteCompetition(id) {
  if (DEMO_MODE) {
    _competitions = _competitions.filter(c => c.id !== id)
    return { error: null, data: [{ id }] }
  }
  return supabase.from('competitions').delete().eq('id', id).select('id')
}

// ── Users / Profiles ──────────────────────────────────────────
export async function fetchUsers() {
  if (DEMO_MODE) return { data: _users, error: null }
  return supabase.from('profiles').select('*').order('name')
}

export async function insertUser(data) {
  if (DEMO_MODE) {
    const id = 'u-new-' + Math.random().toString(36).slice(2, 7)
    const { password, ...rest } = data
    const newUser = { ...rest, id, active: true }
    _users = [..._users, newUser]
    return { data: newUser, error: null }
  }
  // Live: profile row only. The matching auth user must be created in Studio.
  const { password, ...rest } = data
  return writeWithSchemaFallback(p => supabase.from('profiles').insert([p]), rest)
}

// ── Deal notes (threads) + notifications ─────────────────────
let _dealNotes = []      // demo-mode thread store
let _notifications = []  // demo-mode bell store

export async function fetchDealNotes(dealId) {
  if (DEMO_MODE) return { data: _dealNotes.filter(n => n.deal_id === dealId), error: null }
  const { data, error } = await supabase
    .from('deal_notes')
    .select('*, author:author_id(id,name)')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: true })
  return { data: error ? [] : (data ?? []), error }
}

// Count of thread notes per deal (one query) — drives the 💬 badge on rows.
export async function fetchDealNoteCounts() {
  if (DEMO_MODE) {
    const m = {}
    _dealNotes.forEach(n => { m[n.deal_id] = (m[n.deal_id] || 0) + 1 })
    return { data: m, error: null }
  }
  const { data, error } = await supabase.from('deal_notes').select('deal_id')
  if (error) return { data: {}, error }
  const m = {}
  for (const r of data ?? []) m[r.deal_id] = (m[r.deal_id] || 0) + 1
  return { data: m, error: null }
}

// Post a note and fan out bell notifications to everyone on the deal except
// the author. Notification failure never fails the note itself.
export async function addDealNote({ dealId, dealName, body, author, recipientIds }) {
  const uniq = [...new Set((recipientIds || []).filter(id => id && id !== author.id))]
  if (DEMO_MODE) {
    _dealNotes.push({ id: 'n-' + Math.random().toString(36).slice(2, 9), deal_id: dealId, author_id: author.id, author: { id: author.id, name: author.name }, body, created_at: new Date().toISOString() })
    uniq.forEach(uid => _notifications.push({ id: 'nf-' + Math.random().toString(36).slice(2, 9), user_id: uid, deal_id: dealId, body: `${author.name} commented on ${dealName}`, read: false, created_at: new Date().toISOString() }))
    return { error: null }
  }
  const { error } = await supabase.from('deal_notes').insert([{ deal_id: dealId, author_id: author.id, body }])
  if (error) return { error }
  if (uniq.length) {
    try {
      await supabase.from('notifications').insert(
        uniq.map(uid => ({ user_id: uid, deal_id: dealId, body: `${author.name} commented on ${dealName}` }))
      )
    } catch { /* bell is best-effort */ }
  }
  return { error: null }
}

export async function fetchNotifications(profileId) {
  if (DEMO_MODE) return { data: _notifications.filter(n => n.user_id === profileId).slice().reverse().slice(0, 20), error: null }
  const { data, error } = await supabase
    .from('notifications').select('*')
    .eq('user_id', profileId)
    .order('created_at', { ascending: false })
    .limit(20)
  return { data: error ? [] : (data ?? []), error }
}

export async function markNotificationsRead(profileId) {
  if (DEMO_MODE) { _notifications = _notifications.map(n => n.user_id === profileId ? { ...n, read: true } : n); return { error: null } }
  return supabase.from('notifications').update({ read: true }).eq('user_id', profileId).eq('read', false)
}

// ── Client error reporting (Watchdog feed) ───────────────────
// Best-effort: must NEVER throw or recurse (an error logger that errors is a
// crash loop). Dedupes per session so a render-loop crash logs once, not 1000x.
const _seenErrors = new Set()
export async function logClientError({ message, stack }) {
  try {
    if (DEMO_MODE) return
    const key = String(message).slice(0, 120)
    if (_seenErrors.has(key) || _seenErrors.size > 20) return
    _seenErrors.add(key)
    const { data: { session } } = await supabase.auth.getSession()
    let profileId = null
    if (session?.user?.id) {
      const { data } = await supabase.from('profiles').select('id').eq('auth_id', session.user.id).single()
      profileId = data?.id ?? null
    }
    await supabase.from('client_errors').insert([{
      path: window.location?.pathname ?? null,
      message: String(message).slice(0, 500),
      stack: String(stack || '').slice(0, 4000),
      user_agent: navigator.userAgent?.slice(0, 200) ?? null,
      profile_id: profileId,
    }])
  } catch { /* swallow — never let the logger crash the app */ }
}

// ── Privileged user-admin actions (create login / reset password / enable
// /disable login). These need the service-role key, so they go through the
// Apps Script web app (VITE_USER_ADMIN_URL), authorized by the caller's own
// Supabase session token — the endpoint verifies they're an admin. Returns
// { ok, ... } or { ok:false, error }.
const USER_ADMIN_URL = import.meta.env.VITE_USER_ADMIN_URL
export function userAdminConfigured() { return !!USER_ADMIN_URL }
export async function userAdmin(action, payload = {}) {
  if (DEMO_MODE) return { ok: false, error: 'Disabled in demo mode.' }
  if (!USER_ADMIN_URL) return { ok: false, error: 'User-admin endpoint not configured (set VITE_USER_ADMIN_URL).' }
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return { ok: false, error: 'Not signed in.' }
  try {
    // text/plain keeps it a "simple" CORS request (no preflight) for Apps Script.
    const resp = await fetch(USER_ADMIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: session.access_token, ...payload }),
    })
    return await resp.json()
  } catch (e) {
    return { ok: false, error: e.message || 'Request failed.' }
  }
}

export async function updateUser(id, data) {
  if (DEMO_MODE) {
    _users = _users.map(u => u.id === id ? { ...u, ...data } : u)
    return { error: null }
  }
  const { password, ...rest } = data
  return writeWithSchemaFallback(p => supabase.from('profiles').update(p).eq('id', id), rest)
}

export async function deleteUser(id) {
  if (DEMO_MODE) {
    _users = _users.filter(u => u.id !== id)
    return { error: null }
  }
  return supabase.from('profiles').delete().eq('id', id)
}

// ── Payments ──────────────────────────────────────────────────
export async function fetchPayments() {
  if (DEMO_MODE) return { data: _payments, error: null }
  return supabase.from('payments').select(
    '*, deal:deal_id(deal_name), user:user_id(name)'
  ).order('pay_date', { ascending: false })
}

export async function deletePayment(id) {
  if (DEMO_MODE) {
    _payments = _payments.filter(p => p.id !== id)
    return { error: null }
  }
  return supabase.from('payments').delete().eq('id', id)
}

// ── Monthly goals ─────────────────────────────────────────────
export async function fetchGoal(year, month) {
  if (DEMO_MODE) {
    const t = _goals[goalKey(year, month)]
    return { data: t != null ? t : null, error: null }
  }
  const { data, error } = await supabase
    .from('monthly_goals').select('baseline_target')
    .eq('year', year).eq('month', month).maybeSingle()
  return { data: data?.baseline_target != null ? parseFloat(data.baseline_target) : null, error }
}

export async function saveGoal(year, month, target) {
  if (DEMO_MODE) {
    _goals = { ..._goals, [goalKey(year, month)]: target }
    return { error: null }
  }
  return supabase.from('monthly_goals')
    .upsert({ year, month, baseline_target: target }, { onConflict: 'year,month' })
}

export async function deleteGoal(year, month) {
  if (DEMO_MODE) {
    const next = { ..._goals }
    delete next[goalKey(year, month)]
    _goals = next
    return { error: null }
  }
  return supabase.from('monthly_goals').delete().eq('year', year).eq('month', month)
}

// ── Weekly stats (rep estimates → close rate) ─────────────────
export async function fetchWeeklyStats() {
  if (DEMO_MODE) return { data: _weeklyStats, error: null }
  return supabase.from('weekly_stats').select('*').order('week_start', { ascending: false })
}

export async function upsertWeeklyStat({ rep_id, week_start, self_gen_estimates = 0, lead_estimates = 0 }, profileId) {
  const sg = Math.max(0, Number(self_gen_estimates) || 0)
  const ld = Math.max(0, Number(lead_estimates) || 0)
  const row = { rep_id, week_start, self_gen_estimates: sg, lead_estimates: ld, estimates: sg + ld }
  if (DEMO_MODE) {
    _weeklyStats = [
      ..._weeklyStats.filter(s => !(s.rep_id === rep_id && s.week_start === week_start)),
      row,
    ]
    return { error: null }
  }
  // schema-fallback: if the split columns aren't there yet, it still saves `estimates`.
  return writeWithSchemaFallback(
    p => supabase.from('weekly_stats').upsert(p, { onConflict: 'rep_id,week_start' }),
    { ...row, created_by: profileId }
  )
}

// ── App settings (admin-editable config lists) ────────────────
export async function fetchSettings() {
  if (DEMO_MODE) return { data: JSON.parse(JSON.stringify(_settings)), error: null }
  const { data, error } = await supabase.from('app_settings').select('key,value')
  if (error) return { data: null, error }
  const obj = {}
  for (const row of data ?? []) obj[row.key] = row.value
  return { data: obj, error: null }
}

export async function saveSetting(key, value, profileId) {
  if (DEMO_MODE) {
    _settings = { ..._settings, [key]: value }
    return { error: null }
  }
  return supabase.from('app_settings')
    .upsert({ key, value, updated_by: profileId }, { onConflict: 'key' })
}
