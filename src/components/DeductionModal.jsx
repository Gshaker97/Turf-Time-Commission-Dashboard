import { useMemo, useState } from 'react'
import { X, Search } from 'lucide-react'

// ── Log (or edit) a deduction ────────────────────────────────────────────
// Records what is OWED. It never touches deals.deduction_amount — that column
// feeds dealAmounts(), so writing to it on a paid job would rewrite that
// deal's commission on every page and in the backup spreadsheet, and the
// pay-run lock would reject it anyway. The debt REFERENCES its deal instead.
//
// The control that matters is the last one. "Hold until they have pay" is the
// option that did not exist before: it stores a debt with no pay date, which
// then follows the rep from run to run until it is recovered.

const card  = { background: '#1e1e1e', border: '1px solid #333' }
const field = { background: '#171717', border: '1px solid #3a3a3a' }
const fieldCls = 'w-full h-10 px-3 rounded-lg text-[13.5px] text-white placeholder-white/25 focus:outline-none focus:border-teal/60'
const lbl = 'block text-[10px] font-bold uppercase tracking-[0.11em] text-white/45 mb-1.5'

const money = (v) => '$' + Math.abs(Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDay = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', d: undefined, day: 'numeric', year: 'numeric' }) : '')

export default function DeductionModal({ deal: fixedDeal, deals = [], users = [], payDates = [], currentRun, edit, onClose, onSave }) {
  const [q, setQ]           = useState('')
  const [dealId, setDealId] = useState(edit?.deal_id || fixedDeal?.id || '')
  const [amount, setAmount] = useState(edit ? String(Math.abs(Number(edit.amount) || 0)) : '')
  const [note, setNote]     = useState(edit?.note || '')
  const [payeeId, setPayeeId] = useState(edit?.payee_id || '')
  const [when, setWhen]     = useState(edit ? 'hold' : 'hold')   // hold | now | pick
  const [pickDate, setPickDate] = useState(currentRun && currentRun !== 'overdue' ? currentRun : (payDates[0] || ''))
  const [saving, setSaving] = useState(false)

  const dealById = useMemo(() => Object.fromEntries(deals.map(d => [d.id, d])), [deals])
  const deal = dealId ? dealById[dealId] : null

  // Search every deal ever, paid or not — the whole point is reaching back to
  // a job that already went out.
  const matches = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return []
    return deals
      .filter(d => String(d.deal_name || '').toLowerCase().includes(term))
      .sort((a, b) => String(b.sale_date || '').localeCompare(String(a.sale_date || '')))
      .slice(0, 6)
  }, [q, deals])

  // Who the deal already says absorbs a deduction — the same rule the
  // commission engine pays by, so the default matches how the job was priced.
  const people = useMemo(() => {
    if (!deal) return []
    const setter = users.find(u => u.id === deal.setter_id)
    const closer = users.find(u => u.id === deal.closer_id)
    const out = []
    if (setter) out.push({ id: setter.id, name: setter.name, role: 'Setter' })
    if (closer && closer.id !== setter?.id) out.push({ id: closer.id, name: closer.name, role: 'Closer' })
    return out
  }, [deal, users])

  const defaultPayee = useMemo(() => {
    if (!deal) return ''
    const solo = !deal.closer_id || deal.closer_id === deal.setter_id
    if (solo) return deal.setter_id || deal.closer_id || ''
    const paidBy = deal.deduction_paid_by || 'closer'
    return paidBy === 'setter' ? deal.setter_id : deal.closer_id
  }, [deal])

  const effectivePayee = payeeId || defaultPayee
  const amt = Math.abs(parseFloat(amount) || 0)
  const canSave = amt > 0 && !!effectivePayee && !saving

  function pickDeal(d) {
    setDealId(d.id); setQ('')
    setPayeeId('')                                   // re-derive from the new deal
    if (!note.trim()) setNote('')
  }

  async function save() {
    if (!canSave) return
    setSaving(true)
    const ok = await onSave({
      id: edit?.id || null,
      payeeId: effectivePayee,
      dealId: dealId || null,
      amount: -amt,                                  // stored signed, like every adjustment
      note: note.trim() || null,
      payDate: when === 'now' ? (currentRun !== 'overdue' ? currentRun : null)
             : when === 'pick' ? (pickDate || null)
             : null,                                 // hold = the debt, no run
    })
    setSaving(false)
    if (ok) onClose()
  }

  const Radio = ({ id, value, title, sub }) => (
    <label htmlFor={id}
      className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${when === value ? 'bg-teal/10 border border-teal/45' : 'border border-white/10 hover:border-white/20'}`}>
      <input id={id} type="radio" name="ded-when" checked={when === value} onChange={() => setWhen(value)}
        className="mt-0.5 w-[15px] h-[15px] flex-shrink-0 accent-teal" />
      <span className="min-w-0">
        <span className={`block text-[13px] ${when === value ? 'font-bold text-white' : 'font-semibold text-white/80'}`}>{title}</span>
        <span className="block mt-0.5 text-[11.5px] text-white/50">{sub}</span>
      </span>
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 md:p-8" style={{ background: 'rgba(0,0,0,0.65)' }}>
      <div className="w-full max-w-[620px] rounded-2xl overflow-hidden shadow-2xl" style={card}>

        <div className="flex items-start gap-3 px-5 py-4 border-b border-white/10">
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-extrabold text-white">{edit ? 'Edit deduction' : 'Log a deduction'}</h2>
            <p className="text-[11.5px] text-white/50 mt-1">
              Records what is owed. It never changes the deal&rsquo;s own numbers or a run that has already gone out.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/5"><X size={17} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">

          {/* which job */}
          <div>
            <span className={lbl}>Which job?</span>
            {deal ? (
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg" style={{ background: 'rgba(0,184,148,0.09)', border: '1px solid rgba(0,184,148,0.4)' }}>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-white truncate">{deal.deal_name}</p>
                  <p className="text-[11px] text-white/55 truncate">
                    {money(deal.baseline_revenue)} baseline · sold {deal.sale_date || '—'}
                    {deal.status ? ` · ${deal.status}` : ''}
                  </p>
                </div>
                {!fixedDeal && (
                  <button onClick={() => { setDealId(''); setPayeeId('') }} className="text-[11.5px] text-white/45 hover:text-white flex-shrink-0">Change</button>
                )}
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25 pointer-events-none" />
                  <input id="ded-deal-search" value={q} onChange={e => setQ(e.target.value)} autoFocus
                    placeholder="Search every deal by customer name…"
                    style={field} className={`${fieldCls} pl-9`} />
                </div>
                {matches.length > 0 && (
                  <div className="mt-1.5 rounded-lg overflow-hidden" style={{ background: '#171717', border: '1px solid #2e2e2e' }}>
                    {matches.map(d => (
                      <button key={d.id} onClick={() => pickDeal(d)}
                        className="w-full text-left px-3 py-2 border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors">
                        <p className="text-[12.5px] text-white/85 truncate">{d.deal_name}</p>
                        <p className="text-[10.5px] text-white/40 truncate">
                          {money(d.baseline_revenue)} baseline · sold {d.sale_date || '—'} · {d.status || '—'}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-white/40 mt-1.5">Leave blank if it isn&rsquo;t tied to a job — a tool, an advance, a uniform.</p>
              </>
            )}
          </div>

          {/* amount + who */}
          <div className="flex flex-wrap gap-3">
            <div className="w-[150px]">
              <label htmlFor="ded-amount" className={lbl}>Amount owed</label>
              <input id="ded-amount" type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0.00" style={field} className={`${fieldCls} text-red-400 font-bold tabular-nums`} />
            </div>
            <div className="flex-1 min-w-[240px]">
              <span className={lbl}>Who absorbs it</span>
              {people.length > 0 ? (
                <div className="flex gap-1.5">
                  {people.map(p => (
                    <button key={p.id} onClick={() => setPayeeId(p.id)}
                      className={`flex-1 h-10 rounded-lg text-[12.5px] font-semibold transition-colors truncate px-2 ${effectivePayee === p.id ? 'bg-teal/15 border border-teal/50 text-teal' : 'border border-white/10 text-white/60 hover:text-white'}`}>
                      {p.role} · {p.name.split(' ')[0]}
                    </button>
                  ))}
                </div>
              ) : (
                <select id="ded-payee" value={effectivePayee} onChange={e => setPayeeId(e.target.value)}
                  style={field} className={`${fieldCls} appearance-none`}>
                  <option value="">Pick a person…</option>
                  {users.filter(u => u.active !== false).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              )}
              {deal && people.length > 1 && (
                <p className="text-[11px] text-white/40 mt-1.5">Pre-picked from how this deal already splits deductions.</p>
              )}
            </div>
          </div>

          {/* note */}
          <div>
            <label htmlFor="ded-note" className={lbl}>What was it</label>
            <input id="ded-note" value={note} onChange={e => setNote(e.target.value)}
              placeholder="e.g. turf seam repair — office email 9/18" style={field} className={fieldCls} />
            <p className="text-[11px] text-white/40 mt-1.5">This is what the rep reads on their pay statement, so write it for them.</p>
          </div>

          {/* when */}
          <div className="rounded-xl p-3.5" style={{ background: '#171717', border: '1px solid #2e2e2e' }}>
            <span className={lbl}>When does it come out</span>
            <div className="space-y-1.5">
              <Radio id="ded-when-hold" value="hold"
                title="Hold until they have pay"
                sub="Waits in the Payroll tray and follows them run to run. Nothing to remember." />
              <Radio id="ded-when-now" value="now"
                title={currentRun && currentRun !== 'overdue' ? `Take it on this run — ${fmtDay(currentRun)}` : 'Take it on this run'}
                sub="Comes out now, in full." />
              <Radio id="ded-when-pick" value="pick"
                title="A run I pick"
                sub="When you already know which cheque it belongs on." />
            </div>
            {when === 'pick' && (
              <select id="ded-pick-date" value={pickDate} onChange={e => setPickDate(e.target.value)}
                style={field} className={`${fieldCls} mt-2.5 appearance-none`}>
                {payDates.map(d => <option key={d} value={d}>{fmtDay(d)}</option>)}
                {!payDates.length && <option value="">No pay runs yet</option>}
              </select>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-white/10" style={{ background: '#1a1a1a' }}>
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-[13px] font-semibold text-white/65 hover:text-white border border-white/15">Cancel</button>
          <button onClick={save} disabled={!canSave}
            className="h-9 px-5 rounded-lg text-[13px] font-extrabold bg-teal text-dark disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? 'Saving…' : edit ? 'Save changes' : 'Log deduction'}
          </button>
        </div>
      </div>
    </div>
  )
}
