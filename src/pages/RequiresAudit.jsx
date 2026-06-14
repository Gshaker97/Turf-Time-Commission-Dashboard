import { useState, useEffect, useMemo, useCallback } from 'react'
import { Navigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { AlertTriangle, ShieldCheck, History, X, Check, MapPin } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchDeals, fetchAuditOverrides, insertAuditOverrides, updateDeal } from '../lib/db'
import { dealsRequiringAudit, fmt, isTucson } from '../utils/commission'

// Keaton (by identity) or anyone with the admin flag/title may see this panel.
const isKeaton = (p) =>
  p?.email?.toLowerCase() === 'keaton@turftime.com' || p?.name === 'Keaton Shaker'

const FIELD_LABELS = {
  setter_amount: 'Setter', closer_amount: 'Closer', manager_amount: 'Manager',
  director_amount: 'Director', vp_amount: 'VP',
}

const fmtDate = (d) => {
  if (!d) return '—'
  try { return format(parseISO(String(d)), 'MMM d, yyyy') } catch { return String(d) }
}
const fmtStamp = (d) => {
  if (!d) return '—'
  try { return format(parseISO(String(d)), 'MMM d, yyyy · h:mmaaa') } catch { return String(d) }
}

export default function RequiresAudit() {
  const { profile, isAdmin } = useAuth()
  const allowed = isAdmin || isKeaton(profile)

  const [deals,     setDeals]     = useState([])
  const [overrides, setOverrides] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [active,    setActive]    = useState(null)   // audit result being corrected

  const load = useCallback(async () => {
    const [d, o] = await Promise.all([fetchDeals(), fetchAuditOverrides()])
    setDeals(d.data || [])
    setOverrides(o.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { if (allowed) load() }, [allowed, load])

  const flagged = useMemo(() => dealsRequiringAudit(deals), [deals])
  const dealName = useMemo(() => {
    const m = {}
    for (const d of deals) m[d.id] = d.deal_name
    return m
  }, [deals])

  // Access guard — non-Keaton/non-admin users get bounced even via direct URL.
  if (!allowed) return <Navigate to="/dashboard" replace />

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-white/30 text-[13px]">Loading…</div>
  )

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: '#f59e0b22', border: '1px solid #f59e0b40' }}>
          <ShieldCheck size={20} className="text-amber-400" />
        </div>
        <div>
          <h1 className="text-[18px] font-bold text-white">Requires Audit</h1>
          <p className="text-[12px] text-white/40">
            Deals where the stored sheet amounts disagree with the commission rules (by more than $1).
          </p>
        </div>
      </div>

      {/* ── Flagged deals ── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={15} className="text-amber-400" />
          <h2 className="text-[13px] font-bold uppercase tracking-widest text-white/60">
            Needs review
          </h2>
          <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
            style={{ background: flagged.length ? '#f59e0b22' : '#22c55e22', color: flagged.length ? '#f59e0b' : '#4ade80' }}>
            {flagged.length}
          </span>
        </div>

        {flagged.length === 0 ? (
          <div className="rounded-xl px-5 py-8 text-center" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
            <Check size={22} className="text-emerald-400 mx-auto mb-2" />
            <p className="text-[13px] text-white/60">Everything reconciles. No deals need review.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {flagged.map(({ deal, mismatches }) => (
              <div key={deal.id} className="rounded-xl p-4" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="text-[14px] font-semibold text-white flex items-center gap-2">
                      {deal.deal_name}
                      {isTucson(deal) && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                          style={{ background: '#60a5fa22', color: '#60a5fa' }}>
                          <MapPin size={10} /> Tucson
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-white/40 mt-0.5">
                      {deal.project_id ? `${deal.project_id} · ` : ''}Sale {fmtDate(deal.sale_date)} · Baseline {fmt(deal.baseline_revenue)}
                    </p>
                  </div>
                  <button onClick={() => setActive({ deal, mismatches })}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-bold text-dark bg-teal hover:bg-teal-dark transition-colors flex-shrink-0">
                    Override &amp; Correct
                  </button>
                </div>

                <MismatchTable mismatches={mismatches} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── History log ── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <History size={15} className="text-white/40" />
          <h2 className="text-[13px] font-bold uppercase tracking-widest text-white/60">Correction history</h2>
          <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded text-white/50" style={{ background: '#2a2a2a' }}>
            {overrides.length}
          </span>
        </div>

        {overrides.length === 0 ? (
          <p className="text-[12px] text-white/30 px-1">No corrections logged yet.</p>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-white/35 text-left" style={{ borderBottom: '1px solid #2a2a2a' }}>
                  {['Deal', 'Field', 'Sheet → Corrected', 'Note', 'Corrected by', 'When'].map(h => (
                    <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {overrides.map(o => (
                  <tr key={o.id} className="hover:bg-white/[0.02] transition-colors align-top"
                    style={{ borderBottom: '1px solid #242424' }}>
                    <td className="px-3 py-2.5 text-white/80 whitespace-nowrap">{dealName[o.deal_id] ?? '—'}</td>
                    <td className="px-3 py-2.5 text-white/60 whitespace-nowrap">{FIELD_LABELS[o.field_name] ?? o.field_name}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="text-red-400/80 line-through">{fmt(o.original_value)}</span>
                      <span className="text-white/30"> → </span>
                      <span className="text-emerald-400 font-semibold">{fmt(o.corrected_value)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-white/50 max-w-[220px]">{o.correction_note || '—'}</td>
                    <td className="px-3 py-2.5 text-white/70 whitespace-nowrap">{o.corrected_by_profile?.name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-white/40 whitespace-nowrap">{fmtStamp(o.corrected_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {active && (
        <CorrectionModal
          audit={active}
          correctorId={profile?.id}
          onClose={() => setActive(null)}
          onSaved={async () => { setActive(null); setLoading(true); await load() }}
        />
      )}
    </div>
  )
}

function MismatchTable({ mismatches }) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #2a2a2a' }}>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-white/35 text-left" style={{ background: '#181818' }}>
            <th className="px-3 py-1.5 font-semibold">Field</th>
            <th className="px-3 py-1.5 font-semibold text-right">Sheet value</th>
            <th className="px-3 py-1.5 font-semibold text-right">Calculated</th>
            <th className="px-3 py-1.5 font-semibold text-right">Difference</th>
          </tr>
        </thead>
        <tbody>
          {mismatches.map(m => (
            <tr key={m.field} style={{ borderTop: '1px solid #242424' }}>
              <td className="px-3 py-1.5 text-white/80">
                {m.label}
                {m.kind === 'tucson-rate' && (
                  <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                    style={{ background: '#60a5fa22', color: '#60a5fa' }}>billed at 5%, should be 3.75%</span>
                )}
              </td>
              <td className="px-3 py-1.5 text-right text-white/70">{fmt(m.stored)}</td>
              <td className="px-3 py-1.5 text-right text-emerald-400">{fmt(m.calculated)}</td>
              <td className="px-3 py-1.5 text-right font-semibold"
                style={{ color: m.diff > 0 ? '#f87171' : '#fbbf24' }}>
                {m.diff > 0 ? '+' : ''}{fmt(m.diff)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CorrectionModal({ audit, correctorId, onClose, onSaved }) {
  const { deal, mismatches } = audit
  // Prefill each correctable field with the calculated value (rounded to cents).
  const [values, setValues] = useState(() =>
    Object.fromEntries(mismatches.map(m => [m.field, String(Number(m.calculated.toFixed(2)))]))
  )
  const [note, setNote]     = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  const set = (field, v) => setValues(s => ({ ...s, [field]: v }))

  async function save() {
    if (!note.trim()) return setError('Add a note explaining the correction.')
    setSaving(true); setError(null)

    // Build the deal patch + one audit row per field that actually changed.
    const patch = {}
    const rows = []
    for (const m of mismatches) {
      const raw = values[m.field]
      const corrected = Number(raw)
      if (raw === '' || Number.isNaN(corrected)) { setSaving(false); return setError(`Enter a valid number for ${m.label}.`) }
      patch[m.field] = corrected
      rows.push({
        deal_id: deal.id,
        field_name: m.field,
        original_value: m.stored,
        corrected_value: corrected,
        correction_note: note.trim(),
        corrected_by: correctorId ?? null,
      })
    }

    const { error: upErr } = await updateDeal(deal.id, patch)
    if (upErr) { setSaving(false); return setError(upErr.message || 'Could not save the corrected amounts.') }
    const { error: logErr } = await insertAuditOverrides(rows)
    if (logErr) { setSaving(false); return setError(logErr.message || 'Amounts saved, but logging the override failed.') }

    setSaving(false)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}
      onMouseDown={onClose}>
      <div className="w-full max-w-lg rounded-2xl p-5" style={{ background: '#1e1e1e', border: '1px solid #333' }}
        onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-[15px] font-bold text-white">Override &amp; Correct</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-white/30 hover:text-white hover:bg-white/10 transition-colors">
            <X size={16} />
          </button>
        </div>
        <p className="text-[12px] text-white/40 mb-4">{deal.deal_name}</p>

        <div className="space-y-2.5 mb-4">
          {mismatches.map(m => (
            <div key={m.field} className="flex items-center gap-3">
              <div className="w-20 flex-shrink-0">
                <p className="text-[12px] font-semibold text-white/80">{m.label}</p>
                <p className="text-[10px] text-white/30">sheet {fmt(m.stored)}</p>
              </div>
              <div className="flex-1 flex items-center gap-2">
                <span className="text-[12px] text-white/30">$</span>
                <input
                  type="number" step="0.01" value={values[m.field]}
                  onChange={e => set(m.field, e.target.value)}
                  className="flex-1 px-2.5 py-1.5 rounded-lg text-[13px] text-white focus:outline-none focus:border-teal/40 transition-colors"
                  style={{ background: '#161616', border: '1px solid #333' }} />
                <span className="text-[11px] text-white/30 whitespace-nowrap">calc {fmt(m.calculated)}</span>
              </div>
            </div>
          ))}
        </div>

        <label className="block text-[11px] font-semibold uppercase tracking-wider text-white/40 mb-1.5">
          Correction note <span className="text-amber-400/70">(required)</span>
        </label>
        <textarea
          value={note} onChange={e => setNote(e.target.value)} rows={3}
          placeholder="Why is this being corrected? (e.g. sheet applied 5% to a Tucson deal)"
          className="w-full px-3 py-2 rounded-lg text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-teal/40 transition-colors resize-none"
          style={{ background: '#161616', border: '1px solid #333' }} />

        {error && <p className="text-[12px] text-red-400 mt-2">{error}</p>}

        <div className="flex gap-2 mt-4">
          <button onClick={save} disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-dark bg-teal hover:bg-teal-dark disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : 'Save correction'}
          </button>
          <button onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-[13px] text-white/50 hover:text-white transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
