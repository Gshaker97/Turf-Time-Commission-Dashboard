import { useState, useEffect, useMemo, useCallback } from 'react'
import { Navigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { AlertTriangle, ShieldCheck, History, X, Check, MapPin } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { fetchDeals, fetchAuditOverrides, insertAuditOverrides, updateDeal } from '../lib/db'
import { dealsRequiringAudit, fmt, isTucson } from '../utils/commission'
import { SURFACE, Card, Eyebrow, FieldLabel, TextArea, PrimaryButton, SecondaryButton, IconButton, LoadingBlock, EmptyBlock } from '../components/ui'

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
// Differences and the sheet's wrong value read in rose; the calculated value in ivory.
const NEG = 'var(--neg)', WARN = 'var(--warn)', POS = 'var(--pos)'
const tag = (color) => ({ color, background: 'transparent', border: `1px solid ${color}66` })

export default function RequiresAudit() {
  const { profile, isAdmin } = useAuth()
  const { dataStartDate } = useSettings()
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

  const flagged = useMemo(() => dealsRequiringAudit(deals, dataStartDate), [deals, dataStartDate])
  const dealName = useMemo(() => {
    const m = {}
    for (const d of deals) m[d.id] = d.deal_name
    return m
  }, [deals])

  // Access guard — non-Keaton/non-admin users get bounced even via direct URL.
  if (!allowed) return <Navigate to="/dashboard" replace />

  if (loading) return <LoadingBlock text="Loading audit…" />

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-8" style={{ color: 'var(--tx)' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(210,160,116,0.12)', border: '1px solid rgba(210,160,116,0.4)' }}>
          <ShieldCheck size={20} style={{ color: WARN }} />
        </div>
        <div>
          <h1 className="text-lg md:text-xl font-bold text-bank-tx">Requires Audit</h1>
          <p className="text-[13px] text-bank-mu">
            Deals where the stored sheet amounts disagree with the commission rules (by more than $1).
          </p>
        </div>
      </div>

      {/* ── Flagged deals ── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={15} style={{ color: WARN }} />
          <Eyebrow>Needs review</Eyebrow>
          <span className="text-[13px] font-semibold px-1.5 py-0.5 rounded tabular-nums" style={tag(flagged.length ? WARN : POS)}>
            {flagged.length}
          </span>
        </div>

        {flagged.length === 0 ? (
          <Card padded={false}>
            <EmptyBlock>
              <Check size={22} className="mx-auto mb-2" style={{ color: POS }} />
              Everything reconciles. No deals need review.
            </EmptyBlock>
          </Card>
        ) : (
          <div className="space-y-3">
            {flagged.map(({ deal, mismatches }) => (
              <Card key={deal.id}>
                <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-bank-tx flex items-center gap-2 flex-wrap">
                      {deal.deal_name}
                      {isTucson(deal) && (
                        <span className="inline-flex items-center gap-1 text-[12px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                          style={tag('var(--mu)')}>
                          <MapPin size={10} /> Tucson
                        </span>
                      )}
                    </p>
                    <p className="text-[13px] text-bank-mu mt-0.5">
                      {deal.project_id ? `${deal.project_id} · ` : ''}Sale {fmtDate(deal.sale_date)} · Baseline {fmt(deal.baseline_revenue)}
                    </p>
                  </div>
                  <PrimaryButton onClick={() => setActive({ deal, mismatches })} className="px-3 py-2 min-h-[44px] md:min-h-0 flex-shrink-0">
                    Override &amp; Correct
                  </PrimaryButton>
                </div>

                <MismatchTable mismatches={mismatches} />
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ── History log ── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <History size={15} className="text-bank-mu" />
          <Eyebrow>Correction history</Eyebrow>
          <span className="text-[13px] font-semibold px-1.5 py-0.5 rounded text-bank-mu tabular-nums" style={SURFACE.raise}>
            {overrides.length}
          </span>
        </div>

        {overrides.length === 0 ? (
          <p className="text-[13px] text-bank-mu px-1">No corrections logged yet.</p>
        ) : (
          <Card padded={false}>
            {/* Desktop table */}
            <table className="w-full text-[13px] hidden md:table">
              <thead>
                <tr className="text-bank-fa text-left border-b border-bank-line">
                  {['Deal', 'Field', 'Sheet → Corrected', 'Note', 'Corrected by', 'When'].map(h => (
                    <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap uppercase tracking-wide text-[13px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {overrides.map(o => (
                  <tr key={o.id} className="hover:bg-bank-raise transition-colors align-top border-b border-bank-line last:border-0">
                    <td className="px-3 py-2.5 text-bank-tx whitespace-nowrap">{dealName[o.deal_id] ?? '—'}</td>
                    <td className="px-3 py-2.5 text-bank-mu whitespace-nowrap">{FIELD_LABELS[o.field_name] ?? o.field_name}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                      <span className="line-through" style={{ color: NEG }}>{fmt(o.original_value)}</span>
                      <span className="text-bank-fa"> → </span>
                      <span className="text-bank-tx font-semibold">{fmt(o.corrected_value)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-bank-mu max-w-[220px]">{o.correction_note || '—'}</td>
                    <td className="px-3 py-2.5 text-bank-tx whitespace-nowrap">{o.corrected_by_profile?.name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-bank-mu whitespace-nowrap">{fmtStamp(o.corrected_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Phones: one card per correction */}
            <div className="md:hidden">
              {overrides.map(o => (
                <div key={o.id} className="px-4 py-3 border-b border-bank-line last:border-0 text-[13px]">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-bank-tx truncate">{dealName[o.deal_id] ?? '—'}</span>
                    <span className="text-bank-mu flex-shrink-0">{FIELD_LABELS[o.field_name] ?? o.field_name}</span>
                  </div>
                  <p className="mt-1 tabular-nums">
                    <span className="line-through" style={{ color: NEG }}>{fmt(o.original_value)}</span>
                    <span className="text-bank-fa"> → </span>
                    <span className="text-bank-tx font-semibold">{fmt(o.corrected_value)}</span>
                  </p>
                  {o.correction_note && <p className="text-bank-mu mt-1">{o.correction_note}</p>}
                  <p className="text-bank-fa mt-1">{o.corrected_by_profile?.name ?? '—'} · {fmtStamp(o.corrected_at)}</p>
                </div>
              ))}
            </div>
          </Card>
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
  const diffColor = (m) => (m.diff > 0 ? NEG : WARN)
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--line)' }}>
      {/* Desktop */}
      <table className="w-full text-[13px] hidden md:table">
        <thead>
          <tr className="text-bank-fa text-left" style={{ background: 'var(--raise)' }}>
            <th className="px-3 py-1.5 font-semibold uppercase tracking-wide">Field</th>
            <th className="px-3 py-1.5 font-semibold uppercase tracking-wide text-right">Sheet value</th>
            <th className="px-3 py-1.5 font-semibold uppercase tracking-wide text-right">Calculated</th>
            <th className="px-3 py-1.5 font-semibold uppercase tracking-wide text-right">Difference</th>
          </tr>
        </thead>
        <tbody>
          {mismatches.map(m => (
            <tr key={m.field} className="border-t border-bank-line">
              <td className="px-3 py-1.5 text-bank-tx">
                {m.label}
                {m.kind === 'tucson-rate' && (
                  <span className="ml-2 text-[12px] font-semibold px-1.5 py-0.5 rounded" style={tag(WARN)}>billed at 5%, should be 3.75%</span>
                )}
              </td>
              <td className="px-3 py-1.5 text-right text-bank-mu tabular-nums">{fmt(m.stored)}</td>
              <td className="px-3 py-1.5 text-right text-bank-tx tabular-nums">{fmt(m.calculated)}</td>
              <td className="px-3 py-1.5 text-right font-semibold tabular-nums" style={{ color: diffColor(m) }}>
                {m.diff > 0 ? '+' : ''}{fmt(m.diff)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Phones */}
      <div className="md:hidden text-[13px]">
        {mismatches.map(m => (
          <div key={m.field} className="px-3 py-2.5 border-t border-bank-line first:border-0">
            <p className="text-bank-tx font-semibold">
              {m.label}
              {m.kind === 'tucson-rate' && (
                <span className="ml-2 text-[12px] font-semibold px-1.5 py-0.5 rounded" style={tag(WARN)}>billed at 5%, should be 3.75%</span>
              )}
            </p>
            <div className="grid grid-cols-3 gap-2 mt-1.5 tabular-nums">
              <div><p className="text-bank-fa text-[12px] uppercase">Sheet value</p><p className="text-bank-mu">{fmt(m.stored)}</p></div>
              <div><p className="text-bank-fa text-[12px] uppercase">Calculated</p><p className="text-bank-tx">{fmt(m.calculated)}</p></div>
              <div><p className="text-bank-fa text-[12px] uppercase">Difference</p><p className="font-semibold" style={{ color: diffColor(m) }}>{m.diff > 0 ? '+' : ''}{fmt(m.diff)}</p></div>
            </div>
          </div>
        ))}
      </div>
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
    <div className="fixed inset-0 z-[60] flex items-end md:items-center md:justify-center md:p-4"
      onMouseDown={onClose}>
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(3px)' }} />
      <div className="relative w-full md:max-w-lg h-[100dvh] md:h-auto md:max-h-[88dvh] rounded-none md:rounded-2xl overflow-y-auto flex flex-col"
        style={{ ...SURFACE.card, boxShadow: 'var(--card-shadow), 0 24px 60px rgba(0,0,0,0.55)', color: 'var(--tx)' }}
        role="dialog" aria-modal="true" aria-label="Override and correct"
        onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-3 sticky top-0 z-10" style={{ background: 'var(--card)', borderBottom: '1px solid var(--line)' }}>
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold text-bank-tx">Override &amp; Correct</h3>
            <p className="text-[13px] text-bank-mu">{deal.deal_name}</p>
          </div>
          <IconButton onClick={onClose} aria-label="Close"><X size={16} /></IconButton>
        </div>

        <div className="p-5 flex-1 flex flex-col gap-4">
          <div className="space-y-2.5">
            {mismatches.map(m => (
              <div key={m.field} className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
                <div className="sm:w-20 flex-shrink-0 flex sm:block items-baseline gap-2">
                  <p className="text-[13px] font-semibold text-bank-tx">{m.label}</p>
                  <p className="text-[13px] text-bank-fa tabular-nums">sheet {fmt(m.stored)}</p>
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <span className="text-[13px] text-bank-fa">$</span>
                  <input
                    type="number" step="0.01" value={values[m.field]} aria-label={`${m.label} corrected amount`}
                    onChange={e => set(m.field, e.target.value)}
                    className="flex-1 min-w-0 px-2.5 min-h-[44px] md:min-h-0 md:h-9 rounded-lg text-[13px] text-bank-tx focus:outline-none tabular-nums"
                    style={SURFACE.well} />
                  <span className="text-[13px] text-bank-fa whitespace-nowrap tabular-nums">calc {fmt(m.calculated)}</span>
                </div>
              </div>
            ))}
          </div>

          <div>
            <FieldLabel htmlFor="correction-note">
              Correction note <span style={{ color: WARN }}>(required)</span>
            </FieldLabel>
            <TextArea id="correction-note"
              value={note} onChange={e => setNote(e.target.value)} rows={3}
              placeholder="Why is this being corrected? (e.g. sheet applied 5% to a Tucson deal)"
              style={SURFACE.well} className="resize-none" />
          </div>

          {error && <p className="text-[13px]" role="alert" style={{ color: NEG }}>{error}</p>}

          <div className="sticky bottom-0 -mx-5 md:mx-0 px-5 md:px-0 pt-3 mt-auto flex gap-3 md:static"
            style={{ background: 'var(--card)', borderTop: '1px solid var(--line)', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
            <PrimaryButton onClick={save} disabled={saving} className="flex-1">
              {saving ? 'Saving…' : 'Save correction'}
            </PrimaryButton>
            <SecondaryButton onClick={onClose} className="px-5 min-h-[44px]">Cancel</SecondaryButton>
          </div>
        </div>
      </div>
    </div>
  )
}
