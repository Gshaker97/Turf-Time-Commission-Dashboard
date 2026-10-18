import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { auditQueue, auditDeal, setChecklistItem, updateDeal, fetchDealChecklists, ghlFill } from '../lib/db'
import { AUDIT_ITEMS } from '../utils/dealAudit7'
import { payDateFromInstall } from '../utils/dateRanges'
import { toast } from '../lib/toast'

// The shared engine for the inline deal-audit checklist on Deals → Needs
// review. Auditors (admin/Keaton) get the live audit with auto-checks + fix
// buttons; everyone else sees the last stored result, read-only.
//
// The live audit reads the install sheet + GoHighLevel for every deal, which is
// slow, so the auditor view CACHES the whole queue result in localStorage for
// an hour. Opening Needs review reuses that cache instantly; "Re-run all"
// forces a fresh audit, and any single-deal change (toggle / fix / re-run)
// patches the cache in place so it stays correct without resetting the timer.
// v2: the key was bumped when a cached entry with no `items` array was found
// crashing Needs review on every load (see usableAudit below). Bumping it
// abandons every bad cache already sitting in a browser, so nobody has to
// clear site data to get the page back.
const CACHE_KEY = 'tt_audit_queue_cache_v2'
const CACHE_TTL = 60 * 60 * 1000   // 1 hour

// An audit is only usable if it carries the ARRAY the strip maps over.
// AuditStrip used to test the audit OBJECT and then map `a.items`, so an
// entry missing that array threw during render — and because the entry came
// from the cache, the crash repeated on every reload and nothing ever got far
// enough to refresh it. A render crash that feeds itself from storage is the
// worst kind: the page cannot recover on its own.
export const usableAudit = (a) => !!a && Array.isArray(a.items)

function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    if (!c || typeof c.at !== 'number' || !c.byId) return null
    // One bad entry discards the whole cache rather than being filtered out:
    // a fresh audit then rebuilds every deal correctly, where filtering would
    // silently leave that one deal with no checklist and no explanation.
    if (!Object.values(c.byId).every(usableAudit)) return null
    return c
  } catch { return null }
}
function writeCache(byId) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), byId })) } catch { /* ignore */ }
}
// Update one deal in the cache WITHOUT resetting the hourly timer.
function patchCache(dealId, audit) {
  try {
    const c = readCache(); if (!c) return
    c.byId[dealId] = audit
    localStorage.setItem(CACHE_KEY, JSON.stringify(c))
  } catch { /* ignore */ }
}

export function useAudit({ deals = [], canAudit = false, enabled = true, onDealChanged }) {
  const navigate = useNavigate()
  const [byId, setById]   = useState({})     // deal_id -> audit result (or stored rows)
  const [state, setState] = useState('idle') // idle|loading|error|ready|disabled
  const [err, setErr]     = useState(null)
  const [busy, setBusy]   = useState({})
  const [cachedAt, setCachedAt] = useState(null)  // when the shown queue was last fully audited
  const dealById = Object.fromEntries(deals.map(d => [d.id, d]))
  const ids = deals.map(d => d.id).join(',')

  const run = useCallback(async (force = false) => {
    if (!enabled) { setState('idle'); return }
    if (canAudit) {
      // Serve the cached queue instantly unless it's stale (>1h) or a refresh
      // was explicitly asked for (the "Re-run all" button).
      if (!force) {
        const c = readCache()
        if (c && Date.now() - c.at < CACHE_TTL) { setById(c.byId); setCachedAt(c.at); setState('ready'); return }
      }
      setState('loading'); setErr(null)
      const res = await auditQueue()
      if (res?.ok === false) {
        if (/demo/i.test(res.error || '')) { setState('disabled'); return }
        setState('error'); setErr(res.error || 'Audit failed'); return
      }
      // Same guard on the way IN from the server, so a malformed audit can
      // never reach the cache (which is how one got stuck in the first place).
      const map = {}
      for (const a of res.audits || []) if (usableAudit(a)) map[a.deal_id] = a
      setById(map); writeCache(map); setCachedAt(Date.now()); setState('ready')
    } else {
      // Read-only: the last stored checklist for the shown deals (already fast).
      setState('loading'); setErr(null)
      const { data } = await fetchDealChecklists(deals.map(d => d.id))
      const map = {}
      for (const d of deals) {
        const rows = data[d.id] || {}
        map[d.id] = {
          deal_id: d.id, deal_name: d.deal_name,
          done: AUDIT_ITEMS.filter(i => rows[i.key]?.checked).length, total: AUDIT_ITEMS.length,
          items: AUDIT_ITEMS.map(i => ({
            key: i.key, label: i.label, manual: i.manual,
            checked: !!rows[i.key]?.checked, reason: rows[i.key]?.note || null, fix: null,
          })),
        }
      }
      setById(map); setState('ready')
    }
    // id-string dep: reruns only when the shown set of deals changes (a cache
    // hit then makes that instant). Not depending on the deals/onDealChanged
    // objects, which change identity every render.
  }, [enabled, canAudit, ids])

  useEffect(() => { run() }, [run])

  const mark = (id, v) => setBusy(b => ({ ...b, [id]: v }))
  // Apply a fresh single-deal audit to both the live view and the cache.
  const applyAudit = (id, audit) => {
    if (!usableAudit(audit)) return
    setById(m => ({ ...m, [id]: audit })); patchCache(id, audit)
  }

  async function rerun(id) {
    mark(id, true)
    const res = await auditDeal(id)
    if (res?.ok && res.audit) applyAudit(id, res.audit)
    else if (res?.ok === false) toast.error(res.error || 'Audit failed')
    mark(id, false)
  }

  async function toggleManual(id, key, checked) {
    mark(id, true)
    const res = await setChecklistItem(id, key, checked)
    if (res?.ok && res.audit) { applyAudit(id, res.audit); onDealChanged?.() }
    else toast.error(res?.error || 'Could not save')
    mark(id, false)
  }

  async function applyFix(id, fix) {
    const deal = dealById[id]
    if (!deal || !fix) return
    if (fix.type === 'assign_team') { navigate('/admin'); return }
    if (fix.type === 'ghl_fill') {
      mark(id, true)
      const res = await ghlFill(id)
      if (res?.ok && res.audit) { applyAudit(id, res.audit); onDealChanged?.() }
      else toast.error(res?.error || 'Could not fill GHL')
      mark(id, false)
      return
    }
    mark(id, true)
    let res
    if (fix.type === 'use_calendar_date') {
      res = await updateDeal(id, { install_date: fix.calDate, pay_date: payDateFromInstall(fix.calDate) })
    } else if (fix.type === 'use_calendar_people') {
      const split = fix.setterId && fix.setterId === fix.closerId ? 1 : 0.5
      res = await updateDeal(id, { setter_id: fix.setterId, closer_id: fix.closerId, setter_split_pct: split })
    }
    if (res?.error) { toast.error(res.error.message || 'Update failed'); mark(id, false); return }
    const a = await auditDeal(id)
    if (a?.ok && a.audit) applyAudit(id, a.audit)
    onDealChanged?.()
    mark(id, false)
  }

  return { byId, state, err, busy, cachedAt, rerunAll: () => run(true), rerun, toggleManual, applyFix }
}
