import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { auditQueue, auditDeal, setChecklistItem, updateDeal, fetchDealChecklists, ghlFill } from '../lib/db'
import { AUDIT_ITEMS } from '../utils/dealAudit7'
import { payDateFromInstall } from '../utils/dateRanges'
import { toast } from '../lib/toast'

// The shared engine for the inline 7-item deal-audit checklist on Deals →
// Needs review. Lifted verbatim out of the old <AuditQueue> panel so each deal
// row can render its own strip while the data is still fetched ONCE for the
// whole page. Auditors (admin/Keaton) get the live audit with auto-checks +
// fix buttons; everyone else on the review tab sees the last stored result,
// read-only. The audit logic, endpoints and permissions are unchanged — only
// where the result is rendered moved.
export function useAudit({ deals = [], canAudit = false, enabled = true, onDealChanged }) {
  const navigate = useNavigate()
  const [byId, setById]   = useState({})     // deal_id -> audit result (or stored rows)
  const [state, setState] = useState('idle') // idle|loading|error|ready|disabled
  const [err, setErr]     = useState(null)
  const [busy, setBusy]   = useState({})
  const dealById = Object.fromEntries(deals.map(d => [d.id, d]))
  const ids = deals.map(d => d.id).join(',')

  const run = useCallback(async () => {
    if (!enabled) { setState('idle'); return }
    setState('loading'); setErr(null)
    if (canAudit) {
      const res = await auditQueue()
      if (res?.ok === false) {
        if (/demo/i.test(res.error || '')) { setState('disabled'); return }
        setState('error'); setErr(res.error || 'Audit failed'); return
      }
      const map = {}
      for (const a of res.audits || []) map[a.deal_id] = a
      setById(map); setState('ready')
    } else {
      // Read-only: show the last stored checklist for the shown deals.
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
    // The id-string dep makes the audit rerun only when the shown set of deals
    // changes, as the old panel did. (Deliberately not depending on `deals`/
    // `onDealChanged` objects, which change identity every render.)
  }, [enabled, canAudit, ids])

  useEffect(() => { run() }, [run])

  const mark = (id, v) => setBusy(b => ({ ...b, [id]: v }))

  async function rerun(id) {
    mark(id, true)
    const res = await auditDeal(id)
    if (res?.ok && res.audit) setById(m => ({ ...m, [id]: res.audit }))
    else if (res?.ok === false) toast.error(res.error || 'Audit failed')
    mark(id, false)
  }

  async function toggleManual(id, key, checked) {
    mark(id, true)
    const res = await setChecklistItem(id, key, checked)
    if (res?.ok && res.audit) { setById(m => ({ ...m, [id]: res.audit })); onDealChanged?.() }
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
      if (res?.ok && res.audit) { setById(m => ({ ...m, [id]: res.audit })); onDealChanged?.() }
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
    if (a?.ok && a.audit) setById(m => ({ ...m, [id]: a.audit }))
    onDealChanged?.()
    mark(id, false)
  }

  return { byId, state, err, busy, rerunAll: run, rerun, toggleManual, applyFix }
}
