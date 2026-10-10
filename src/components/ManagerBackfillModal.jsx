import { useState, useEffect } from 'react'
import { X, Loader2 } from 'lucide-react'
import { fetchNullManagerDeals, updateDeal } from '../lib/db'
import { dealAmounts, fmt } from '../utils/commission'

// Shown after a manager-less rep is assigned to a manager. Lists that rep's
// PAST deals with no manager, and the manager override each WOULD create if the
// new manager were attached. The admin ticks which to backfill — nothing is
// written unless ticked. Every backfill goes through updateDeal (logged by the
// deal_history trigger).
export default function ManagerBackfillModal({ rep, manager, onClose }) {
  const [deals, setDeals]   = useState(null)   // null = loading
  const [picked, setPicked] = useState({})     // deal_id -> bool
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    fetchNullManagerDeals(rep.id).then(({ data }) => { if (alive) setDeals(data || []) })
    return () => { alive = false }
  }, [rep.id])

  // Projected manager override if THIS manager is attached.
  const projected = (d) => dealAmounts({ ...d, manager_id: manager.id }).manager
  const chosen = (deals || []).filter(d => picked[d.id])
  const chosenTotal = chosen.reduce((s, d) => s + projected(d), 0)

  async function run() {
    if (!chosen.length) return
    setSaving(true)
    let okCount = 0
    for (const d of chosen) {
      const res = await updateDeal(d.id, { manager_id: manager.id })
      if (!res?.error) okCount++
    }
    setSaving(false)
    onClose(okCount)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-lg rounded-xl overflow-hidden flex flex-col" style={{ background: '#1e1e1e', border: '1px solid #2e2e2e', maxHeight: '85vh' }}>
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#2e2e2e' }}>
          <div>
            <h3 className="text-[14px] font-bold text-white">Backfill manager on past deals</h3>
            <p className="text-[11px] text-white/45 mt-0.5">
              {rep.name} → {manager.name}. Tick the deals that should get {manager.name} as manager. Nothing changes unless ticked.
            </p>
          </div>
          <button onClick={() => onClose(0)} className="p-1 text-white/40 hover:text-white"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto px-4 py-2 flex-1">
          {deals === null ? (
            <div className="flex items-center gap-2 text-[12px] text-white/40 py-6"><Loader2 size={14} className="animate-spin" /> Loading…</div>
          ) : deals.length === 0 ? (
            <p className="text-[12px] text-white/50 py-6">No past deals without a manager — nothing to backfill.</p>
          ) : (
            <ul className="divide-y" style={{ borderColor: '#2a2a2a' }}>
              {deals.map(d => {
                const amt = projected(d)
                return (
                  <li key={d.id} className="flex items-center gap-3 py-2">
                    <input type="checkbox" checked={!!picked[d.id]}
                      onChange={e => setPicked(p => ({ ...p, [d.id]: e.target.checked }))}
                      className="accent-teal w-4 h-4 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] text-white/85 truncate">{d.deal_name}</p>
                      <p className="text-[10px] text-white/35">{d.sale_date || '—'}</p>
                    </div>
                    <span className={`text-[12px] font-semibold tabular-nums ${amt > 0 ? 'text-teal' : 'text-white/30'}`}>
                      {amt > 0 ? '+' + fmt(amt) : '$0'}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t" style={{ borderColor: '#2e2e2e' }}>
          <span className="text-[11px] text-white/45">
            {chosen.length} selected · <span className="text-teal font-semibold">{fmt(chosenTotal)}</span> in overrides
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => onClose(0)} className="px-3 py-1.5 rounded-lg text-[12px] text-white/60 hover:text-white">Skip</button>
            <button onClick={run} disabled={!chosen.length || saving}
              className="px-3 py-1.5 rounded-lg text-[12px] font-bold text-dark bg-teal disabled:opacity-40">
              {saving ? 'Saving…' : `Backfill ${chosen.length || ''}`.trim()}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
