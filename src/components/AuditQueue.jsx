import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Check, Circle, AlertTriangle, CalendarClock, Users, Lock } from 'lucide-react'
import { auditQueue, auditDeal, setChecklistItem, updateDeal, fetchDealChecklists } from '../lib/db'
import { AUDIT_ITEMS } from '../utils/dealAudit7'
import { payDateFromInstall } from '../utils/dateRanges'
import { toast } from '../lib/toast'

// The 7-item audit checklist for the Deals "Needs review" queue. Auditors
// (admin/Keaton) get the live audit with auto-checks + fix buttons; everyone
// else on the review tab sees the last stored result, read-only.
export default function AuditQueue({ deals = [], canAudit = false, onDealChanged }) {
  const navigate = useNavigate()
  const [byId, setById]   = useState({})     // deal_id -> audit result (or stored rows)
  const [state, setState] = useState('idle') // idle|loading|error|ready|disabled
  const [err, setErr]     = useState(null)
  const [busy, setBusy]   = useState({})
  const dealById = Object.fromEntries(deals.map(d => [d.id, d]))

  const run = useCallback(async () => {
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
  }, [canAudit, deals.map(d => d.id).join(',')])

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

  if (state === 'disabled')
    return <Note>The deal audit runs on the live site (it’s disabled in demo mode).</Note>
  if (state === 'loading' || state === 'idle')
    return <div className="flex items-center gap-2 text-[12px] text-white/40 py-6"><RefreshCw size={14} className="animate-spin" /> Running audit…</div>
  if (state === 'error')
    return <Note tone="err">Audit failed: {err} <button onClick={run} className="underline ml-1">retry</button></Note>

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-white/80">Audit checklist</h3>
        {canAudit && (
          <button onClick={run} disabled={Object.values(busy).some(Boolean)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white/60 hover:text-white disabled:opacity-40"
            style={{ background: '#1e1e1e', border: '1px solid #2e2e2e' }}>
            <RefreshCw size={12} /> Re-run all
          </button>
        )}
      </div>
      {deals.map(d => {
        const a = byId[d.id]
        return (
          <div key={d.id} className="rounded-xl p-3 md:p-4" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[13px] font-semibold text-white/90 truncate">{d.deal_name}</span>
                {a && <Badge done={a.done} total={a.total} reviewed={a.reviewed} />}
              </div>
              {canAudit && (
                <button onClick={() => rerun(d.id)} disabled={busy[d.id]}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-white/50 hover:text-white disabled:opacity-40"
                  style={{ background: '#1e1e1e', border: '1px solid #2e2e2e' }}>
                  <RefreshCw size={11} className={busy[d.id] ? 'animate-spin' : ''} /> Re-run
                </button>
              )}
            </div>
            {!a ? (
              <p className="text-[11px] text-white/30">Not audited yet.{canAudit && <button onClick={() => rerun(d.id)} className="underline ml-1">run</button>}</p>
            ) : (
              <ul className="space-y-1.5">
                {a.items.map(it => (
                  <ChecklistRow key={it.key} item={it} canAudit={canAudit} busy={busy[d.id]}
                    onToggle={(v) => toggleManual(d.id, it.key, v)}
                    onFix={() => applyFix(d.id, it.fix)} />
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ChecklistRow({ item, canAudit, busy, onToggle, onFix }) {
  const done = item.checked
  const manualToggleable = item.manual && canAudit
  const fixIcon = item.fix?.type === 'use_calendar_date' ? CalendarClock
    : item.fix?.type === 'use_calendar_people' ? Users
    : item.fix?.type === 'assign_team' ? Users : null
  const fixLabel = item.fix?.type === 'use_calendar_date' ? 'Use calendar date'
    : item.fix?.type === 'use_calendar_people' ? 'Use calendar setter/closer'
    : item.fix?.type === 'assign_team' ? 'Assign team' : null
  return (
    <li className="flex items-start gap-2 text-[12px]">
      {manualToggleable ? (
        <button onClick={() => onToggle(!done)} disabled={busy} className="mt-0.5 flex-shrink-0 disabled:opacity-40" title={done ? 'Uncheck' : 'Check'}>
          {done ? <Check size={15} className="text-teal" /> : <Circle size={15} className="text-white/30" />}
        </button>
      ) : (
        <span className="mt-0.5 flex-shrink-0">
          {done ? <Check size={15} className="text-teal" />
            : item.manual ? <Lock size={13} className="text-white/25" title="Manual" />
            : <AlertTriangle size={14} className="text-amber-400" />}
        </span>
      )}
      <div className="min-w-0">
        <span className={done ? 'text-white/70' : 'text-white/90'}>
          {item.label}{item.manual && <span className="text-white/25 text-[10px] ml-1">(manual)</span>}
        </span>
        {!done && item.reason && <span className="block text-[11px] text-white/40">{item.reason}</span>}
        {!done && item.fix && canAudit && fixLabel && (
          <button onClick={onFix} disabled={busy}
            className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold text-dark bg-teal disabled:opacity-40">
            {fixIcon && (() => { const I = fixIcon; return <I size={11} /> })()} {fixLabel}
          </button>
        )}
      </div>
    </li>
  )
}

function Badge({ done, total, reviewed }) {
  const full = done >= total
  return (
    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0"
      style={{ background: full ? '#00b89420' : '#f59e0b20', color: full ? '#34d399' : '#f59e0b' }}>
      {done}/{total}{reviewed ? ' · Reviewed' : ''}
    </span>
  )
}

function Note({ children, tone }) {
  return (
    <p className="mt-4 text-[12px] rounded-lg px-3 py-2"
      style={tone === 'err'
        ? { background: '#3a1f1f', border: '1px solid #5a2a2a', color: '#f8b4b4' }
        : { background: '#1e1e1e', border: '1px solid #2e2e2e', color: 'rgba(255,255,255,0.5)' }}>
      {children}
    </p>
  )
}
