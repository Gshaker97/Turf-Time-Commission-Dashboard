import { useState, useEffect, useMemo } from 'react'
import { Plus } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchDeals, fetchUsers, fetchPayments, insertDeal, updateDeal, deleteDeal } from '../lib/db'
import FilterBar from '../components/FilterBar'
import KpiCard from '../components/KpiCard'
import DealTable from '../components/DealTable'
import DealModal from '../components/DealModal'
import { calcDealCommissions, fmt } from '../utils/commission'
import { getPresetRange } from '../utils/dateRanges'

function sortValue(d, key) {
  if (key === 'setter')         return d.setter?.name ?? ''
  if (key === 'closer')         return d.closer?.name ?? ''
  if (key === 'commission')     return calcDealCommissions(d).repCommission
  if (key === 'commission_pct') return calcDealCommissions(d).commPct
  if (key === 'baseline_revenue' || key === 'job_price') return parseFloat(d[key]) || 0
  return d[key] ?? ''
}

export default function Deals() {
  const { profile } = useAuth()
  const [deals,    setDeals]    = useState([])
  const [payments, setPayments] = useState([])
  const [users,    setUsers]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [modal,    setModal]    = useState(false)
  const [editDeal, setEditDeal] = useState(null)

  const [repFilter,    setRepFilter]    = useState('')
  const [repRole,      setRepRole]      = useState('')   // '' = setter or closer, else 'setter' | 'closer'
  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dateField,    setDateField]    = useState('sale_date')  // which date the range applies to
  const [dateFrom,     setDateFrom]     = useState(getPresetRange('mtd').from)
  const [dateTo,       setDateTo]       = useState(getPresetRange('mtd').to)
  const [datePreset,   setDatePreset]   = useState('mtd')
  const [sortKey,      setSortKey]      = useState('sale_date')
  const [sortDir,      setSortDir]      = useState('desc')

  useEffect(() => { load() }, [])

  // quiet=true refetches without flipping the loading flag, so the table
  // updates in place instead of blanking out to a "Loading…" placeholder.
  async function load(quiet = false) {
    if (!quiet) setLoading(true)
    const [{ data: d }, { data: p }, { data: u }] = await Promise.all([
      fetchDeals(), fetchPayments(), fetchUsers(),
    ])
    setDeals(d ?? []); setPayments(p ?? []); setUsers(u ?? [])
    if (!quiet) setLoading(false)
  }

  // Patch one deal in local state — used for optimistic inline edits so the
  // change shows instantly without a round-trip + full reload.
  const patchDeal = (id, data) => setDeals(ds => ds.map(d => d.id === id ? { ...d, ...data } : d))

  const role = profile?.role

  const filtered = useMemo(() => {
    let rows = [...deals]
    if (role === 'rep') rows = rows.filter(d => d.setter_id === profile.id || d.closer_id === profile.id)
    if (repFilter) {
      rows = rows.filter(d =>
        repRole === 'setter' ? d.setter_id === repFilter
      : repRole === 'closer' ? d.closer_id === repFilter
      : (d.setter_id === repFilter || d.closer_id === repFilter))
    }
    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter(d => d.deal_name?.toLowerCase().includes(q) || d.office?.toLowerCase().includes(q) || d.project_id?.toLowerCase().includes(q))
    }
    if (statusFilter) rows = rows.filter(d => d.status === statusFilter)
    if (dateFrom)     rows = rows.filter(d => (d[dateField] ?? '') >= dateFrom)
    if (dateTo)       rows = rows.filter(d => (d[dateField] ?? '') && d[dateField] <= dateTo)
    rows.sort((a, b) => {
      let av = sortValue(a, sortKey), bv = sortValue(b, sortKey)
      if (typeof av === 'string') av = av.toLowerCase()
      if (typeof bv === 'string') bv = bv.toLowerCase()
      if (av !== bv) return sortDir === 'asc' ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1)
      // Tie-breaker: most recently added on top.
      const ac = a.created_at ?? '', bc = b.created_at ?? ''
      return ac < bc ? 1 : ac > bc ? -1 : 0
    })
    return rows
  }, [deals, profile, role, repFilter, repRole, search, statusFilter, dateField, dateFrom, dateTo, sortKey, sortDir])

  const kpis = useMemo(() => {
    let baseline = 0, totalComm = 0, totalJobPrice = 0, totalMarkupPct = 0
    for (const d of filtered) {
      const bl = parseFloat(d.baseline_revenue) || 0
      const jp = parseFloat(d.job_price) || 0
      const gross = jp - bl
      baseline += bl; totalComm += gross; totalJobPrice += jp
      if (bl > 0) totalMarkupPct += (gross / bl) * 100
    }
    const count = filtered.length
    return { baseline, totalComm, count, avgDeal: count ? totalJobPrice/count : 0, avgComm: count ? totalComm/count : 0, avgMarkupPct: count ? totalMarkupPct/count : 0 }
  }, [filtered])

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  // Attach the joined people objects the table renders (setter/closer/…names)
  // from the *_id fields in a save payload, so an optimistic row looks complete.
  const withJoins = (data) => ({
    ...data,
    setter:   users.find(u => u.id === data.setter_id)   ?? null,
    closer:   users.find(u => u.id === data.closer_id)   ?? null,
    manager:  users.find(u => u.id === data.manager_id)  ?? null,
    director: users.find(u => u.id === data.director_id) ?? null,
    vp:       users.find(u => u.id === data.vp_id)       ?? null,
  })

  async function handleSave(data) {
    if (editDeal) {
      // Optimistic edit — reflect the change immediately, then reconcile.
      setDeals(ds => ds.map(d => d.id === editDeal.id ? { ...d, ...withJoins(data) } : d))
      setModal(false); setEditDeal(null)
      const res = await updateDeal(editDeal.id, data)
      load(true)
      return
    }
    // New deal — show it instantly with a temp id, then reload to swap in the
    // real persisted row (real id, server-side defaults, etc.).
    setDeals(ds => [{ ...withJoins(data), id: 'temp-' + Date.now(), created_at: new Date().toISOString() }, ...ds])
    setModal(false); setEditDeal(null)
    await insertDeal(data, profile?.id)
    load(true)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this deal? This cannot be undone.')) return
    setDeals(ds => ds.filter(d => d.id !== id))   // optimistic remove
    const res = await deleteDeal(id)
    const deletedCount = Array.isArray(res?.data) ? res.data.length : 1
    if (res?.error || deletedCount === 0) {
      alert('Could not delete this deal — only an admin can delete deals. Sign in with the admin account to delete it, or have VP deletes enabled in the database.')
      load(true)                                   // bring the row back so the UI matches reality
    }
  }

  return (
    <div className="space-y-3 pb-32 md:pb-20">
      <FilterBar
        users={users}
        repFilter={repFilter}       setRepFilter={setRepFilter}
        repRole={repRole}           setRepRole={setRepRole}
        search={search}             setSearch={setSearch}
        statusFilter={statusFilter} setStatusFilter={setStatusFilter}
        dateField={dateField}       setDateField={setDateField}
        dateFrom={dateFrom}         setDateFrom={setDateFrom}
        dateTo={dateTo}             setDateTo={setDateTo}
        datePreset={datePreset}     setDatePreset={setDatePreset}
        recordCount={filtered.length}
      />

      {/* KPI row — 2-col on mobile */}
      <div className="grid grid-cols-2 gap-2 md:flex md:gap-3">
        <KpiCard label="Baseline Rev"  value={fmt(kpis.baseline)} />
        <KpiCard label="Commissions"   value={fmt(kpis.totalComm)} />
        <KpiCard label="Deals"         value={kpis.count} />
        <KpiCard label="Avg Deal"      value={fmt(kpis.avgDeal)} />
        <div className="col-span-2 md:flex-1">
          <KpiCard label="Avg Comm" value={fmt(kpis.avgComm)} sub={`${kpis.avgMarkupPct.toFixed(1)}% markup`} />
        </div>
      </div>

      <DealTable
        deals={filtered}
        payments={payments}
        profile={profile}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
        onEdit={d => { setEditDeal(d); setModal(true) }}
        onDelete={handleDelete}
        onUpdate={async (id, data) => {
          patchDeal(id, data)                       // optimistic — show instantly
          const res = await updateDeal(id, data)
          if (res?.error) load(true)                // resync quietly if it failed
        }}
        loading={loading}
      />

      {/* FAB — above bottom nav on mobile */}
      {role !== 'rep' && (
        <button
          onClick={() => { setEditDeal(null); setModal(true) }}
          className="fixed bottom-20 right-4 md:bottom-8 md:right-8 w-12 h-12 md:w-14 md:h-14 rounded-full bg-teal hover:bg-teal-dark flex items-center justify-center shadow-xl shadow-teal/30 hover:scale-105 transition-all z-40"
        >
          <Plus size={20} className="text-dark" strokeWidth={2.5} />
        </button>
      )}

      {modal && (
        <DealModal
          deal={editDeal}
          users={users}
          existingDeals={deals}
          onSave={handleSave}
          onClose={() => { setModal(false); setEditDeal(null) }}
        />
      )}
    </div>
  )
}
