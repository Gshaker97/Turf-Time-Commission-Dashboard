import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import {
  fetchDeals, fetchUsers, fetchPayments,
  insertDeal, updateDeal, deleteDeal,
  updateUser, deleteUser, deletePayment,
} from '../lib/db'
import UserModal from '../components/UserModal'
import DealModal from '../components/DealModal'

const TABS = ['Users', 'Deals', 'Payments']

const ROLE_COLOR = {
  vp: 'text-purple-400', director: 'text-indigo-400',
  manager: 'text-amber-400', rep: 'text-white/50', admin: 'text-teal',
}

export default function Admin() {
  const { profile } = useAuth()
  const [tab,      setTab]      = useState('Users')
  const [users,    setUsers]    = useState([])
  const [deals,    setDeals]    = useState([])
  const [payments, setPayments] = useState([])
  const [loading,  setLoading]  = useState(true)

  // Modals
  const [userModal, setUserModal] = useState(false)
  const [dealModal, setDealModal] = useState(false)
  const [editUser,  setEditUser]  = useState(null)
  const [editDeal,  setEditDeal]  = useState(null)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: u }, { data: d }, { data: p }] = await Promise.all([
      fetchUsers(),
      fetchDeals(),
      fetchPayments(),
    ])
    setUsers(u ?? [])
    setDeals(d ?? [])
    setPayments(p ?? [])
    setLoading(false)
  }

  // ── User actions ────────────────────────────────────────────
  async function saveUser(data) {
    if (editUser) {
      await updateUser(editUser.id, data)
    } else {
      // In demo mode: add to local state
      // In live mode: direct Supabase admin user creation isn't client-side safe;
      // direct users to Supabase Dashboard or a server-side function.
      const { DEMO_MODE } = await import('../lib/supabase')
      if (!DEMO_MODE) {
        alert('User creation in live mode requires a server-side admin action.\nCreate the user in the Supabase Dashboard → Auth → Users, then edit their profile here.')
        setUserModal(false)
        return
      }
      const { DEMO_USERS } = await import('../lib/demoData')
      const id = 'u-new-' + Math.random().toString(36).slice(2, 7)
      DEMO_USERS.push({ ...data, id })
    }
    setUserModal(false)
    setEditUser(null)
    loadAll()
  }

  async function handleDeleteUser(id) {
    if (!confirm('Delete this user? This will also remove their profile.')) return
    await deleteUser(id)
    loadAll()
  }

  // ── Deal actions ────────────────────────────────────────────
  async function saveDeal(data) {
    if (editDeal) {
      await updateDeal(editDeal.id, data)
    } else {
      await insertDeal(data, profile?.id)
    }
    setDealModal(false)
    setEditDeal(null)
    loadAll()
  }

  async function handleDeleteDeal(id) {
    if (!confirm('Delete this deal? This cannot be undone.')) return
    await deleteDeal(id)
    loadAll()
  }

  async function handleDeletePayment(id) {
    if (!confirm('Remove this payment record?')) return
    await deletePayment(id)
    loadAll()
  }

  const btnCls = (active) =>
    `px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${
      active
        ? 'bg-teal/15 text-teal border border-teal/25'
        : 'text-white/40 hover:text-white hover:bg-white/5 border border-transparent'
    }`

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex items-center gap-2">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} className={btnCls(tab === t)}>
            {t}
          </button>
        ))}
        <button
          onClick={loadAll}
          className="ml-auto p-2 rounded-lg text-white/30 hover:text-white hover:bg-white/5 transition-colors"
          title="Refresh"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ── USERS TAB ─────────────────────────────────── */}
      {tab === 'Users' && (
        <div>
          <div className="flex justify-between items-center mb-3">
            <p className="text-[13px] text-white/40">{users.length} users</p>
            <button
              onClick={() => { setEditUser(null); setUserModal(true) }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-bold text-dark bg-teal hover:bg-teal-dark transition-colors"
            >
              <Plus size={14} /> Add User
            </button>
          </div>

          <div className="rounded-xl overflow-hidden"
            style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
            <table className="w-full">
              <thead>
                <tr style={{ background: '#00b894' }}>
                  {['Name','Email','Role','Company','Manager','Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-dark uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => {
                  const mgr = users.find(x => x.id === u.manager_id)
                  return (
                    <tr key={u.id}
                      style={{ background: i%2===0 ? '#242424' : '#262626' }}
                      className="hover:bg-white/[0.03] transition-colors"
                    >
                      <td className="px-4 py-3 text-[13px] font-semibold text-white">{u.name}</td>
                      <td className="px-4 py-3 text-[13px] text-white/50">{u.email}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[12px] font-semibold uppercase ${ROLE_COLOR[u.role]}`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-white/50">{u.company_name}</td>
                      <td className="px-4 py-3 text-[13px] text-white/50">{mgr?.name ?? '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          <button onClick={() => { setEditUser(u); setUserModal(true) }}
                            className="p-1.5 rounded text-white/30 hover:text-teal hover:bg-teal/10 transition-colors">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => handleDeleteUser(u.id)}
                            className="p-1.5 rounded text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                            <Trash2 size={13} />
                          </button>
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

      {/* ── DEALS TAB ─────────────────────────────────── */}
      {tab === 'Deals' && (
        <div>
          <div className="flex justify-between items-center mb-3">
            <p className="text-[13px] text-white/40">{deals.length} deals</p>
            <button
              onClick={() => { setEditDeal(null); setDealModal(true) }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-bold text-dark bg-teal hover:bg-teal-dark transition-colors"
            >
              <Plus size={14} /> Add Deal
            </button>
          </div>

          <div className="rounded-xl overflow-hidden"
            style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ background: '#00b894' }}>
                    {['Deal Name','Date','Status','Setter','Closer','Job Price','Baseline','Actions'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-dark uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deals.map((d, i) => (
                    <tr key={d.id}
                      style={{ background: i%2===0 ? '#242424' : '#262626' }}
                      className="hover:bg-white/[0.03] transition-colors"
                    >
                      <td className="px-4 py-3 text-[13px] font-semibold text-white whitespace-nowrap">{d.deal_name}</td>
                      <td className="px-4 py-3 text-[13px] text-white/50 whitespace-nowrap">{d.sale_date}</td>
                      <td className="px-4 py-3 text-[12px] font-semibold text-white/60 whitespace-nowrap">{d.status}</td>
                      <td className="px-4 py-3 text-[13px] text-white/50 whitespace-nowrap">{d.setter?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-[13px] text-white/50 whitespace-nowrap">{d.closer?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-[13px] font-bold text-teal whitespace-nowrap">
                        ${parseFloat(d.job_price).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-white/50 whitespace-nowrap">
                        ${parseFloat(d.baseline_revenue).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          <button onClick={() => { setEditDeal(d); setDealModal(true) }}
                            className="p-1.5 rounded text-white/30 hover:text-teal hover:bg-teal/10 transition-colors">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => handleDeleteDeal(d.id)}
                            className="p-1.5 rounded text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                            <Trash2 size={13} />
                          </button>
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

      {/* ── PAYMENTS TAB ──────────────────────────────── */}
      {tab === 'Payments' && (
        <div>
          <p className="text-[13px] text-white/40 mb-3">{payments.length} payment records</p>
          <div className="rounded-xl overflow-hidden"
            style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
            <table className="w-full">
              <thead>
                <tr style={{ background: '#00b894' }}>
                  {['Pay Date','User','Deal','Amount','Notes','Delete'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-dark uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payments.map((p, i) => (
                  <tr key={p.id}
                    style={{ background: i%2===0 ? '#242424' : '#262626' }}
                    className="hover:bg-white/[0.03] transition-colors"
                  >
                    <td className="px-4 py-3 text-[13px] text-white/60">{p.pay_date}</td>
                    <td className="px-4 py-3 text-[13px] font-medium text-white">{p.user?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-[13px] text-white/60">{p.deal?.deal_name ?? '—'}</td>
                    <td className="px-4 py-3 text-[13px] font-bold text-teal">${parseFloat(p.amount).toLocaleString()}</td>
                    <td className="px-4 py-3 text-[13px] text-white/40">{p.notes ?? '—'}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => handleDeletePayment(p.id)}
                        className="p-1.5 rounded text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {userModal && (
        <UserModal
          user={editUser}
          allUsers={users}
          onSave={saveUser}
          onClose={() => { setUserModal(false); setEditUser(null) }}
        />
      )}
      {dealModal && (
        <DealModal
          deal={editDeal}
          users={users}
          onSave={saveDeal}
          onClose={() => { setDealModal(false); setEditDeal(null) }}
        />
      )}
    </div>
  )
}
