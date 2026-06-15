import { useState, useEffect, useMemo } from 'react'
import { X, AlertTriangle, History, ChevronDown } from 'lucide-react'
import { format } from 'date-fns'
import { fetchDealHistory } from '../lib/db'
import { calcDealCommissions, fmt, fmtPct } from '../utils/commission'
import { payDateFromInstall } from '../utils/dateRanges'
import { useSettings } from '../contexts/SettingsContext'

const Field = ({ label, children }) => (
  <div>
    <label className="block text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1.5">{label}</label>
    {children}
  </div>
)

const inputCls = 'w-full px-3 py-2 rounded-lg text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-teal/40 transition-colors'
const inputStyle = { background: '#1a1a1a', border: '1px solid #3a3a3a' }
const Inp = (props) => <input {...props} style={inputStyle} className={inputCls} />
const Sel = ({ children, ...props }) => <select {...props} style={inputStyle} className={inputCls}>{children}</select>

const BLANK = {
  deal_name: '', office: '', project_id: '', payment_method: '',
  sale_date: '', install_date: '', pay_date: '',
  setter_id: '', closer_id: '', setter_split_pct: '50',
  baseline_revenue: '', job_price: '',
  status: 'Deal Review',
  manager_id: '', manager_override_pct: '',
  director_id: '', director_override_pct: '',
  vp_id: '', vp_override_pct: '',
  deduction_amount: '', deduction_note: '',
  financed_amount: '', dealer_fee_pct: '',
  deduction_paid_by: 'closer', deduction_split_pct: '50',
  bonus_mode: 'amount', bonus_recipient: 'setter',
  bonus_company: '', bonus_manager: '', bonus_director: '', bonus_vp: '',
}
// Director/VP override % defaults are driven by the office: Phoenix → 5%,
// Tucson → 3.75% (any other/unknown office falls back to 5%). Manager always
// defaults to 3% regardless of office.
const dirVpDefault = (office) => (office === 'Tucson' ? '3.75' : '5')
const overrideDefaults = (office) => ({
  manager_override_pct: '3',
  director_override_pct: dirVpDefault(office),
  vp_override_pct: dirVpDefault(office),
})

// ── Edit history (written by the 019 DB trigger) ────────────────
const H_LABELS = {
  deal_name: 'Name', status: 'Status', office: 'Office', payment_method: 'Payment',
  project_id: 'Project ID', sale_date: 'Sale date', install_date: 'Install date',
  pay_date: 'Pay date', setter_id: 'Setter', closer_id: 'Closer',
  manager_id: 'Manager', director_id: 'Director', vp_id: 'VP',
  baseline_revenue: 'Baseline', job_price: 'Job price', setter_split_pct: 'Setter split',
  manager_override_pct: 'Manager %', director_override_pct: 'Director %', vp_override_pct: 'VP %',
  setter_amount: 'Setter $', closer_amount: 'Closer $', manager_amount: 'Manager $',
  director_amount: 'Director $', vp_amount: 'VP $',
  deduction_amount: 'Deduction', deduction_note: 'Deduction note',
  deduction_paid_by: 'Deduction paid by', deduction_split_pct: 'Deduction split',
  financed_amount: 'Financed', dealer_fee_pct: 'Dealer fee %',
  commission_verified: 'Gold check', notes: 'Notes',
}
const H_MONEY  = new Set(['baseline_revenue','job_price','setter_amount','closer_amount','manager_amount','director_amount','vp_amount','deduction_amount','financed_amount'])
const H_PCT    = new Set(['setter_split_pct','manager_override_pct','director_override_pct','vp_override_pct','dealer_fee_pct','deduction_split_pct'])
const H_PEOPLE = new Set(['setter_id','closer_id','manager_id','director_id','vp_id'])

function DealHistory({ dealId, users }) {
  const [open, setOpen]       = useState(false)
  const [rows, setRows]       = useState(null)   // null = not loaded yet
  useEffect(() => {
    if (!open || rows !== null) return
    fetchDealHistory(dealId).then(({ data }) => setRows(data || []))
  }, [open, rows, dealId])

  const who = (id) => users.find(u => u.id === id)?.name ?? (id ? '—' : 'Sync / system')
  const val = (k, v) => {
    if (v === null || v === undefined || v === '') return '—'
    if (H_PEOPLE.has(k)) return users.find(u => u.id === v)?.name ?? '—'
    if (H_MONEY.has(k))  return fmt(v)
    if (H_PCT.has(k))    { const p = (Number(v) || 0) * 100; return (Number.isInteger(p) ? p : p.toFixed(2)) + '%' }
    if (k === 'commission_verified') return v ? 'verified' : 'not verified'
    const s = String(v)
    return s.length > 40 ? s.slice(0, 40) + '…' : s
  }

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-white/[0.02] transition-colors">
        <span className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/40 font-semibold">
          <History size={13} /> Edit history
        </span>
        <ChevronDown size={14} className={`text-white/30 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3 pb-3 max-h-56 overflow-y-auto">
          {rows === null ? (
            <p className="text-[12px] text-white/30 py-2">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-[12px] text-white/30 py-2">No history yet. (Changes are recorded once migration 019 is run.)</p>
          ) : rows.map(r => (
            <div key={r.id} className="py-2 border-t border-white/5 first:border-0">
              <p className="text-[11px] text-white/40">
                {format(new Date(r.changed_at), 'MMM d, yyyy · h:mm a')}
                <span className="text-white/60 font-semibold"> · {who(r.changed_by)}</span>
              </p>
              {r.changes?._event === 'created' ? (
                <p className="text-[12px] text-white/60 mt-0.5">Deal created</p>
              ) : (
                <div className="mt-0.5 space-y-0.5">
                  {Object.entries(r.changes || {}).map(([k, c]) => (
                    <p key={k} className="text-[12px] text-white/60">
                      <span className="text-white/40">{H_LABELS[k] || k}:</span>{' '}
                      <span className="text-white/45 line-through">{val(k, c?.from)}</span>
                      <span className="text-white/30"> → </span>
                      <span className="text-white/85">{val(k, c?.to)}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function DealModal({ deal, users = [], existingDeals = [], onSave, onClose }) {
  const { statusLabels, offices, paymentMethods } = useSettings()
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)

  // Warn about a likely duplicate when creating a new deal whose name already
  // exists (case-insensitive). Editing an existing deal never flags.
  const duplicate = useMemo(() => {
    if (deal || !form.deal_name?.trim()) return null
    const n = form.deal_name.trim().toLowerCase()
    return existingDeals.find(d => (d.deal_name || '').trim().toLowerCase() === n) || null
  }, [deal, form.deal_name, existingDeals])

  useEffect(() => {
    if (deal) {
      setForm({
        ...BLANK, ...deal,
        setter_split_pct:      deal.setter_split_pct      != null ? (deal.setter_split_pct      * 100).toString() : '50',
        manager_override_pct:  deal.manager_override_pct  != null ? (deal.manager_override_pct  * 100).toString() : '',
        director_override_pct: deal.director_override_pct != null ? (deal.director_override_pct * 100).toString() : '',
        vp_override_pct:       deal.vp_override_pct       != null ? (deal.vp_override_pct       * 100).toString() : '',
        manager_id:  deal.manager_id  ?? '',
        director_id: deal.director_id ?? '',
        vp_id:       deal.vp_id       ?? '',
        payment_method:  deal.payment_method  ?? '',
        pay_date:        deal.pay_date         ?? '',
        deduction_amount: deal.deduction_amount != null ? String(deal.deduction_amount) : '',
        deduction_note:   deal.deduction_note   ?? '',
        financed_amount:  deal.financed_amount  != null ? String(deal.financed_amount) : '',
        dealer_fee_pct:   deal.dealer_fee_pct   != null ? (deal.dealer_fee_pct * 100).toString() : '',
        deduction_paid_by: deal.deduction_paid_by ?? 'closer',
        deduction_split_pct: deal.deduction_split_pct != null ? (deal.deduction_split_pct * 100).toString() : '50',
        // Stored as resolved $ per source; edited as $ (toggle to % to re-enter).
        bonus_mode:      'amount',
        bonus_recipient: deal.bonus_recipient ?? 'setter',
        bonus_company:   deal.bonus_company  != null ? String(deal.bonus_company)  : '',
        bonus_manager:   deal.bonus_manager  != null ? String(deal.bonus_manager)  : '',
        bonus_director:  deal.bonus_director != null ? String(deal.bonus_director) : '',
        bonus_vp:        deal.bonus_vp       != null ? String(deal.bonus_vp)       : '',
      })
    } else {
      setForm(BLANK)
    }
  }, [deal])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Setting/changing the install date auto-populates the pay date (Friday of
  // the following week). Clearing the install date leaves pay date untouched,
  // and the pay date stays manually editable.
  function setInstallDate(v) {
    // Setting an install date auto-fills the pay date; clearing it clears both.
    setForm(f => ({ ...f, install_date: v, pay_date: v ? payDateFromInstall(v) : '' }))
  }

  function handleOverrideId(idKey, pctKey, value) {
    // Picking a person fills the default % if blank; clearing to "None" zeroes
    // the % out (a rep with no manager shouldn't carry a stranded 3%).
    setForm(f => ({ ...f, [idKey]: value, [pctKey]: value ? (f[pctKey] || overrideDefaults(f.office)[pctKey]) : '' }))
  }

  // Changing the office re-applies the office-driven default to any director/VP
  // override already assigned (manager stays put at its 3% default).
  function handleOfficeChange(office) {
    setForm(f => ({
      ...f,
      office,
      director_override_pct: f.director_id ? dirVpDefault(office) : f.director_override_pct,
      vp_override_pct:       f.vp_id       ? dirVpDefault(office) : f.vp_override_pct,
    }))
  }

  const splitPct = Math.min(100, Math.max(0, parseFloat(form.setter_split_pct) || 50))
  // Let the split be set by typing a $ amount (back-calculated from the rep pool).
  const repPoolForm = Math.max((parseFloat(form.job_price) || 0) - (parseFloat(form.baseline_revenue) || 0), 0)
  const setterDollars = repPoolForm * splitPct / 100
  const closerDollars = repPoolForm * (100 - splitPct) / 100
  function setSplitFromDollars(which, raw) {
    if (repPoolForm <= 0) return
    const v = Math.max(0, parseFloat(String(raw).replace(/[$,]/g, '')) || 0)
    let sp = which === 'setter' ? (v / repPoolForm) * 100 : (1 - v / repPoolForm) * 100
    // Keep enough precision (4 decimals) that a typed $ amount round-trips to the
    // cent — rounding to 2 dropped custom splits off by a few dollars.
    set('setter_split_pct', Math.min(100, Math.max(0, sp)).toFixed(4))
  }
  // Resolve a typed bonus contribution to dollars (% is of baseline).
  const baseForBonus = parseFloat(form.baseline_revenue) || 0
  const resolveBonus = (raw) => {
    const v = parseFloat(raw) || 0
    if (v <= 0) return 0
    return form.bonus_mode === 'pct' ? baseForBonus * v / 100 : v
  }
  const bonus$ = {
    company:  resolveBonus(form.bonus_company),
    manager:  resolveBonus(form.bonus_manager),
    director: resolveBonus(form.bonus_director),
    vp:       resolveBonus(form.bonus_vp),
  }
  const preview  = calcDealCommissions({
    job_price:             parseFloat(form.job_price)        || 0,
    baseline_revenue:      parseFloat(form.baseline_revenue) || 0,
    setter_id:             form.setter_id,
    closer_id:             form.closer_id,
    setter_split_pct:      splitPct / 100,
    // Override amounts only count when their person is assigned, so the preview
    // must carry the ids too (not just the %s).
    manager_id:            form.manager_id  || null,
    director_id:           form.director_id || null,
    vp_id:                 form.vp_id       || null,
    manager_override_pct:  parseFloat(form.manager_override_pct)  / 100 || 0,
    director_override_pct: parseFloat(form.director_override_pct) / 100 || 0,
    vp_override_pct:       parseFloat(form.vp_override_pct)       / 100 || 0,
    bonus_recipient:       form.bonus_recipient,
    bonus_company:         bonus$.company,
    bonus_manager:         bonus$.manager,
    bonus_director:        bonus$.director,
    bonus_vp:              bonus$.vp,
  })
  const bonusDollars = preview.bonus || 0

  // Financing dealer fee = financed amount × fee%. Counts as a deduction.
  const financed = parseFloat(form.financed_amount) || 0
  const dealerFee = financed * (parseFloat(form.dealer_fee_pct) || 0) / 100
  const totalDeduction = (parseFloat(form.deduction_amount) || 0) + dealerFee
  const isSplitDeal = !!(form.setter_id && form.closer_id && form.setter_id !== form.closer_id)
  const setterName = users.find(u => u.id === form.setter_id)?.name || 'Setter'
  const closerName = users.find(u => u.id === form.closer_id)?.name || 'Closer'
  const dedSplit = Math.min(100, Math.max(0, parseFloat(form.deduction_split_pct) || 50))  // setter's %
  const recipName = form.bonus_recipient === 'closer' ? closerName : setterName
  // Per-role override $ (gross) for showing the live "5% → 4%" net as bonuses pull from it.
  const overrideGross = {
    manager:  form.manager_id  ? baseForBonus * ((parseFloat(form.manager_override_pct)  || 0) / 100) : 0,
    director: form.director_id ? baseForBonus * ((parseFloat(form.director_override_pct) || 0) / 100) : 0,
    vp:       form.vp_id       ? baseForBonus * ((parseFloat(form.vp_override_pct)        || 0) / 100) : 0,
  }
  // The contributor rows rendered in the Rep Bonus section.
  const bonusRows = [
    { key: 'bonus_company',  label: 'Company',  role: 'company',  id: true,            gross: null },
    { key: 'bonus_manager',  label: 'Manager',  role: 'manager',  id: !!form.manager_id,  gross: overrideGross.manager },
    { key: 'bonus_director', label: 'Director', role: 'director', id: !!form.director_id, gross: overrideGross.director },
    { key: 'bonus_vp',       label: 'VP',       role: 'vp',       id: !!form.vp_id,       gross: overrideGross.vp },
  ]

  async function handleSubmit(e) {
    e.preventDefault()
    if (duplicate && !window.confirm(`A deal named "${duplicate.deal_name}" already exists${duplicate.sale_date ? ` (sold ${duplicate.sale_date})` : ''}. Create this one anyway?`)) return
    setSaving(true)
    // bonus_mode is a UI-only toggle (not a column) — don't send it to the DB.
    const { bonus_mode: _bonusMode, ...formCols } = form
    await onSave({
      ...formCols,
      baseline_revenue:      parseFloat(form.baseline_revenue) || 0,
      job_price:             parseFloat(form.job_price) || 0,
      setter_split_pct:      form.setter_id !== form.closer_id ? Math.min(1, Math.max(0, (parseFloat(form.setter_split_pct) || 50) / 100)) : null,
      manager_override_pct:  form.manager_id  && form.manager_override_pct  ? parseFloat(form.manager_override_pct)  / 100 : null,
      director_override_pct: form.director_id && form.director_override_pct ? parseFloat(form.director_override_pct) / 100 : null,
      vp_override_pct:       form.vp_id       && form.vp_override_pct       ? parseFloat(form.vp_override_pct)       / 100 : null,
      manager_id:  form.manager_id  || null,
      director_id: form.director_id || null,
      vp_id:       form.vp_id       || null,
      payment_method:   form.payment_method || null,
      pay_date:         form.pay_date || null,
      deduction_amount: form.deduction_amount !== '' ? Math.max(0, parseFloat(form.deduction_amount) || 0) : null,
      deduction_note:   form.deduction_note?.trim() || null,
      financed_amount:  form.financed_amount !== '' ? Math.max(0, parseFloat(form.financed_amount) || 0) : null,
      dealer_fee_pct:   form.dealer_fee_pct ? parseFloat(form.dealer_fee_pct) / 100 : null,
      deduction_paid_by: form.deduction_paid_by || 'closer',
      deduction_split_pct: Math.min(1, Math.max(0, (parseFloat(form.deduction_split_pct) || 50) / 100)),
      // Multi-source bonus, stored as resolved $ per source.
      bonus_company:   bonus$.company  > 0 ? bonus$.company  : null,
      bonus_manager:   bonus$.manager  > 0 ? bonus$.manager  : null,
      bonus_director:  bonus$.director > 0 ? bonus$.director : null,
      bonus_vp:        bonus$.vp       > 0 ? bonus$.vp       : null,
      bonus_recipient: bonusDollars > 0 ? form.bonus_recipient : null,
      // Any edit recomputes from the current numbers — clear stored sheet amounts
      // so the engine uses baseline/job + the splits/%s above, not stale values.
      setter_amount: null, closer_amount: null,
      manager_amount: null, director_amount: null, vp_amount: null,
    })
    setSaving(false)
  }

  const managers  = users.filter(u => u.role === 'manager')
  const directors = users.filter(u => u.role === 'director')
  const vps       = users.filter(u => u.role === 'vp')
  const showPreview = form.job_price && form.baseline_revenue

  const overrideRows = [
    { label: 'Manager',  idKey: 'manager_id',  pctKey: 'manager_override_pct',  list: managers },
    { label: 'Director', idKey: 'director_id', pctKey: 'director_override_pct', list: directors },
    { label: 'VP',       idKey: 'vp_id',       pctKey: 'vp_override_pct',       list: vps },
  ]

  return (
    // Mobile: bottom sheet | Desktop: centered modal
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:justify-center md:items-center md:p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div
        className="relative w-full md:max-w-2xl rounded-t-2xl md:rounded-2xl overflow-y-auto shadow-2xl"
        style={{ background: '#242424', border: '1px solid #333', maxHeight: '95dvh' }}
      >
        {/* Drag handle — mobile only */}
        <div className="md:hidden flex justify-center pt-3 pb-1">
          <div className="w-8 h-1 rounded-full bg-white/20" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 sticky top-0 z-10"
          style={{ background: '#242424', borderBottom: '1px solid #2e2e2e' }}>
          <h2 className="text-[15px] font-semibold text-white">{deal ? 'Edit Deal' : 'New Deal'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/10 transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 md:p-6 space-y-4 md:space-y-5"
          style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>

          {/* Row 1 — single col on mobile, 2-col on sm+ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
            <Field label="Deal Name *">
              <Inp required value={form.deal_name} onChange={e => set('deal_name', e.target.value)} placeholder="Smith Residence" />
              {duplicate && (
                <p className="text-[11px] text-amber-400 mt-1 flex items-center gap-1">
                  <AlertTriangle size={11} className="flex-shrink-0" /> A deal named “{duplicate.deal_name}” already exists{duplicate.sale_date ? ` (${duplicate.sale_date})` : ''}.
                </p>
              )}
            </Field>
            <Field label="Status">
              <Sel value={form.status} onChange={e => set('status', e.target.value)}>
                {statusLabels.map(s => <option key={s}>{s}</option>)}
              </Sel>
            </Field>
            <Field label="Sale Date *">
              <Inp required type="date" value={form.sale_date} onChange={e => set('sale_date', e.target.value)} />
            </Field>
            <Field label="Install Date">
              <Inp type="date" value={form.install_date} onChange={e => setInstallDate(e.target.value)} />
            </Field>
            <Field label="Pay Date">
              <Inp type="date" value={form.pay_date} onChange={e => set('pay_date', e.target.value)} />
            </Field>
            <Field label="Office">
              <Sel value={form.office} onChange={e => handleOfficeChange(e.target.value)}>
                <option value="">Select office…</option>
                {offices.map(o => <option key={o}>{o}</option>)}
              </Sel>
            </Field>
            <Field label="Payment Method">
              <Sel value={form.payment_method} onChange={e => set('payment_method', e.target.value)}>
                <option value="">Select method…</option>
                {paymentMethods.map(m => <option key={m}>{m}</option>)}
              </Sel>
            </Field>
            <Field label="Project ID">
              <Inp value={form.project_id} onChange={e => set('project_id', e.target.value)} placeholder="SPX-1234" />
            </Field>
          </div>

          {/* Setter / Closer */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
            <Field label="Setter *">
              <Sel required value={form.setter_id} onChange={e => set('setter_id', e.target.value)}>
                <option value="">Select setter…</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
              </Sel>
            </Field>
            <Field label="Closer *">
              <Sel required value={form.closer_id} onChange={e => set('closer_id', e.target.value)}>
                <option value="">Select closer…</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
              </Sel>
            </Field>
          </div>

          {/* Split % */}
          {form.setter_id && form.closer_id && form.setter_id !== form.closer_id && (
            <div className="rounded-xl px-4 py-3 space-y-2" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
              <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Commission Split</p>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <span className="text-[11px] text-white/50 sm:w-20 sm:text-right shrink-0">
                  Setter {splitPct.toFixed(0)}%
                </span>
                <input type="range" min="0" max="100" step="1" value={splitPct}
                  onChange={e => set('setter_split_pct', e.target.value)} className="flex-1 accent-teal" />
                <span className="text-[11px] text-white/50 sm:w-20 shrink-0">
                  Closer {(100-splitPct).toFixed(0)}%
                </span>
                <input type="number" min="0" max="100" step="any" value={form.setter_split_pct}
                  onChange={e => set('setter_split_pct', e.target.value)} placeholder="50"
                  className="px-2 py-2 rounded-lg text-[13px] text-white text-center focus:outline-none w-16 shrink-0"
                  style={{ background: '#1a1a1a', border: '1px solid #3a3a3a' }} />
              </div>
              {/* Or type the dollar amount — the slider/% follow */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <span className="text-[11px] text-white/40 sm:w-20 sm:text-right shrink-0">Setter $</span>
                <input type="number" step="any" min="0" value={repPoolForm > 0 ? setterDollars.toFixed(2) : ''}
                  onChange={e => setSplitFromDollars('setter', e.target.value)} placeholder="—" disabled={repPoolForm <= 0}
                  className="flex-1 px-2 py-2 rounded-lg text-[13px] text-white focus:outline-none disabled:opacity-40"
                  style={{ background: '#1a1a1a', border: '1px solid #3a3a3a' }} />
                <span className="text-[11px] text-white/40 sm:w-20 sm:text-right shrink-0">Closer $</span>
                <input type="number" step="any" min="0" value={repPoolForm > 0 ? closerDollars.toFixed(2) : ''}
                  onChange={e => setSplitFromDollars('closer', e.target.value)} placeholder="—" disabled={repPoolForm <= 0}
                  className="flex-1 px-2 py-2 rounded-lg text-[13px] text-white focus:outline-none disabled:opacity-40"
                  style={{ background: '#1a1a1a', border: '1px solid #3a3a3a' }} />
              </div>
              <p className="text-[10px] text-white/30">Type a $ amount to set the split (of the {fmt(repPoolForm)} rep pool) — the slider and % follow.</p>
            </div>
          )}

          {/* Revenue */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
            <Field label="Baseline Revenue ($) *">
              <Inp required type="number" min="0" step="0.01" value={form.baseline_revenue}
                onChange={e => set('baseline_revenue', e.target.value)} placeholder="5000" />
            </Field>
            <Field label="Job Price ($) *">
              <Inp required type="number" min="0" step="0.01" value={form.job_price}
                onChange={e => set('job_price', e.target.value)} placeholder="9000" />
            </Field>
          </div>

          {/* Commission preview */}
          {showPreview && (
            <div className="rounded-xl p-3 md:p-4" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
              <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">Commission Preview</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3 text-center">
                {[
                  ['Gross Comm', fmt(preview.repCommission)],
                  [`Setter (${form.setter_id===form.closer_id?'100':splitPct.toFixed(0)}%)`, fmt(preview.setterAmt)],
                  [`Closer (${form.setter_id===form.closer_id?'0':(100-splitPct).toFixed(0)}%)`, fmt(preview.closerAmt)],
                  ['Rep Comm %', fmtPct(preview.commPct)],
                ].map(([lbl, val]) => (
                  <div key={lbl}>
                    <p className="text-[10px] text-white/30 mb-0.5 leading-tight">{lbl}</p>
                    <p className="text-[14px] md:text-[15px] font-bold text-teal">{val}</p>
                  </div>
                ))}
              </div>
              {(preview.managerAmt > 0 || preview.directorAmt > 0 || preview.vpAmt > 0) && (
                <div className="mt-3 pt-3 border-t border-white/5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Overrides</p>
                    <span className="text-[12px] font-bold text-white/70">Gross {fmt(preview.overrides)}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[['Mgr', preview.managerAmt], ['Dir', preview.directorAmt], ['VP', preview.vpAmt]].map(([lbl, val]) => (
                      <div key={lbl}>
                        <p className="text-[10px] text-white/30 mb-0.5">{lbl} Override</p>
                        <p className="text-[13px] font-semibold text-white/60">{fmt(val)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Deduction */}
          <div className="rounded-xl px-4 py-3 space-y-3" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Deduction</p>
              {totalDeduction > 0 && (
                <span className="text-[12px] font-bold text-red-400">−{fmt(totalDeduction)}</span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3">
              <Field label="Amount ($)">
                <Inp type="number" min="0" step="0.01" value={form.deduction_amount}
                  onChange={e => set('deduction_amount', e.target.value)} placeholder="0.00" />
              </Field>
              <Field label="Description">
                <Inp value={form.deduction_note} onChange={e => set('deduction_note', e.target.value)}
                  placeholder="What is this deduction for?" />
              </Field>
            </div>

            {/* Dealer fee — a % of the financed amount */}
            <div className="pt-3 border-t border-white/5">
              <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-2">Dealer Fee</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Financed amount ($)">
                  <Inp type="number" min="0" step="0.01" value={form.financed_amount}
                    onChange={e => set('financed_amount', e.target.value)} placeholder="0.00" />
                </Field>
                <Field label="Dealer fee %">
                  <Inp type="number" min="0" max="100" step="0.01" value={form.dealer_fee_pct}
                    onChange={e => set('dealer_fee_pct', e.target.value)} placeholder="0" />
                </Field>
                <Field label="Dealer fee">
                  <div className="px-3 py-2 rounded-lg text-[13px] font-semibold" style={inputStyle}>
                    <span style={{ color: dealerFee > 0 ? '#f87171' : 'rgba(255,255,255,0.3)' }}>
                      {dealerFee > 0 ? `−${fmt(dealerFee)}` : '—'}
                    </span>
                  </div>
                </Field>
              </div>
            </div>

            {/* Who pays the deduction — split deals only */}
            {isSplitDeal && totalDeduction > 0 && (
              <div className="pt-3 border-t border-white/5">
                <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-2">Who pays the deduction?</p>
                <div className="inline-flex w-full rounded-lg overflow-hidden border border-white/10">
                  {[['closer', closerName], ['setter', setterName], ['split', 'Split']].map(([v, label]) => (
                    <button key={v} type="button" onClick={() => set('deduction_paid_by', v)}
                      className={`flex-1 px-2 py-2 text-[12px] font-semibold truncate transition-colors ${form.deduction_paid_by === v ? 'bg-teal text-dark' : 'text-white/50 hover:text-white'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                {form.deduction_paid_by === 'split' && (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mt-3">
                    <span className="text-[11px] text-white/50 sm:w-28 sm:text-right shrink-0 truncate">{setterName} {dedSplit}%</span>
                    <input type="range" min="0" max="100" step="1" value={dedSplit}
                      onChange={e => set('deduction_split_pct', e.target.value)} className="flex-1 accent-teal" />
                    <span className="text-[11px] text-white/50 sm:w-28 shrink-0 truncate">{closerName} {100 - dedSplit}%</span>
                  </div>
                )}
                <p className="text-[11px] text-white/40 mt-1.5">
                  {form.deduction_paid_by === 'split'
                    ? `${setterName} pays ${fmt(totalDeduction * dedSplit / 100)} · ${closerName} pays ${fmt(totalDeduction * (100 - dedSplit) / 100)}`
                    : `${form.deduction_paid_by === 'setter' ? setterName : closerName} pays the full ${fmt(totalDeduction)}`}
                </p>
              </div>
            )}
          </div>

          {/* Override chain */}
          <div>
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">Override Chain</p>
            <div className="space-y-3">
              {overrideRows.map(({ label, idKey, pctKey, list }) => (
                <div key={label} className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:items-end">
                  <div className="flex-1 min-w-0">
                    <Field label={label}>
                      <Sel value={form[idKey]} onChange={e => handleOverrideId(idKey, pctKey, e.target.value)}>
                        <option value="">None</option>
                        {list.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </Sel>
                    </Field>
                  </div>
                  <div className="sm:w-28">
                    <Field label="Override %">
                      <Inp type="number" min="0" max="100" step="0.01"
                        value={form[pctKey]} onChange={e => set(pctKey, e.target.value)}
                        placeholder="0" />
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Rep bonus — several roles can chip in (each % of baseline or $),
              pulled from their override; 'Company' is an extra from nobody. */}
          <div>
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Rep Bonus <span className="text-white/20 normal-case font-medium">· optional, chip in from anyone</span></p>
              <div className="flex items-end gap-2">
                <Field label="Enter as">
                  <Sel value={form.bonus_mode} onChange={e => set('bonus_mode', e.target.value)}>
                    <option value="amount">$ amount</option>
                    <option value="pct">% of baseline</option>
                  </Sel>
                </Field>
                <Field label="Bonus to">
                  <Sel value={form.bonus_recipient} onChange={e => set('bonus_recipient', e.target.value)}>
                    <option value="setter">{setterName}</option>
                    <option value="closer">{closerName}</option>
                  </Sel>
                </Field>
              </div>
            </div>
            <div className="space-y-2">
              {bonusRows.map(({ key, label, role, id, gross }) => {
                const give = id ? (role === 'company' ? bonus$.company : Math.min(gross, bonus$[role])) : 0
                const netPct = baseForBonus > 0 ? Math.max(0, (gross - give)) / baseForBonus * 100 : 0
                const over = role !== 'company' && id && bonus$[role] > gross + 0.005
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className="w-16 text-[12px] font-medium text-white/60 flex-shrink-0">{label}</span>
                    <div className="w-24 flex-shrink-0">
                      <Inp type="number" min="0" step="0.01" value={form[key]} disabled={!id}
                        onChange={e => set(key, e.target.value)} placeholder="0" />
                    </div>
                    <span className="text-[11px] text-white/40 min-w-0 flex-1">
                      {role === 'company'
                        ? (give > 0 ? <span>extra <span className="text-teal font-semibold">+{fmt(give)}</span> (from nobody)</span> : 'an extra on top, from nobody')
                        : !id ? 'no one assigned'
                        : <>override {fmt(gross)} {give > 0 && <span className="text-white/55">→ {fmt(Math.max(0, gross - give))} ({netPct.toFixed(1)}%)</span>}
                            {over && <span className="text-amber-400"> · only has {fmt(gross)}; capped</span>}</>}
                    </span>
                  </div>
                )
              })}
            </div>
            {bonusDollars > 0 && (
              <p className="text-[12px] mt-2.5 pt-2.5 border-t border-white/5">
                <span className="text-white/50">Total bonus to {recipName}:</span> <span className="font-bold text-teal">+{fmt(bonusDollars)}</span>
              </p>
            )}
          </div>

          {deal?.id && <DealHistory dealId={deal.id} users={users} />}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving}
              className="flex-1 py-3 rounded-xl text-[14px] font-bold text-dark bg-teal hover:bg-teal-dark disabled:opacity-50 transition-colors">
              {saving ? 'Saving…' : deal ? 'Save Changes' : 'Create Deal'}
            </button>
            <button type="button" onClick={onClose}
              className="px-6 py-3 rounded-xl text-[13px] font-medium text-white/50 hover:text-white transition-colors"
              style={{ border: '1px solid #3a3a3a' }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
