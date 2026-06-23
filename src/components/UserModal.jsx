import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { userAdmin, userAdminConfigured, updateUser } from '../lib/db'

const ROLES = ['rep', 'manager', 'director', 'vp', 'admin']

const inputCls =
  'w-full px-3 py-2 rounded-lg text-[13px] text-white placeholder-white/20 ' +
  'focus:outline-none focus:border-teal/40 transition-colors'
const inputStyle = { background: '#1a1a1a', border: '1px solid #3a3a3a' }
const Inp = (p) => <input {...p} style={inputStyle} className={inputCls} />
const Sel = ({ children, ...p }) => (
  <select {...p} style={inputStyle} className={inputCls}>{children}</select>
)
const Field = ({ label, children }) => (
  <div>
    <label className="block text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1.5">
      {label}
    </label>
    {children}
  </div>
)

const BLANK = {
  name: '', email: '', role: 'rep', company_name: 'Turf Time',
  manager_id: '', director_id: '', vp_id: '',
  is_admin: false, ghost: false,
  password: '',
}

export default function UserModal({ user, allUsers = [], onSave, onClose }) {
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [pw, setPw] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwMsg, setPwMsg] = useState('')
  const [pwErr, setPwErr] = useState(false)
  const pwConfigured = userAdminConfigured()

  useEffect(() => {
    if (user) {
      setForm({
        ...BLANK,
        ...user,
        manager_id:  user.manager_id  ?? '',
        director_id: user.director_id ?? '',
        vp_id:       user.vp_id       ?? '',
        is_admin:    user.is_admin    ?? false,
        ghost:       user.ghost       ?? false,
        password: '',
      })
    } else {
      setForm(BLANK)
    }
  }, [user])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Admin sets/resets this user's login password to one they choose. Uses the
  // UserAdmin web app (holds the service key); creates the login if there's none.
  async function setPassword() {
    if (pw.length < 8) return
    setPwBusy(true); setPwMsg(''); setPwErr(false)
    // The UserAdmin endpoint finds the profile by email. If the email was edited
    // but not saved, persist it first so the lookup matches (avoids the
    // confusing "no roster profile with that email" error).
    if (user && form.email && form.email !== user.email) {
      const { error } = await updateUser(user.id, { email: form.email })
      if (error) { setPwBusy(false); setPwErr(true); setPwMsg('Could not update the email first: ' + error.message); return }
    }
    const action = user?.auth_id ? 'reset_password' : 'create_login'
    const r = await userAdmin(action, { email: form.email, password: pw })
    setPwBusy(false)
    if (!r?.ok) { setPwErr(true); setPwMsg(r?.error || 'Could not set password.'); return }
    setPwMsg(`Saved — ${form.name || 'they'} can sign in with: ${pw}`)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    await onSave({
      ...form,
      manager_id:  form.manager_id  || null,
      director_id: form.director_id || null,
      vp_id:       form.vp_id       || null,
    })
    setSaving(false)
  }

  const managers  = allUsers.filter(u => u.role === 'manager')
  const directors = allUsers.filter(u => u.role === 'director')
  const vps       = allUsers.filter(u => u.role === 'vp')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-lg rounded-2xl shadow-2xl overflow-y-auto"
        style={{ background: '#242424', border: '1px solid #333', maxHeight: '90vh' }}
      >
        <div
          className="flex items-center justify-between px-6 py-4 sticky top-0 z-10"
          style={{ background: '#242424', borderBottom: '1px solid #2e2e2e' }}
        >
          <h2 className="text-[15px] font-semibold text-white">
            {user ? 'Edit User' : 'Add User'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/10"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Full Name *">
              <Inp required value={form.name} onChange={e => set('name', e.target.value)} placeholder="Jane Smith" />
            </Field>
            <Field label="Email *">
              <Inp required type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="jane@company.com" />
            </Field>
            {!user && (
              <Field label="Password *">
                <Inp required type="password" value={form.password} onChange={e => set('password', e.target.value)} placeholder="••••••••" minLength={8} />
              </Field>
            )}
            <Field label="Role *">
              <Sel value={form.role} onChange={e => set('role', e.target.value)}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </Sel>
            </Field>
            <Field label="Company">
              <Inp value={form.company_name} onChange={e => set('company_name', e.target.value)} placeholder="Turf Time" />
            </Field>
            <Field label="Site Access">
              <button type="button" onClick={() => set('is_admin', !form.is_admin)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-[13px] transition-colors"
                style={{ background: '#1a1a1a', border: '1px solid #3a3a3a', color: form.is_admin ? '#00b894' : 'rgba(255,255,255,0.6)' }}>
                <span>Admin access {form.is_admin ? '— on' : '— off'}</span>
                <span className="w-9 h-5 rounded-full flex items-center px-0.5 transition-colors"
                  style={{ background: form.is_admin ? '#00b894' : '#3a3a3a', justifyContent: form.is_admin ? 'flex-end' : 'flex-start' }}>
                  <span className="w-4 h-4 rounded-full bg-white block" />
                </span>
              </button>
              <p className="text-[10px] text-white/30 mt-1">Full site/admin powers, independent of sales title.</p>
            </Field>
            <Field label="Visibility">
              <button type="button" onClick={() => set('ghost', !form.ghost)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-[13px] transition-colors"
                style={{ background: '#1a1a1a', border: '1px solid #3a3a3a', color: form.ghost ? '#a78bfa' : 'rgba(255,255,255,0.6)' }}>
                <span>Ghost {form.ghost ? '— on' : '— off'}</span>
                <span className="w-9 h-5 rounded-full flex items-center px-0.5 transition-colors"
                  style={{ background: form.ghost ? '#a78bfa' : '#3a3a3a', justifyContent: form.ghost ? 'flex-end' : 'flex-start' }}>
                  <span className="w-4 h-4 rounded-full bg-white block" />
                </span>
              </button>
              <p className="text-[10px] text-white/30 mt-1">Deals still count in all totals, but the name is hidden from non-admins on leaderboards, competitions, stats &amp; filters.</p>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <Field label="Assigned Manager">
              <Sel value={form.manager_id} onChange={e => set('manager_id', e.target.value)}>
                <option value="">None</option>
                {managers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Sel>
            </Field>
            <Field label="Assigned Director">
              <Sel value={form.director_id} onChange={e => set('director_id', e.target.value)}>
                <option value="">None</option>
                {directors.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Sel>
            </Field>
            <Field label="Assigned VP">
              <Sel value={form.vp_id} onChange={e => set('vp_id', e.target.value)}>
                <option value="">None</option>
                {vps.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Sel>
            </Field>
          </div>

          {user && (
            <div className="rounded-lg p-3 space-y-2" style={{ background: '#1a1a1a', border: '1px solid #2e2e2e' }}>
              <label className="block text-[10px] font-semibold text-white/30 uppercase tracking-widest">
                Login Password
              </label>
              {pwConfigured ? (
                <>
                  <div className="flex gap-2">
                    <Inp type="text" value={pw} onChange={e => { setPw(e.target.value); setPwMsg('') }}
                      placeholder="Type a password (min 8 chars)" minLength={8} />
                    <button type="button" onClick={setPassword} disabled={pwBusy || pw.length < 8}
                      className="px-3 py-2 rounded-lg text-[12px] font-bold text-dark bg-teal hover:bg-teal-dark disabled:opacity-50 whitespace-nowrap">
                      {pwBusy ? 'Saving…' : user.auth_id ? 'Set password' : 'Create login'}
                    </button>
                  </div>
                  <p className="text-[10px] text-white/30">
                    {user.auth_id
                      ? 'Sets a new password you choose — share it with them and reset it here anytime.'
                      : 'No login yet — this creates one with the password you choose.'}
                  </p>
                  {pwMsg && <p className={`text-[11px] ${pwErr ? 'text-red-400' : 'text-emerald-400'}`}>{pwMsg}</p>}
                </>
              ) : (
                <p className="text-[11px] text-white/40">
                  Set <code className="text-white/60">VITE_USER_ADMIN_URL</code> to manage passwords here, or use
                  Supabase Studio → Authentication → Users.
                </p>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-dark bg-teal hover:bg-teal-dark disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : user ? 'Save Changes' : 'Create User'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-[13px] text-white/50 hover:text-white transition-colors"
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
