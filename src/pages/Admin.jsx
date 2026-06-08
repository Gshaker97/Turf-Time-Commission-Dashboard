import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import {
  fetchDeals, fetchUsers, fetchPayments,
  insertDeal, updateDeal, deleteDeal,
  insertUser, updateUser, deleteUser, deletePayment,
} from '../lib/db'
import UserModal from '../components/UserModal'
import DealModal from '../components/DealModal'
import SettingsPanel from '../components/SettingsPanel'
import { DEMO_MODE } from '../lib/supabase'

const TABS = ['Users', 'Deals', 'Payments', 'Settings']

const ROLES = ['rep', 'manager', 'director', 'vp', 'admin']

const ROLE_COLOR = {
  vp: 'text-purple-400', director: 'text-indigo-400',
  manager: 'text-amber-400', rep: 'text-white/50', admin: 'text-teal',
}

// Click-to-edit text cell — shows the value; click turns it into an input that
// saves on blur/Enter (Esc cancels).
function EditableText({ value, onSave, placeholder }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value ?? '')
  useEffect(() => { setVal(value ?? '') }, [value])
  if (editing) {
    const commit = () => { setEditing(false); const v = val.trim(); if (v !== (value ?? '')) onSave(v) }
    return (
      <input autoFocus value={val} onChange={e => setVal(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setVal(value ?? ''); setEditing(false) } }}
        placeholder={placeholder} style={{ background: '#1a1a1a', border: '1px solid #3a3a3a' }}
        className="px-2 py-1 rounded-lg text-[13px] text-white w-full max-w-[200px] focus:outline-none" />
    )
  }
  return (
    <button onClick={() => setEditing(true)} className="text-left hover:text-teal transition-colors" title="Click to edit">
      {value || <span className="text-white/25">—</span>}
    </button>
  )
}

// Click-to-pick cell — an invisible <select> overlays the displayed value.
function EditableSelect({ value, options, onChange, children }) {
  return (
    <div className="relative inline-block cursor-pointer" title="Click to change">
      <span className="hover:text-teal transition-colors">{children}</span>
      <select value={value ?? ''} onChange={e => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer w-full">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

export default function Admin() {
  const { profile } = useAuth()
  const [tab,      setTab]      = useState('Users')
  const [users,    setUsers]    = useState([])
  const [deals,    setDeals]    = useState([])
  const [payments, setPayments] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [userModal, setUserModal] = useState(false)
  const [dealModal, setDealModal] = useState(false)
  const [editUser,  setEditUser]  = useState(null)
  const [editDeal,  setEditDeal]  = useState(null)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: u }, { data: d }, { data: p }] = await Promise.all([fetchUsers(), fetchDeals(), fetchPayments()])
    setUsers(u ?? []); setDeals(d ?? []); setPayments(p ?? [])
    setLoading(false)
  }

  async function saveUser(data) {
    if (editUser) {
      await updateUser(editUser.id, data)
    } else {
      const { error } = await insertUser(data)
      if (error) { alert('Could not create profile: ' + error.message); return }
      if (!DEMO_MODE) {
        alert(
          'Profile created.\n\nTo enable their login, go to Supabase Studio → Authentication → Users → Add user, ' +
          'using the SAME email. The auto-link trigger connects the new auth user to this profile.'
        )
      }
    }
    setUserModal(false); setEditUser(null); loadAll()
  }

  async function handleDeleteUser(id) {
    if (!confirm('Delete this user?')) return
    await deleteUser(id); loadAll()
  }

  // Optimistic single-field update for inline editing in the Users table.
  async function patchUser(id, patch) {
    setUsers(us => us.map(x => x.id === id ? { ...x, ...patch } : x))
    const res = await updateUser(id, patch)
    if (res?.error) { alert('Could not update: ' + (res.error.message || '')); loadAll() }
  }

  // Quick inline toggle of a user's ghost flag (hide from non-admins).
  async function toggleGhost(u) {
    patchUser(u.id, { ghost: !u.ghost })
  }

  async function saveDeal(data) {
    if (editDeal) await updateDeal(editDeal.id, data)
    else await insertDeal(data, profile?.id)
    setDealModal(false); setEditDeal(null); loadAll()
  }

  async function handleDeleteDeal(id) {
    if (!confirm('Delete this deal? This cannot be undone.')) return
    await deleteDeal(id); loadAll()
  }

  async function handleDeletePayment(id) {
    if (!confirm('Remove this payment record?')) return
    await deletePayment(id); loadAll()
  }

  const btnCls = (active) =>
    `px-3 py-1.5 rounded-lg text-[12px] md:text-[13px] font-medium transition-colors ${
      active ? 'bg-teal/15 text-teal border border-teal/25' : 'text-white/40 hover:text-white hover:bg-white/5 border border-transparent'
    }`

  const card  = { background: '#242424', border: '1px solid #2e2e2e' }
  const thead = { background: '#00b894' }
  const managerOptions = users.filter(u => u.role === 'manager').map(m => ({ value: m.id, label: m.name }))

  return (
    <div className="space-y-4 pb-8">

      {/* Tab bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {TABS.map(t => <button key={t} onClick={() => setTab(t)} className={btnCls(tab === t)}>{t}</button>)}
        <button onClick={loadAll} className="ml-auto p-2 rounded-lg text-white/30 hover:text-white hover:bg-white/5 transition-colors">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ── USERS ── */}
      {tab === 'Users' && (
        <div>
          <div className="flex justify-between items-center mb-3">
            <p className="text-[12px] text-white/40">{users.length} users</p>
            <button onClick={() => { setEditUser(null); setUserModal(true) }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-bold text-dark bg-teal transition-colors">
              <Plus size={13} /> Add User
            </button>
          </div>

          {/* Mobile: card list */}
          <div className="md:hidden rounded-xl overflow-hidden" style={card}>
            {users.length === 0 && <p className="px-4 py-6 text-white/30 text-[13px]">No users.</p>}
            <div className="divide-y divide-white/5">
              {users.map(u => {
                const mgr = users.find(x => x.id === u.manager_id)
                return (
                  <div key={u.id} className="px-4 py-3 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[13px] font-semibold text-white">{u.name}</p>
                        <span className={`text-[10px] font-bold uppercase ${ROLE_COLOR[u.role]}`}>{u.role}</span>
                        {u.ghost && <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full" style={{ color: '#a78bfa', border: '1px solid #a78bfa55' }}>Ghost</span>}
                      </div>
                      <p className="text-[11px] text-white/40 mt-0.5 truncate">{u.email}</p>
                      {mgr && <p className="text-[11px] text-white/30 mt-0.5">Mgr: {mgr.name}</p>}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => { setEditUser(u); setUserModal(true) }}
                        className="p-1.5 rounded text-white/30 hover:text-teal hover:bg-teal/10 transition-colors">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => handleDeleteUser(u.id)}
                        className="p-1.5 rounded text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block rounded-xl overflow-hidden" style={card}>
            <table className="w-full">
              <thead>
                <tr style={thead}>
                  {['Name','Email','Role','Company','Manager','Ghost','Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-dark uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => {
                  const mgr = users.find(x => x.id === u.manager_id)
                  return (
                    <tr key={u.id} style={{ background: i%2===0?'#242424':'#262626' }} className="hover:bg-white/[0.03]">
                      <td className="px-4 py-3 text-[13px] font-semibold text-white">
                        <EditableText value={u.name} onSave={v => patchUser(u.id, { name: v })} placeholder="Name" />
                      </td>
                      <td className="px-4 py-3 text-[13px] text-white/50">
                        <EditableText value={u.email} onSave={v => patchUser(u.id, { email: v })} placeholder="Email" />
                      </td>
                      <td className="px-4 py-3">
                        <EditableSelect value={u.role} options={ROLES.map(r => ({ value: r, label: r }))}
                          onChange={v => patchUser(u.id, { role: v })}>
                          <span className={`text-[12px] font-semibold uppercase ${ROLE_COLOR[u.role]}`}>{u.role}</span>
                        </EditableSelect>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-white/50">
                        <EditableText value={u.company_name} onSave={v => patchUser(u.id, { company_name: v })} placeholder="Company" />
                      </td>
                      <td className="px-4 py-3 text-[13px] text-white/50">
                        <EditableSelect value={u.manager_id ?? ''}
                          options={[{ value: '', label: '— None' }, ...managerOptions]}
                          onChange={v => patchUser(u.id, { manager_id: v || null })}>
                          {mgr?.name ?? <span className="text-white/25">—</span>}
                        </EditableSelect>
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => toggleGhost(u)} title={u.ghost ? 'Visible to admins only — click to unhide' : 'Click to hide from non-admins'}
                          className="w-9 h-5 rounded-full flex items-center px-0.5 transition-colors"
                          style={{ background: u.ghost ? '#a78bfa' : '#3a3a3a', justifyContent: u.ghost ? 'flex-end' : 'flex-start' }}>
                          <span className="w-4 h-4 rounded-full bg-white block" />
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          <button onClick={() => { setEditUser(u); setUserModal(true) }}
                            className="p-1.5 rounded text-white/30 hover:text-teal hover:bg-teal/10 transition-colors"><Pencil size={13} /></button>
                          <button onClick={() => handleDeleteUser(u.id)}
                            className="p-1.5 rounded text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── DEALS ── */}
      {tab === 'Deals' && (
        <div>
          <div className="flex justify-between items-center mb-3">
            <p className="text-[12px] text-white/40">{deals.length} deals</p>
            <button onClick={() => { setEditDeal(null); setDealModal(true) }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-bold text-dark bg-teal transition-colors">
              <Plus size={13} /> Add Deal
            </button>
          </div>

          {/* Mobile: card list */}
          <div className="md:hidden rounded-xl overflow-hidden" style={card}>
            {deals.length === 0 && <p className="px-4 py-6 text-white/30 text-[13px]">No deals.</p>}
            <div className="divide-y divide-white/5">
              {deals.map(d => (
                <div key={d.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-white truncate">{d.deal_name}</p>
                    <p className="text-[11px] text-white/40 mt-0.5">{d.sale_date} · {d.status}</p>
                    <p className="text-[11px] text-white/30 mt-0.5">
                      {d.setter?.name ?? '—'} / {d.closer?.name ?? '—'}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[13px] font-bold text-teal">${parseFloat(d.job_price).toLocaleString()}</p>
                    <div className="flex gap-1 mt-1 justify-end">
                      <button onClick={() => { setEditDeal(d); setDealModal(true) }}
                        className="p-1.5 rounded text-white/30 hover:text-teal hover:bg-teal/10 transition-colors"><Pencil size={13} /></button>
                      <button onClick={() => handleDeleteDeal(d.id)}
                        className="p-1.5 rounded text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 size={13} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Desktop: scrollable table */}
          <div className="hidden md:block rounded-xl overflow-hidden" style={card}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={thead}>
                    {['Deal Name','Date','Status','Setter','Closer','Job Price','Baseline','Actions'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-dark uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deals.map((d, i) => (
                    <tr key={d.id} style={{ background: i%2===0?'#242424':'#262626' }} className="hover:bg-white/[0.03]">
                      <td className="px-4 py-3 text-[13px] font-semibold text-white whitespace-nowrap">{d.deal_name}</td>
                      <td className="px-4 py-3 text-[13px] text-white/50 whitespace-nowrap">{d.sale_date}</td>
                      <td className="px-4 py-3 text-[12px] font-semibold text-white/60 whitespace-nowrap">{d.status}</td>
                      <td className="px-4 py-3 text-[13px] text-white/50 whitespace-nowrap">{d.setter?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-[13px] text-white/50 whitespace-nowrap">{d.closer?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-[13px] font-bold text-teal whitespace-nowrap">${parseFloat(d.job_price).toLocaleString()}</td>
                      <td className="px-4 py-3 text-[13px] text-white/50 whitespace-nowrap">${parseFloat(d.baseline_revenue).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          <button onClick={() => { setEditDeal(d); setDealModal(true) }}
                            className="p-1.5 rounded text-white/30 hover:text-teal hover:bg-teal/10 transition-colors"><Pencil size={13} /></button>
                          <button onClick={() => handleDeleteDeal(d.id)}
                            className="p-1.5 rounded text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── PAYMENTS ── */}
      {tab === 'Payments' && (
        <div>
          <p className="text-[12px] text-white/40 mb-3">{payments.length} payment records</p>

          {/* Mobile: card list */}
          <div className="md:hidden rounded-xl overflow-hidden" style={card}>
            {payments.length === 0 && <p className="px-4 py-6 text-white/30 text-[13px]">No payments.</p>}
            <div className="divide-y divide-white/5">
              {payments.map(p => (
                <div key={p.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-bold text-teal">${parseFloat(p.amount).toLocaleString()}</p>
                      <p className="text-[12px] font-semibold text-white">{p.user?.name ?? '—'}</p>
                    </div>
                    <p className="text-[11px] text-white/40 mt-0.5">{p.pay_date} · {p.deal?.deal_name ?? '—'}</p>
                    {p.notes && <p className="text-[11px] text-white/30 mt-0.5">{p.notes}</p>}
                  </div>
                  <button onClick={() => handleDeletePayment(p.id)}
                    className="p-1.5 rounded text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block rounded-xl overflow-hidden" style={card}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={thead}>
                    {['Pay Date','User','Deal','Amount','Notes','Delete'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-dark uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p, i) => (
                    <tr key={p.id} style={{ background: i%2===0?'#242424':'#262626' }} className="hover:bg-white/[0.03]">
                      <td className="px-4 py-3 text-[13px] text-white/60">{p.pay_date}</td>
                      <td className="px-4 py-3 text-[13px] font-medium text-white">{p.user?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-[13px] text-white/60">{p.deal?.deal_name ?? '—'}</td>
                      <td className="px-4 py-3 text-[13px] font-bold text-teal">${parseFloat(p.amount).toLocaleString()}</td>
                      <td className="px-4 py-3 text-[13px] text-white/40">{p.notes ?? '—'}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => handleDeletePayment(p.id)}
                          className="p-1.5 rounded text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── SETTINGS ── */}
      {tab === 'Settings' && <SettingsPanel />}

      {userModal && <UserModal user={editUser} allUsers={users} onSave={saveUser} onClose={() => { setUserModal(false); setEditUser(null) }} />}
      {dealModal && <DealModal deal={editDeal} users={users} onSave={saveDeal} onClose={() => { setDealModal(false); setEditDeal(null) }} />}
    </div>
  )
}
