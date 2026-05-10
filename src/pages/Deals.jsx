import { useState, useEffect, useMemo } from 'react'
import { Plus } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchDeals, fetchUsers, fetchPayments, insertDeal, updateDeal, deleteDeal } from '../lib/db'
import FilterBar from '../components/FilterBar'
import KpiCard from '../components/KpiCard'
import DealTable from '../components/DealTable'
import DealModal from '../components/DealModal'
import { calcDealCommissions, fmt } from '../utils/commission'

function sortValue(d, key) {
  if (key === 'setter')           return d.setter?.name ?? ''
  if (key === 'closer')           return d.closer?.name ?? ''
  if (key === 'commission')       return calcDealCommissions(d).gross
  if (key === 'commission_pct')   return calcDealCommissions(d).commPct
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

  // Filters
  const [repFilter,    setRepFilter]    = useState('')
  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dateFrom,     setDateFrom]     = useState('')
  const [dateTo,       setDateTo]       = useState('')


  // Sort
  const [sortKey, setSortKey] = useState('sale_date')
  const [sortDir, setSortDir] = useState('desc')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: d }, { data: p }, { data: u }] = await Promise.all([
      fetchDeals(),
      fetchPayments(),
      fetchUsers(),
    ])
    setDeals(d ?? [])
    setPayments(p ?? [])
    setUsers(u ?? [])
    setLoading(false)
  }

  const role = profile?.role

  const filtered = useMemo(() => {
    let rows = [...deals]

    // Reps see only their own deals
    if (role === 'rep') {
      rows = rows.filter(d => d.setter_id === profile.id || d.closer_id === profile.id)
    }

    if (repFilter)
      rows = rows.filter(d => d.setter_id === repFilter || d.closer_id === repFilter)

    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter(d =>
        d.deal_name?.toLowerCase().includes(q) ||
        d.office?.toLowerCase().includes(q) ||
        d.project_id?.toLowerCase().includes(q)
      )
    }

    if (statusFilter) rows = rows.filter(d => d.status === statusFilter)
    if (dateFrom)     rows = rows.filter(d => d.sale_date >= dateFrom)
    if (dateTo)       rows = rows.filter(d => d.sale_date <= dateTo)

    rows.sort((a, b) => {
      let av = sortValue(a, sortKey), bv = sortValue(b, sortKey)
      if (typeof av === 'string') av = av.toLowerCase()
      if (typeof bv === 'string') bv = bv.toLowerCase()
      return sortDir === 'asc' ? (av < bv ? -1 : av > bv ? 1 : 0)
                                : (av > bv ? -1 : av < bv ? 1 : 0)
    })

    return rows
  }, [deals, profile, role, repFilter, search, statusFilter, dateFrom, dateTo, sortKey, sortDir])

  const kpis = useMemo(() => {
    let baseline = 0, totalComm = 0, totalJobPrice = 0, totalMarkupPct = 0
    for (const d of filtered) {
      const bl  = parseFloat(d.baseline_revenue) || 0
      const jp  = parseFloat(d.job_price) || 0
      const gross = jp - bl
      baseline      += bl
      totalComm     += gross
      totalJobPrice += jp
      if (bl > 0) totalMarkupPct += (gross / bl) * 100
    }

    const count        = filtered.length
    const avgDeal      = count > 0 ? totalJobPrice / count : 0
    const avgComm      = count > 0 ? totalComm / count : 0
    const avgMarkupPct = count > 0 ? totalMarkupPct / count : 0

    return { baseline, totalComm, count, avgDeal, avgComm, avgMarkupPct }
  }, [filtered])

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  async function handleSave(data) {
    if (editDeal) {
      await updateDeal(editDeal.id, data)
    } else {
      await insertDeal(data, profile?.id)
    }
    setModal(false)
    setEditDeal(null)
    load()
  }

  async function handleDelete(id) {
    if (!confirm('Delete this deal? This cannot be undone.')) return
    await deleteDeal(id)
    load()
  }

  return (
    <div className="space-y-4 pb-20">
      <FilterBar
        users={users}
        repFilter={repFilter}       setRepFilter={setRepFilter}
        search={search}             setSearch={setSearch}
        statusFilter={statusFilter} setStatusFilter={setStatusFilter}
        dateFrom={dateFrom}         setDateFrom={setDateFrom}
        dateTo={dateTo}             setDateTo={setDateTo}
        recordCount={filtered.length}
      />

      {/* KPI row */}
      <div className="flex gap-3">
        <KpiCard label="Total Baseline Revenue" value={fmt(kpis.baseline)} />
        <KpiCard label="Total Commissions"      value={fmt(kpis.totalComm)} />
        <KpiCard label="Total Deals"            value={kpis.count} />
        <KpiCard label="Avg Deal Size"          value={fmt(kpis.avgDeal)} />
        <KpiCard label="Avg Commission" value={fmt(kpis.avgComm)} sub={`${kpis.avgMarkupPct.toFixed(1)}% avg markup`} />
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
        onUpdate={async (id, data) => { await updateDeal(id, data); load() }}
        loading={loading}
      />

      {/* FAB — hide for reps */}
      {role !== 'rep' && (
        <button
          onClick={() => { setEditDeal(null); setModal(true) }}
          className="fixed bottom-8 right-8 w-14 h-14 rounded-full bg-teal hover:bg-teal-dark flex items-center justify-center shadow-xl shadow-teal/30 hover:scale-105 transition-all z-40"
        >
          <Plus size={24} className="text-dark" strokeWidth={2.5} />
        </button>
      )}

      {modal && (
        <DealModal
          deal={editDeal}
          users={users}
          onSave={handleSave}
          onClose={() => { setModal(false); setEditDeal(null) }}
        />
      )}
    </div>
  )
}
