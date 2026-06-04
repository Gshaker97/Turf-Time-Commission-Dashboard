import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
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

export default function DealModal({ deal, users = [], onSave, onClose }) {
  const { statusLabels, offices, paymentMethods } = useSettings()
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)

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
    setForm(f => ({ ...f, install_date: v, ...(v ? { pay_date: payDateFromInstall(v) } : {}) }))
  }

  function handleOverrideId(idKey, pctKey, value) {
    setForm(f => ({ ...f, [idKey]: value, [pctKey]: value && !f[pctKey] ? overrideDefaults(f.office)[pctKey] : f[pctKey] }))
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
  const preview  = calcDealCommissions({
    job_price:             parseFloat(form.job_price)        || 0,
    baseline_revenue:      parseFloat(form.baseline_revenue) || 0,
    setter_id:             form.setter_id,
    closer_id:             form.closer_id,
    setter_split_pct:      splitPct / 100,
    manager_override_pct:  parseFloat(form.manager_override_pct)  / 100 || 0,
    director_override_pct: parseFloat(form.director_override_pct) / 100 || 0,
    vp_override_pct:       parseFloat(form.vp_override_pct)       / 100 || 0,
  })

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    await onSave({
      ...form,
      baseline_revenue:      parseFloat(form.baseline_revenue) || 0,
      job_price:             parseFloat(form.job_price) || 0,
      setter_split_pct:      form.setter_id !== form.closer_id ? Math.min(1, Math.max(0, (parseFloat(form.setter_split_pct) || 50) / 100)) : null,
      manager_override_pct:  form.manager_override_pct  ? parseFloat(form.manager_override_pct)  / 100 : null,
      director_override_pct: form.director_override_pct ? parseFloat(form.director_override_pct) / 100 : null,
      vp_override_pct:       form.vp_override_pct       ? parseFloat(form.vp_override_pct)       / 100 : null,
      manager_id:  form.manager_id  || null,
      director_id: form.director_id || null,
      vp_id:       form.vp_id       || null,
      payment_method:   form.payment_method || null,
      pay_date:         form.pay_date || null,
      deduction_amount: form.deduction_amount !== '' ? Math.max(0, parseFloat(form.deduction_amount) || 0) : null,
      deduction_note:   form.deduction_note?.trim() || null,
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
                <input type="number" min="0" max="100" step="1" value={form.setter_split_pct}
                  onChange={e => set('setter_split_pct', e.target.value)} placeholder="50"
                  className="px-2 py-2 rounded-lg text-[13px] text-white text-center focus:outline-none w-16 shrink-0"
                  style={{ background: '#1a1a1a', border: '1px solid #3a3a3a' }} />
              </div>
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
                  ['Gross', fmt(preview.gross)],
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
                <div className="grid grid-cols-3 gap-2 text-center mt-3 pt-3 border-t border-white/5">
                  {[['Mgr', preview.managerAmt], ['Dir', preview.directorAmt], ['VP', preview.vpAmt]].map(([lbl, val]) => (
                    <div key={lbl}>
                      <p className="text-[10px] text-white/30 mb-0.5">{lbl} Override</p>
                      <p className="text-[13px] font-semibold text-white/60">{fmt(val)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Deduction */}
          <div className="rounded-xl px-4 py-3 space-y-3" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Deduction</p>
              {parseFloat(form.deduction_amount) > 0 && (
                <span className="text-[12px] font-bold text-red-400">−{fmt(parseFloat(form.deduction_amount) || 0)}</span>
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
                        placeholder="0" disabled={!form[idKey]} />
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          </div>

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
