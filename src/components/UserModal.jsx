import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { userAdmin, userAdminConfigured } from '../lib/db'
import { SURFACE, GOLD_WASH, FieldLabel, Input, Select, PrimaryButton, SecondaryButton, IconButton } from '../components/ui'

const ROLES = ['rep', 'manager', 'director', 'vp', 'admin']

// Shared controls on the "well" surface so the inputs sit inside the card.
const Inp = (p) => <Input {...p} style={SURFACE.well} />
const Sel = ({ children, ...p }) => <Select {...p} style={SURFACE.well}>{children}</Select>
const Field = ({ label, children }) => (
  <div>
    <FieldLabel>{label}</FieldLabel>
    {children}
  </div>
)
// On/off switch — gold is the active state.
const Toggle = ({ on, onClick, label }) => (
  <button type="button" onClick={onClick} aria-pressed={on}
    className={`w-full flex items-center justify-between px-3 py-2 min-h-[44px] md:min-h-0 md:h-9 rounded-lg text-[13px] transition-colors ${on ? 'text-bank-gold-tx' : 'text-bank-mu'}`}
    style={on ? GOLD_WASH : SURFACE.well}>
    <span>{label}</span>
    <span className="w-9 h-5 rounded-full flex items-center px-0.5 transition-colors flex-shrink-0"
      style={{ background: on ? 'var(--gold)' : 'var(--line)', justifyContent: on ? 'flex-end' : 'flex-start' }}>
      <span className="w-4 h-4 rounded-full block" style={{ background: on ? 'var(--gold-ink)' : 'var(--tx)' }} />
    </span>
  </button>
)

const BLANK = {
  name: '', email: '', role: 'rep', company_name: 'Turf Time',
  manager_id: '', director_id: '', vp_id: '',
  is_admin: false, ghost: false,
  password: '',
}

export default function UserModal({ user, allUsers = [], teamChanges = [], onSave, onClose }) {
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
    // The endpoint finds the profile by email. If the email was edited but not
    // saved, push it through change_email first (updates the LOGIN + profile
    // together) so the lookup matches and login/email never diverge.
    if (user && form.email && form.email !== user.email) {
      const r0 = await userAdmin('change_email', { email: user.email, newEmail: form.email })
      if (!r0?.ok) { setPwBusy(false); setPwErr(true); setPwMsg('Could not update the email first: ' + (r0?.error || 'unknown error')); return }
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
  // "Reports to" can be a manager, director, or VP — some reps are managed
  // directly by a director (e.g. Garrison). Drives Team-page grouping, goal
  // permissions, and (managers only) the deal's manager-override default.
  const leads     = [...managers, ...directors, ...vps]

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center md:justify-center md:p-4">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(3px)' }} onClick={onClose} />
      <div
        className="relative w-full md:max-w-lg h-[100dvh] md:h-auto md:max-h-[90vh] rounded-none md:rounded-2xl overflow-y-auto flex flex-col"
        style={{ ...SURFACE.card, boxShadow: 'var(--card-shadow), 0 24px 60px rgba(0,0,0,0.55)', color: 'var(--tx)' }}
        role="dialog" aria-modal="true" aria-label={user ? 'Edit user' : 'Add user'}
      >
        <div
          className="flex items-center justify-between px-5 py-3 sticky top-0 z-10"
          style={{ background: 'var(--card)', borderBottom: '1px solid var(--line)' }}
        >
          <h2 className="text-[15px] font-bold text-bank-tx">
            {user ? 'Edit User' : 'Add User'}
          </h2>
          <IconButton onClick={onClose} aria-label="Close"><X size={16} /></IconButton>
        </div>

        <form onSubmit={handleSubmit} className="p-5 flex-1 flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              <Toggle on={form.is_admin} onClick={() => set('is_admin', !form.is_admin)} label={`Admin access ${form.is_admin ? '— on' : '— off'}`} />
              <p className="text-[13px] text-bank-fa mt-1">Full site/admin powers, independent of sales title.</p>
            </Field>
            <Field label="Visibility">
              <Toggle on={form.ghost} onClick={() => set('ghost', !form.ghost)} label={`Ghost ${form.ghost ? '— on' : '— off'}`} />
              <p className="text-[13px] text-bank-fa mt-1">Deals still count in all totals, but the name is hidden from non-admins on leaderboards, competitions, stats &amp; filters.</p>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <Field label="Reports To">
              <Sel value={form.manager_id} onChange={e => set('manager_id', e.target.value)}>
                <option value="">None</option>
                {leads.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
              </Sel>
              <p className="text-[13px] text-bank-fa mt-1">Their team lead — a manager, director, or VP. Groups them on the Team page and lets that person set their goals. Manager overrides on deals only apply when this is a manager.</p>
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
            <div className="rounded-xl p-3 space-y-2" style={SURFACE.raise}>
              <FieldLabel className="mb-0">Login Password</FieldLabel>
              {pwConfigured ? (
                <>
                  <div className="flex gap-2 flex-wrap">
                    <Inp type="text" value={pw} onChange={e => { setPw(e.target.value); setPwMsg('') }}
                      placeholder="Type a password (min 8 chars)" minLength={8} className="flex-1 !w-auto min-w-[180px]" />
                    <PrimaryButton type="button" onClick={setPassword} disabled={pwBusy || pw.length < 8} className="px-3 py-2 min-h-[44px] md:min-h-0 whitespace-nowrap">
                      {pwBusy ? 'Saving…' : user.auth_id ? 'Set password' : 'Create login'}
                    </PrimaryButton>
                  </div>
                  <p className="text-[13px] text-bank-fa">
                    {user.auth_id
                      ? 'Sets a new password you choose — share it with them and reset it here anytime.'
                      : 'No login yet — this creates one with the password you choose.'}
                  </p>
                  {pwMsg && <p className="text-[13px]" style={{ color: pwErr ? 'var(--neg)' : 'var(--pos)' }}>{pwMsg}</p>}
                </>
              ) : (
                <p className="text-[13px] text-bank-mu">
                  Set <code className="text-bank-tx">SUPABASE_SERVICE_KEY</code> on the site service to manage passwords here, or use
                  Supabase Studio → Authentication → Users.
                </p>
              )}
            </div>
          )}

          {user && (
            <div className="rounded-xl p-3" style={SURFACE.raise}>
              <FieldLabel className="mb-2">Team History</FieldLabel>
              {(() => {
                const nameOf = (id) => (id ? (allUsers.find(u => u.id === id)?.name ?? '—') : 'Unassigned')
                const moves = teamChanges
                  .filter(c => c.profile_id === user.id)
                  .sort((a, b) => String(b.changed_at).localeCompare(String(a.changed_at)))
                if (!moves.length) {
                  return <p className="text-[13px] text-bank-mu">No team moves recorded — reporting to {nameOf(user.manager_id)} since before the change log began.</p>
                }
                return (
                  <div className="space-y-1.5">
                    {/* Current state first, then each dated move (newest → oldest).
                        These dates are what the site's numbers attribute by:
                        sales before a move stay with the old team. */}
                    <p className="text-[13px] text-bank-tx">
                      <span className="font-semibold">Now:</span> reports to {nameOf(user.manager_id)}
                      <span className="text-bank-fa"> · since {String(moves[0].changed_at).slice(0, 10)}</span>
                    </p>
                    {moves.map(c => (
                      <p key={c.id} className="text-[13px] text-bank-mu">
                        <span className="text-bank-fa">{String(c.changed_at).slice(0, 10)}:</span>{' '}
                        {nameOf(c.old_manager_id)} <span className="text-bank-fa">→</span> {nameOf(c.new_manager_id)}
                        {c.changed_by ? <span className="text-bank-fa"> · by {nameOf(c.changed_by)}</span> : null}
                      </p>
                    ))}
                    <p className="text-[13px] text-bank-fa pt-0.5">Sales and overrides attribute to teams by these dates — deals before a move stay with the old team.</p>
                  </div>
                )
              })()}
            </div>
          )}

          <div className="sticky bottom-0 -mx-5 md:mx-0 px-5 md:px-0 pt-3 mt-auto flex gap-3 md:static"
            style={{ background: 'var(--card)', borderTop: '1px solid var(--line)', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
            <PrimaryButton type="submit" disabled={saving} className="flex-1">
              {saving ? 'Saving…' : user ? 'Save Changes' : 'Create User'}
            </PrimaryButton>
            <SecondaryButton type="button" onClick={onClose} className="px-5 min-h-[44px]">Cancel</SecondaryButton>
          </div>
        </form>
      </div>
    </div>
  )
}
