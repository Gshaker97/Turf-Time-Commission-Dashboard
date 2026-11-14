import { useState, useEffect } from 'react'
import { X, Loader2 } from 'lucide-react'
import { fetchNullManagerDeals, updateDeal } from '../lib/db'
import { dealAmounts, fmt } from '../utils/commission'
import { SURFACE, PrimaryButton, SecondaryButton, IconButton } from '../components/ui'

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
    <div className="fixed inset-0 z-[60] flex items-end md:items-center md:justify-center md:p-4">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(3px)' }} />
      <div className="relative w-full md:max-w-lg h-[100dvh] md:h-auto md:max-h-[85vh] rounded-none md:rounded-2xl overflow-hidden flex flex-col"
        style={{ ...SURFACE.card, boxShadow: 'var(--card-shadow), 0 24px 60px rgba(0,0,0,0.55)', color: 'var(--tx)' }}
        role="dialog" aria-modal="true" aria-label="Backfill manager on past deals">
        <div className="flex items-start justify-between gap-3 px-5 py-3 border-b border-bank-line">
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold text-bank-tx">Backfill manager on past deals</h3>
            <p className="text-[13px] text-bank-mu mt-0.5">
              {rep.name} → {manager.name}. Tick the deals that should get {manager.name} as manager. Nothing changes unless ticked.
            </p>
          </div>
          <IconButton onClick={() => onClose(0)} aria-label="Close"><X size={16} /></IconButton>
        </div>

        <div className="overflow-y-auto px-5 py-2 flex-1">
          {deals === null ? (
            <div className="flex items-center gap-2 text-[13px] text-bank-mu py-6" role="status"><Loader2 size={14} className="animate-spin" /> Loading…</div>
          ) : deals.length === 0 ? (
            <p className="text-[13px] text-bank-mu py-6">No past deals without a manager — nothing to backfill.</p>
          ) : (
            <ul>
              {deals.map(d => {
                const amt = projected(d)
                return (
                  <li key={d.id} className="border-t border-bank-line first:border-0">
                    <label className="flex items-center gap-3 py-2 min-h-[44px] cursor-pointer">
                      <input type="checkbox" checked={!!picked[d.id]}
                        onChange={e => setPicked(p => ({ ...p, [d.id]: e.target.checked }))}
                        className="accent-[#bfa46c] w-4 h-4 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-bank-tx truncate">{d.deal_name}</p>
                        <p className="text-[13px] text-bank-fa">{d.sale_date || '—'}</p>
                      </div>
                      <span className={`text-[13px] font-semibold tabular-nums ${amt > 0 ? 'text-bank-tx' : 'text-bank-fa'}`}>
                        {amt > 0 ? '+' + fmt(amt) : '$0'}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-bank-line flex-wrap"
          style={{ background: 'var(--card)', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
          <span className="text-[13px] text-bank-mu">
            {chosen.length} selected · <span className="text-bank-tx font-semibold tabular-nums">{fmt(chosenTotal)}</span> in overrides
          </span>
          <div className="flex items-center gap-2">
            <SecondaryButton onClick={() => onClose(0)}>Skip</SecondaryButton>
            <PrimaryButton onClick={run} disabled={!chosen.length || saving} className="px-4 py-2 min-h-[44px] md:min-h-0">
              {saving ? 'Saving…' : `Backfill ${chosen.length || ''}`.trim()}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  )
}
