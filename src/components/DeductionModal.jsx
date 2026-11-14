import { useMemo, useState } from 'react'
import { X, Search } from 'lucide-react'
import { dealAmounts } from '../utils/commission'
import { SURFACE, GOLD_WASH, PrimaryButton, SecondaryButton, IconButton, inputCls } from '../components/ui'

// ── Log (or edit) a deduction ────────────────────────────────────────────
// Records what is OWED. It never touches deals.deduction_amount — that column
// feeds dealAmounts(), so writing to it on a paid job would rewrite that
// deal's commission on every page and in the backup spreadsheet, and the
// pay-run lock would reject it anyway. The debt REFERENCES its deal instead.
//
// The control that matters is the last one. "Hold until they have pay" is the
// option that did not exist before: it stores a debt with no pay date, which
// then follows the rep from run to run until it is recovered.

const field = SURFACE.well
const fieldCls = `${inputCls} !min-h-[44px] !h-11 text-[13.5px]`
const lbl = 'block text-[13px] font-bold uppercase tracking-wide text-bank-fa mb-1.5'
const WARN = 'var(--warn)', NEG = 'var(--neg)'
// Option tiles (who absorbs it, when it comes out): gold wash when picked.
const tile = (on) => (on ? GOLD_WASH : { border: '1px solid var(--line)' })

const money = (v) => '$' + Math.abs(Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDay = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', d: undefined, day: 'numeric', year: 'numeric' }) : '')
const shortDay = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')

export default function DeductionModal({ deal: fixedDeal, deals = [], users = [], payDates = [], currentRun, nextRun, payByRun, edit, onClose, onSave }) {
  const [q, setQ]           = useState('')
  const [dealId, setDealId] = useState(edit?.deal_id || fixedDeal?.id || '')
  const [amount, setAmount] = useState(edit ? String(Math.abs(Number(edit.amount) || 0)) : '')
  const [note, setNote]     = useState(edit?.note || '')
  const [payeeId, setPayeeId] = useState(edit?.payee_id || '')
  // 'one' = one person absorbs it; 'split' = BOTH do, and we write TWO debt
  // rows. Two rows rather than one flagged row because each share then
  // recovers on its OWN pay run — the ledger, the tray, the pay statement and
  // the rep's Commissions card all keep working with no change at all.
  // Create only: re-splitting a debt that already has recoveries against it
  // would mean unpicking money already paid.
  const [mode, setMode]     = useState('one')
  const [splitPct, setSplitPct] = useState(50)      // the SETTER's share
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
  // What each person actually EARNED on this job, so you can see at a glance
  // whether the deduction fits inside their pay for it.
  const amounts = useMemo(() => (deal ? dealAmounts(deal) : null), [deal])

  const people = useMemo(() => {
    if (!deal) return []
    const setter = users.find(u => u.id === deal.setter_id)
    const closer = users.find(u => u.id === deal.closer_id)
    const out = []
    if (setter) out.push({ id: setter.id, name: setter.name, role: 'Setter', earned: amounts?.setter ?? 0 })
    if (closer && closer.id !== setter?.id) out.push({ id: closer.id, name: closer.name, role: 'Closer', earned: amounts?.closer ?? 0 })
    return out
  }, [deal, users, amounts])

  const canSplit = !edit && people.length === 2
  const setterPerson = people.find(p => p.role === 'Setter')
  const closerPerson = people.find(p => p.role === 'Closer')

  const defaultPayee = useMemo(() => {
    if (!deal) return ''
    const solo = !deal.closer_id || deal.closer_id === deal.setter_id
    if (solo) return deal.setter_id || deal.closer_id || ''
    const paidBy = deal.deduction_paid_by || 'closer'
    return paidBy === 'setter' ? deal.setter_id : deal.closer_id
  }, [deal])

  const effectivePayee = payeeId || defaultPayee
  const amt = Math.abs(parseFloat(amount) || 0)

  function pickDeal(d) {
    setDealId(d.id); setQ('')
    setPayeeId('')                                   // re-derive from the new deal
    setMode('one')
    // Start from how this deal already splits deductions, same as the editor.
    const pct = d.deduction_split_pct != null ? Math.round(Number(d.deduction_split_pct) * 100) : 50
    setSplitPct(Math.min(100, Math.max(0, pct)))
    if (!note.trim()) setNote('')
  }

  // Round to cents and give any rounding remainder to the LARGER share, so the
  // two rows always add back to exactly what was typed.
  const splitRows = useMemo(() => {
    if (mode !== 'split' || !setterPerson || !closerPerson) return null
    const setterCut = Math.round(amt * (splitPct / 100) * 100) / 100
    const closerCut = Math.round((amt - setterCut) * 100) / 100
    return [
      { payeeId: setterPerson.id, amount: setterCut, who: setterPerson },
      { payeeId: closerPerson.id, amount: closerCut, who: closerPerson },
    ]
  }, [mode, amt, splitPct, setterPerson, closerPerson])

  // ── What their next cheque actually is ────────────────────────────────
  // Knowing a rep earned $1,400 on THIS job says nothing about whether $640
  // can come off their pay — that depends on the whole run. So every person
  // shows their pay on the run the money would leave from, which follows the
  // "when" choice: the run picked, or — for a held debt, which has no run of
  // its own — the NEXT cheque, the first one it can reach.
  const runDate = when === 'now'  ? (currentRun && currentRun !== 'overdue' ? currentRun : nextRun)
                : when === 'pick' ? (pickDate || null)
                : nextRun
  const payOn = (id) => (id && runDate ? payByRun?.[runDate]?.[id] : null) || null

  // This person's slice of the deduction, so the pay line can flag a take
  // that does not fit. Zero for someone who is not absorbing any of it.
  const shareFor = (id) => {
    if (mode === 'split') return splitRows?.find(r => r.payeeId === id)?.amount ?? 0
    return effectivePayee === id ? amt : 0
  }

  // Who is actually absorbing money, and by how much the run comes up short.
  // This is the answer to "can I take it out" stated in words — the amber
  // figure alone makes you do the subtraction.
  const absorbers = people.length
    ? people.map(p => ({ id: p.id, name: p.name.split(' ')[0], share: shareFor(p.id) }))
    : effectivePayee
      ? [{ id: effectivePayee, name: (users.find(u => u.id === effectivePayee)?.name || '').split(' ')[0], share: amt }]
      : []
  const overshoot = runDate
    ? absorbers
        .map(a => ({ ...a, by: a.share - (payOn(a.id)?.net || 0) }))
        .filter(a => a.share > 0 && a.by > 0.005)
    : []

  const canSave = amt > 0 && !saving &&
    (mode === 'split' ? !!splitRows && splitRows.every(r => r.amount > 0) : !!effectivePayee)

  async function save() {
    if (!canSave) return
    setSaving(true)
    const payDate = when === 'now' ? (currentRun !== 'overdue' ? currentRun : null)
                  : when === 'pick' ? (pickDate || null)
                  : null                             // hold = the debt, no run
    // ONE call carrying one row or two — Payroll writes them together so a
    // split can never half-save and leave one person owing the whole thing.
    const ok = await onSave({
      id: edit?.id || null,
      dealId: dealId || null,
      note: note.trim() || null,
      payDate,
      rows: mode === 'split'
        ? splitRows.map(r => ({ payeeId: r.payeeId, amount: -r.amount }))
        : [{ payeeId: effectivePayee, amount: -amt }],
    })
    setSaving(false)
    if (ok) onClose()
  }

  // Their whole cheque on that run — `pending` is money on the run that is
  // not finalized yet, kept separate so a future run does not read as $0 and
  // does not pretend to be money you can take today.
  const PayLine = ({ id, share = 0 }) => {
    const pay = payOn(id)
    if (!runDate || !id) return null
    const net = pay?.net || 0
    const pending = pay?.pending || 0
    const short = share > 0 && share > net
    return (
      <span className="block text-[13px] tabular-nums" style={{ color: short ? WARN : 'var(--mu)' }}>
        {shortDay(runDate)} pay {money(net)}
        {pending > 0 && <span className="text-bank-fa"> · {money(pending)} pending</span>}
      </span>
    )
  }

  const Radio = ({ id, value, title, sub }) => (
    <label htmlFor={id}
      className="flex items-start gap-2.5 px-3 py-2.5 min-h-[44px] rounded-lg cursor-pointer transition-colors"
      style={tile(when === value)}>
      <input id={id} type="radio" name="ded-when" checked={when === value} onChange={() => setWhen(value)}
        className="mt-0.5 w-[15px] h-[15px] flex-shrink-0 accent-[#bfa46c]" />
      <span className="min-w-0">
        <span className={`block text-[13px] ${when === value ? 'font-bold text-bank-gold-tx' : 'font-semibold text-bank-tx'}`}>{title}</span>
        <span className="block mt-0.5 text-[13px] text-bank-mu">{sub}</span>
      </span>
    </label>
  )

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-start md:justify-center md:overflow-y-auto md:p-8">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(3px)' }} />
      <div className="relative w-full md:max-w-[620px] h-[100dvh] md:h-auto rounded-none md:rounded-2xl overflow-y-auto md:overflow-visible flex flex-col"
        style={{ ...SURFACE.card, boxShadow: 'var(--card-shadow), 0 24px 60px rgba(0,0,0,0.55)', color: 'var(--tx)' }}
        role="dialog" aria-modal="true" aria-label={edit ? 'Edit deduction' : 'Log a deduction'}>

        <div className="flex items-start gap-3 px-5 py-3 border-b border-bank-line sticky top-0 z-10" style={{ background: 'var(--card)' }}>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-extrabold text-bank-tx">{edit ? 'Edit deduction' : 'Log a deduction'}</h2>
            <p className="text-[13px] text-bank-mu mt-1">
              Records what is owed. It never changes the deal&rsquo;s own numbers or a run that has already gone out.
            </p>
          </div>
          <IconButton onClick={onClose} aria-label="Close"><X size={17} /></IconButton>
        </div>

        <div className="px-5 py-4 space-y-4 flex-1">

          {/* which job */}
          <div>
            <span className={lbl}>Which job?</span>
            {deal ? (
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg" style={GOLD_WASH}>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-bank-tx truncate">{deal.deal_name}</p>
                  <p className="text-[13px] text-bank-mu truncate">
                    {money(deal.baseline_revenue)} baseline · sold {deal.sale_date || '—'}
                    {' · installed '}{deal.install_date || 'not set'}
                    {deal.status ? ` · ${deal.status}` : ''}
                  </p>
                </div>
                {!fixedDeal && (
                  <button onClick={() => { setDealId(''); setPayeeId('') }} className="text-[13px] text-bank-mu hover:text-bank-tx flex-shrink-0 min-h-[44px] px-2">Change</button>
                )}
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-bank-fa pointer-events-none" />
                  <input id="ded-deal-search" value={q} onChange={e => setQ(e.target.value)} autoFocus
                    placeholder="Search every deal by customer name…"
                    style={field} className={`${fieldCls} pl-9`} />
                </div>
                {matches.length > 0 && (
                  <div className="mt-1.5 rounded-lg overflow-hidden" style={SURFACE.raise}>
                    {matches.map(d => (
                      <button key={d.id} onClick={() => pickDeal(d)}
                        className="w-full text-left px-3 py-2 min-h-[44px] border-b border-bank-line last:border-0 hover:bg-bank-card transition-colors">
                        <p className="text-[13px] text-bank-tx truncate">{d.deal_name}</p>
                        <p className="text-[13px] text-bank-mu truncate">
                          {money(d.baseline_revenue)} baseline · sold {d.sale_date || '—'} · installed {d.install_date || 'not set'} · {d.status || '—'}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-[13px] text-bank-mu mt-1.5">Leave blank if it isn&rsquo;t tied to a job — a tool, an advance, a uniform.</p>
              </>
            )}
          </div>

          {/* amount + who */}
          <div className="flex flex-wrap gap-3">
            <div className="w-[150px]">
              <label htmlFor="ded-amount" className={lbl}>Amount owed</label>
              <input id="ded-amount" type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0.00" style={{ ...field, color: NEG }} className={`${fieldCls} font-bold tabular-nums`} />
            </div>
            <div className="flex-1 min-w-[240px]">
              <span className={lbl}>Who absorbs it</span>
              {people.length > 0 ? (
                <div className="flex gap-1.5 flex-wrap">
                  {people.map(p => {
                    const on = mode === 'one' && effectivePayee === p.id
                    return (
                      <button key={p.id} onClick={() => { setMode('one'); setPayeeId(p.id) }} aria-pressed={on}
                        className="flex-1 rounded-lg py-1.5 px-2 min-h-[44px] text-left transition-colors min-w-0" style={tile(on)}>
                        <span className={`block text-[13px] font-semibold truncate ${on ? 'text-bank-gold-tx' : 'text-bank-tx'}`}>
                          {p.role} · {p.name.split(' ')[0]}
                        </span>
                        {/* What they EARNED on this job — so you can see whether
                            the deduction fits inside their pay for it. */}
                        <span className="block text-[13px] tabular-nums" style={{ color: amt > p.earned && amt > 0 ? WARN : 'var(--mu)' }}>
                          earned {money(p.earned)}
                        </span>
                        {/* …and what their WHOLE cheque is on the run this
                            would come off, which is what decides it. */}
                        <PayLine id={p.id} share={shareFor(p.id)} />
                      </button>
                    )
                  })}
                  {canSplit && (
                    <button onClick={() => setMode('split')} aria-pressed={mode === 'split'}
                      className={`rounded-lg py-1.5 px-3 min-h-[44px] text-[13px] font-semibold transition-colors flex-shrink-0 ${mode === 'split' ? 'text-bank-gold-tx' : 'text-bank-mu hover:text-bank-tx'}`}
                      style={tile(mode === 'split')}>
                      Split
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <select id="ded-payee" value={effectivePayee} onChange={e => setPayeeId(e.target.value)}
                    style={field} className={`${fieldCls} appearance-none`}>
                    <option value="">Pick a person…</option>
                    {users.filter(u => u.active !== false).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                  <div className="mt-1.5"><PayLine id={effectivePayee} share={amt} /></div>
                </>
              )}

              {mode === 'split' && splitRows ? (
                <div className="mt-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[13px] text-bank-mu w-24 text-right shrink-0 truncate">
                      {setterPerson.name.split(' ')[0]} {splitPct}%
                    </span>
                    <input type="range" min="0" max="100" step="1" value={splitPct} aria-label="Setter share"
                      onChange={e => setSplitPct(Number(e.target.value))} className="flex-1 accent-[#bfa46c] min-h-[44px]" />
                    <span className="text-[13px] text-bank-mu w-24 shrink-0 truncate">
                      {closerPerson.name.split(' ')[0]} {100 - splitPct}%
                    </span>
                  </div>
                  <p className="text-[13px] mt-1.5 text-bank-mu">
                    {splitRows.map(r => `${r.who.name.split(' ')[0]} owes ${money(r.amount)}`).join(' · ')}
                    <span className="text-bank-fa"> — two separate balances, each coming off that rep&rsquo;s own next cheque.</span>
                  </p>
                </div>
              ) : deal && people.length > 1 ? (
                <p className="text-[13px] text-bank-mu mt-1.5">Pre-picked from how this deal already splits deductions.</p>
              ) : null}

              {overshoot.length > 0 && (
                <p className="text-[13px] mt-1.5" style={{ color: WARN }}>
                  {overshoot.map(o => `${o.name} is ${money(o.by)} short`).join(' · ')} on {shortDay(runDate)}
                  <span style={{ opacity: 0.75 }}>
                    {when === 'hold'
                      ? ' — it waits, then comes out across however many runs it takes.'
                      : ' — “Hold until they have pay” takes what fits and carries the rest.'}
                  </span>
                </p>
              )}
            </div>
          </div>

          {/* note */}
          <div>
            <label htmlFor="ded-note" className={lbl}>What was it</label>
            <input id="ded-note" value={note} onChange={e => setNote(e.target.value)}
              placeholder="e.g. turf seam repair — office email 9/18" style={field} className={fieldCls} />
            <p className="text-[13px] text-bank-mu mt-1.5">This is what the rep reads on their pay statement, so write it for them.</p>
          </div>

          {/* when */}
          <div className="rounded-xl p-3.5" style={SURFACE.raise}>
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
              <select id="ded-pick-date" value={pickDate} onChange={e => setPickDate(e.target.value)} aria-label="Pay run"
                style={field} className={`${fieldCls} mt-2.5 appearance-none`}>
                {payDates.map(d => <option key={d} value={d}>{fmtDay(d)}</option>)}
                {!payDates.length && <option value="">No pay runs yet</option>}
              </select>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-bank-line sticky bottom-0 md:static"
          style={{ background: 'var(--card)', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
          <SecondaryButton onClick={onClose} className="px-4 min-h-[44px]">Cancel</SecondaryButton>
          <PrimaryButton onClick={save} disabled={!canSave} className="px-5 py-2">
            {saving ? 'Saving…' : edit ? 'Save changes' : 'Log deduction'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}
