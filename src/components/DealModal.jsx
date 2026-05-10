import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { calcDealCommissions, fmt, fmtPct } from '../utils/commission'

const STATUSES = ['Deal Review', 'Pending Install', 'Pay Finalized', 'Paid', 'Sales Issue']

const Field = ({ label, children }) => (
  <div>
    <label className="block text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1.5">
      {label}
    </label>
    {children}
  </div>
)

const inputCls =
  'w-full px-3 py-2 rounded-lg text-[13px] text-white placeholder-white/20 ' +
  'focus:outline-none focus:border-teal/40 transition-colors'
const inputStyle = { background: '#1a1a1a', border: '1px solid #3a3a3a' }

const Inp = (props) => <input {...props} style={inputStyle} className={inputCls} />

const Sel = ({ children, ...props }) => (
  <select {...props} style={inputStyle} className={inputCls}>
    {children}
  </select>
)

const OFFICES = ['Phoenix', 'Tucson']

const BLANK = {
  deal_name: '', office: '', project_id: '',
  sale_date: '', install_date: '',
  setter_id: '', closer_id: '', setter_split_pct: '50',
  baseline_revenue: '', job_price: '',
  status: 'Deal Review',
  manager_id: '', manager_override_pct: '', manager_to_rep_pct: '',
  director_id: '', director_override_pct: '', director_to_rep_pct: '',
  vp_id: '', vp_override_pct: '', vp_to_rep_pct: '',
}

const OVERRIDE_DEFAULTS = {
  manager_override_pct: '3',
  director_override_pct: '5',
  vp_override_pct: '5',
}

export default function DealModal({ deal, users = [], onSave, onClose }) {
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (deal) {
      setForm({
        ...BLANK,
        ...deal,
        setter_split_pct:         deal.setter_split_pct         != null ? (deal.setter_split_pct * 100).toString() : '50',
        manager_override_pct:     deal.manager_override_pct     != null ? (deal.manager_override_pct  * 100).toString() : '',
        director_override_pct:    deal.director_override_pct    != null ? (deal.director_override_pct * 100).toString() : '',
        vp_override_pct:          deal.vp_override_pct          != null ? (deal.vp_override_pct       * 100).toString() : '',
        manager_to_rep_pct:  deal.manager_to_rep_pct  != null ? (deal.manager_to_rep_pct  * 100).toString() : '',
        director_to_rep_pct: deal.director_to_rep_pct != null ? (deal.director_to_rep_pct * 100).toString() : '',
        vp_to_rep_pct:       deal.vp_to_rep_pct       != null ? (deal.vp_to_rep_pct       * 100).toString() : '',
        manager_id:  deal.manager_id  ?? '',
        director_id: deal.director_id ?? '',
        vp_id:       deal.vp_id       ?? '',
      })
    } else {
      setForm(BLANK)
    }
  }, [deal])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Auto-populate default % when a role is first selected
  function handleOverrideId(idKey, pctKey, value) {
    setForm(f => ({
      ...f,
      [idKey]: value,
      [pctKey]: value && !f[pctKey] ? OVERRIDE_DEFAULTS[pctKey] : f[pctKey],
    }))
  }

  const splitPct = Math.min(100, Math.max(0, parseFloat(form.setter_split_pct) || 50))
  const preview  = calcDealCommissions({
    job_price:                parseFloat(form.job_price) || 0,
    baseline_revenue:         parseFloat(form.baseline_revenue) || 0,
    setter_id:                form.setter_id,
    closer_id:                form.closer_id,
    setter_split_pct:         splitPct / 100,
    manager_override_pct:     parseFloat(form.manager_override_pct)  / 100 || 0,
    director_override_pct:    parseFloat(form.director_override_pct) / 100 || 0,
    vp_override_pct:          parseFloat(form.vp_override_pct)       / 100 || 0,
    manager_to_rep_pct:  form.manager_to_rep_pct  ? Math.min(1, parseFloat(form.manager_to_rep_pct)  / 100) : 0,
    director_to_rep_pct: form.director_to_rep_pct ? Math.min(1, parseFloat(form.director_to_rep_pct) / 100) : 0,
    vp_to_rep_pct:       form.vp_to_rep_pct       ? Math.min(1, parseFloat(form.vp_to_rep_pct)       / 100) : 0,
  })

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    await onSave({
      ...form,
      baseline_revenue:         parseFloat(form.baseline_revenue) || 0,
      job_price:                parseFloat(form.job_price) || 0,
      setter_split_pct:         form.setter_id !== form.closer_id
        ? Math.min(1, Math.max(0, (parseFloat(form.setter_split_pct) || 50) / 100))
        : null,
      manager_override_pct:     form.manager_override_pct  ? parseFloat(form.manager_override_pct)  / 100 : null,
      director_override_pct:    form.director_override_pct ? parseFloat(form.director_override_pct) / 100 : null,
      vp_override_pct:          form.vp_override_pct       ? parseFloat(form.vp_override_pct)       / 100 : null,
      manager_to_rep_pct:  form.manager_to_rep_pct  ? Math.min(1, parseFloat(form.manager_to_rep_pct)  / 100) : 0,
      director_to_rep_pct: form.director_to_rep_pct ? Math.min(1, parseFloat(form.director_to_rep_pct) / 100) : 0,
      vp_to_rep_pct:       form.vp_to_rep_pct       ? Math.min(1, parseFloat(form.vp_to_rep_pct)       / 100) : 0,
      manager_id:  form.manager_id  || null,
      director_id: form.director_id || null,
      vp_id:       form.vp_id       || null,
    })
    setSaving(false)
  }

  const managers  = users.filter(u => u.role === 'manager')
  const directors = users.filter(u => u.role === 'director')
  const vps       = users.filter(u => u.role === 'vp')
  const showPreview = form.job_price && form.baseline_revenue

  const overrideRows = [
    { label: 'Manager',  idKey: 'manager_id',  pctKey: 'manager_override_pct',  toRepKey: 'manager_to_rep_pct',  list: managers },
    { label: 'Director', idKey: 'director_id', pctKey: 'director_override_pct', toRepKey: 'director_to_rep_pct', list: directors },
    { label: 'VP',       idKey: 'vp_id',       pctKey: 'vp_override_pct',       toRepKey: 'vp_to_rep_pct',       list: vps },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div
        className="relative w-full max-w-2xl rounded-2xl overflow-y-auto shadow-2xl"
        style={{ background: '#242424', border: '1px solid #333', maxHeight: '92vh' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 sticky top-0 z-10"
          style={{ background: '#242424', borderBottom: '1px solid #2e2e2e' }}
        >
          <h2 className="text-[15px] font-semibold text-white">
            {deal ? 'Edit Deal' : 'New Deal'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Row 1 */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Deal Name *">
              <Inp required value={form.deal_name} onChange={e => set('deal_name', e.target.value)} placeholder="Smith Residence" />
            </Field>
            <Field label="Status">
              <Sel value={form.status} onChange={e => set('status', e.target.value)}>
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </Sel>
            </Field>
            <Field label="Sale Date *">
              <Inp required type="date" value={form.sale_date} onChange={e => set('sale_date', e.target.value)} />
            </Field>
            <Field label="Install Date">
              <Inp type="date" value={form.install_date} onChange={e => set('install_date', e.target.value)} />
            </Field>
            <Field label="Office">
              <Sel value={form.office} onChange={e => set('office', e.target.value)}>
                <option value="">Select office…</option>
                {OFFICES.map(o => <option key={o}>{o}</option>)}
              </Sel>
            </Field>
            <Field label="Project ID">
              <Inp value={form.project_id} onChange={e => set('project_id', e.target.value)} placeholder="SPX-1234" />
            </Field>
          </div>

          {/* Setter / Closer */}
          <div className="grid grid-cols-2 gap-4">
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

          {/* Split % — only when setter ≠ closer */}
          {form.setter_id && form.closer_id && form.setter_id !== form.closer_id && (
            <div
              className="rounded-xl px-4 py-3 flex items-center gap-4"
              style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}
            >
              <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest whitespace-nowrap">
                Commission Split
              </p>
              <div className="flex-1 flex items-center gap-3">
                <span className="text-[11px] text-white/50 w-14 text-right shrink-0">
                  Setter {splitPct.toFixed(0)}%
                </span>
                <input
                  type="range" min="0" max="100" step="1"
                  value={splitPct}
                  onChange={e => set('setter_split_pct', e.target.value)}
                  className="flex-1 accent-teal"
                />
                <span className="text-[11px] text-white/50 w-16 shrink-0">
                  Closer {(100 - splitPct).toFixed(0)}%
                </span>
              </div>
              <input
                type="number" min="0" max="100" step="1"
                value={form.setter_split_pct}
                onChange={e => set('setter_split_pct', e.target.value)}
                placeholder="50"
                className="px-2 py-2 rounded-lg text-[13px] text-white text-center focus:outline-none focus:border-teal/40 transition-colors"
                style={{ background: '#1a1a1a', border: '1px solid #3a3a3a', width: 64 }}
              />
            </div>
          )}

          {/* Revenue */}
          <div className="grid grid-cols-2 gap-4">
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
            <div className="rounded-xl p-4" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
              <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">
                Commission Preview
              </p>
              <div className="grid grid-cols-4 gap-3 text-center">
                {[
                  ['Gross', fmt(preview.gross)],
                  [`Setter (${form.setter_id === form.closer_id ? '100' : splitPct.toFixed(0)}%)`, fmt(preview.setterAmt)],
                  [`Closer (${form.setter_id === form.closer_id ? '0' : (100 - splitPct).toFixed(0)}%)`, fmt(preview.closerAmt)],
                  ['Rep Comm %', fmtPct(preview.commPct)],
                ].map(([lbl, val]) => (
                  <div key={lbl}>
                    <p className="text-[10px] text-white/30 mb-0.5">{lbl}</p>
                    <p className="text-[15px] font-bold text-teal">{val}</p>
                  </div>
                ))}
              </div>
              {preview.repBonus > 0 && (
                <p className="text-[10px] text-teal/60 text-center mt-2">
                  Includes {fmt(preview.repBonus)} override redirected to rep
                </p>
              )}
              {(preview.managerAmt > 0 || preview.directorAmt > 0 || preview.vpAmt > 0) && (
                <div className="grid grid-cols-3 gap-3 text-center mt-3 pt-3 border-t border-white/5">
                  {[
                    ['Mgr Override', preview.managerAmt],
                    ['Dir Override', preview.directorAmt],
                    ['VP Override',  preview.vpAmt],
                  ].map(([lbl, val]) => (
                    <div key={lbl}>
                      <p className="text-[10px] text-white/30 mb-0.5">{lbl}</p>
                      <p className="text-[13px] font-semibold text-white/60">{fmt(val)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Override chain */}
          <div>
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">
              Override Chain
            </p>
            <div className="space-y-3">
              {overrideRows.map(({ label, idKey, pctKey, toRepKey, list }) => (
                <div key={label} className="flex gap-3 items-end">
                  <div className="flex-1 min-w-0">
                    <Field label={label}>
                      <Sel value={form[idKey]} onChange={e => handleOverrideId(idKey, pctKey, e.target.value)}>
                        <option value="">None</option>
                        {list.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </Sel>
                    </Field>
                  </div>
                  <div style={{ width: 84 }}>
                    <Field label="Override %">
                      <Inp
                        type="number" min="0" max="100" step="0.1"
                        value={form[pctKey]}
                        onChange={e => set(pctKey, e.target.value)}
                        placeholder="0"
                        disabled={!form[idKey]}
                      />
                    </Field>
                  </div>
                  {form[idKey] && (
                    <div style={{ width: 84 }}>
                      <Field label="% to Rep">
                        <Inp
                          type="number" min="0" max="100" step="0.1"
                          value={form[toRepKey]}
                          onChange={e => set(toRepKey, e.target.value)}
                          placeholder="0"
                        />
                      </Field>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-dark bg-teal hover:bg-teal-dark disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : deal ? 'Save Changes' : 'Create Deal'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 rounded-xl text-[13px] font-medium text-white/50 hover:text-white transition-colors"
              style={{ border: '1px solid #3a3a3a' }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
