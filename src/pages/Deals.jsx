import { useState, useEffect, useMemo, useRef } from 'react'
import { Plus } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchDeals, fetchUsers, fetchPayments, insertDeal, updateDeal, deleteDeal } from '../lib/db'
import FilterBar from '../components/FilterBar'
import KpiCard from '../components/KpiCard'
import DealTable, { dealNeedsReview } from '../components/DealTable'
import DealModal from '../components/DealModal'
import { calcDealCommissions, dealAmounts, fmt, isCanceled } from '../utils/commission'
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
  const { profile, isAdmin } = useAuth()

  const [deals,    setDeals]    = useState([])
  const [payments, setPayments] = useState([])
  const [users,    setUsers]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [modal,    setModal]    = useState(false)
  const [editDeal, setEditDeal] = useState(null)

  const [repFilter,     setRepFilter]     = useState('')
  const [search,        setSearch]        = useState('')
  const [statusFilter,  setStatusFilter]  = useState('')
  const [officeFilter,  setOfficeFilter]  = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [dateField,     setDateField]     = useState('sale_date')  // which date the range applies to
  const [dateFrom,      setDateFrom]      = useState(getPresetRange('mtd').from)
  const [dateTo,        setDateTo]        = useState(getPresetRange('mtd').to)
  const [datePreset,    setDatePreset]    = useState('mtd')
  const setDateRange = (from, to, preset) => { setDateFrom(from); setDateTo(to); setDatePreset(preset) }
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
  // Rep-filter dropdowns hide ghost users from non-admins (their deals still show/count).
  const pickUsers = isAdmin ? users : users.filter(u => !u.ghost)

  const filtered = useMemo(() => {
    let rows = [...deals]
    if (role === 'rep') rows = rows.filter(d => d.setter_id === profile.id || d.closer_id === profile.id)
    if (repFilter)     rows = rows.filter(d => d.setter_id === repFilter || d.closer_id === repFilter)
    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter(d => d.deal_name?.toLowerCase().includes(q) || d.office?.toLowerCase().includes(q) || d.project_id?.toLowerCase().includes(q))
    }
    if (statusFilter)  rows = rows.filter(d => d.status === statusFilter)
    if (officeFilter)  rows = rows.filter(d => d.office === officeFilter)
    if (paymentFilter) rows = rows.filter(d => d.payment_method === paymentFilter)
    if (dateFrom)      rows = rows.filter(d => (d[dateField] ?? '') >= dateFrom)
    if (dateTo)        rows = rows.filter(d => (d[dateField] ?? '') && d[dateField] <= dateTo)
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
  }, [deals, profile, role, repFilter, search, statusFilter, officeFilter, paymentFilter, dateField, dateFrom, dateTo, sortKey, sortDir])

  // Staging workflow: VP/admin (who graduate deals) get a "Needs review" view —
  // new/re-signed deals whose commission hasn't been gold-checked yet.
  // Everyone else just sees the normal list.
  const canStage = isAdmin || profile?.role === 'vp'
  const needsReview = useMemo(
    () => canStage ? filtered.filter(dealNeedsReview) : [],
    [filtered, canStage]
  )
  const [reviewTab, setReviewTab] = useState('all')   // 'review' | 'all'
  const didInitTab = useRef(false)
  // On first load, greet VP/admin with the worklist if there's a backlog.
  useEffect(() => {
    if (didInitTab.current || loading || !canStage) return
    didInitTab.current = true
    if (needsReview.length) setReviewTab('review')
  }, [loading, canStage, needsReview.length])
  const shownDeals = canStage && reviewTab === 'review' ? needsReview : filtered

  const kpis = useMemo(() => {
    let baseline = 0, totalComm = 0, totalJobPrice = 0, totalMarkupPct = 0
    // KPI totals exclude canceled jobs (they still appear in the table below so
    // they can be moved out of Canceled).
    const counted = filtered.filter(d => !isCanceled(d))
    for (const d of counted) {
      // Engine-derived so deductions and stored amounts are respected.
      const a = dealAmounts(d)
      baseline += a.baseline; totalComm += a.repCommission; totalJobPrice += a.job
      if (a.baseline > 0) totalMarkupPct += ((a.job - a.baseline) / a.baseline) * 100
    }
    const count = counted.length
    return { baseline, totalComm, count, avgDeal: count ? totalJobPrice/count : 0, avgComm: count ? totalComm/count : 0, avgMarkupPct: count ? totalMarkupPct/count : 0 }
  }, [filtered])

  function handleSort(key, dir) {
    if (dir) { setSortKey(key); setSortDir(dir); return }   // explicit (from header menu)
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
        users={pickUsers}
        repFilter={repFilter}         setRepFilter={setRepFilter}
        search={search}               setSearch={setSearch}
        statusFilter={statusFilter}   setStatusFilter={setStatusFilter}
        officeFilter={officeFilter}   setOfficeFilter={setOfficeFilter}
        paymentFilter={paymentFilter} setPaymentFilter={setPaymentFilter}
        dateField={dateField}         setDateField={setDateField}
        dateFrom={dateFrom}           dateTo={dateTo}
        datePreset={datePreset}       setDateRange={setDateRange}
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

      {/* Staging tabs — VP/admin only. New & re-signed deals wait in "Needs
          review" until their checklist is complete AND the gold commission
          check is on, then they join All deals. */}
      {canStage && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
            <button onClick={() => setReviewTab('review')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${reviewTab === 'review' ? 'bg-amber-400 text-dark' : 'text-white/50 hover:text-white'}`}>
              Needs review
              {needsReview.length > 0 && (
                <span className={`px-1.5 rounded-full text-[10px] font-bold ${reviewTab === 'review' ? 'bg-dark/20 text-dark' : 'bg-amber-400/20 text-amber-400'}`}>
                  {needsReview.length}
                </span>
              )}
            </button>
            <button onClick={() => setReviewTab('all')}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${reviewTab === 'all' ? 'bg-teal text-dark' : 'text-white/50 hover:text-white'}`}>
              All deals
            </button>
          </div>
          {reviewTab === 'review' && (
            <span className="text-[11px] text-white/40">
              {needsReview.length
                ? 'Gold-check a deal’s commission to move it into All deals.'
                : '🎉 Nothing to review — every deal is checklisted and verified.'}
            </span>
          )}
        </div>
      )}

      <DealTable
        deals={shownDeals}
        payments={payments}
        profile={profile}
        users={pickUsers}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
        repFilter={repFilter}         setRepFilter={setRepFilter}
        statusFilter={statusFilter}   setStatusFilter={setStatusFilter}
        officeFilter={officeFilter}   setOfficeFilter={setOfficeFilter}
        paymentFilter={paymentFilter} setPaymentFilter={setPaymentFilter}
        dateField={dateField}         setDateField={setDateField}
        dateFrom={dateFrom}           dateTo={dateTo}
        datePreset={datePreset}       setDateRange={setDateRange}
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
