import { useState, useEffect, useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { Users, Trophy, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchMyTeams, fetchTeamMonthSummary } from '../lib/db'
import { SURFACE, Card, Expandable, LoadingBlock, ErrorBlock, EmptyBlock, IconButton } from '../components/ui'

// Whole-dollar currency (no cents) — this section deals in large revenue and
// round bonus figures, and showing cents on a $472,000 number just adds noise.
const usd0 = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')
// Compact axis label for the progress-bar ticks (e.g. 200000 → "200k").
const tickLabel = (n) => (Number(n) || 0) / 1000 + 'k'

const MONTH_NAMES = ['January','February','March','April','May','June',
  'July','August','September','October','November','December']

const TOP = 700000   // progress-bar scale top = the highest bonus tier

// Last 12 months (current first), as { year, month, label }.
function recentMonths() {
  const out = []
  const now = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push({ year: d.getFullYear(), month: d.getMonth() + 1,
      label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` })
  }
  return out
}

// ── Progress bar toward the next bonus tier ──────────────────
function BonusBar({ revenue, tiers, maxTier }) {
  const pct = Math.max(0, Math.min(1, (Number(revenue) || 0) / TOP)) * 100
  return (
    <div className="mt-1">
      {/* Track + fill */}
      <div className="relative h-4 rounded-full overflow-hidden" style={SURFACE.well}>
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: maxTier ? 'var(--pos)' : 'var(--tx)' }}
        />
        {/* Tier gridlines sitting on top of the track */}
        {tiers.map(t => {
          const left = Math.min(100, (Number(t.min_revenue) / TOP) * 100)
          if (left >= 100) return null
          return <div key={t.min_revenue} className="absolute top-0 bottom-0 w-px" style={{ left: `${left}%`, background: 'rgba(0,0,0,0.45)' }} />
        })}
      </div>

      {/* Tick labels — cleared tiers in ivory, the rest muted. Abbreviated so
          six labels stay legible on a narrow phone. */}
      <div className="relative h-4 mt-1">
        {tiers.map(t => {
          const min = Number(t.min_revenue)
          const left = Math.min(100, (min / TOP) * 100)
          const cleared = (Number(revenue) || 0) >= min
          // Keep the end labels inside the container.
          const translate = left >= 99 ? 'translateX(-100%)' : left <= 1 ? 'translateX(0)' : 'translateX(-50%)'
          return (
            <span
              key={min}
              className={`absolute top-0 text-[12px] md:text-[13px] font-semibold tabular-nums ${cleared ? 'text-bank-tx' : 'text-bank-fa'}`}
              style={{ left: `${left}%`, transform: translate, whiteSpace: 'nowrap' }}
            >
              {tickLabel(min)}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export default function MyTeam() {
  const { profile, isAdmin } = useAuth()

  const months = useMemo(recentMonths, [])
  const [teams,       setTeams]       = useState(null)   // null = loading
  const [teamId,      setTeamId]      = useState('')
  const [monthIdx,    setMonthIdx]    = useState(0)      // 0 = current month
  const [summary,     setSummary]     = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)

  // Which teams can this user see? (Lead → their team; admin → all.)
  useEffect(() => {
    let alive = true
    fetchMyTeams(profile).then(({ data }) => {
      if (!alive) return
      const list = data || []
      setTeams(list)
      setTeamId(list[0]?.id || '')
    })
    return () => { alive = false }
  }, [profile])

  // Load the selected month's summary whenever team or month changes.
  useEffect(() => {
    if (!teamId) return
    let alive = true
    setLoading(true); setError(null)
    const { year, month } = months[monthIdx]
    fetchTeamMonthSummary(teamId, year, month, profile).then(({ data, error }) => {
      if (!alive) return
      if (error) { setError(error.message || 'Could not load team data.'); setSummary(null) }
      else setSummary(data)
      setLoading(false)
    })
    return () => { alive = false }
  }, [teamId, monthIdx, months, profile])

  // ── Access control (client side) ──────────────────────────
  // The nav item is already hidden for non-leads, and every data call is
  // re-checked server-side — this just keeps a non-authorized user who types
  // the URL from seeing an empty shell.
  if (teams === null) return <LoadingBlock text="Loading your teams…" />
  if (!isAdmin && teams.length === 0) return <Navigate to="/dashboard" replace />
  if (teams.length === 0) {
    return (
      <div className="max-w-2xl mx-auto rounded-2xl" style={SURFACE.card}>
        <EmptyBlock className="py-16"><Users size={28} className="mx-auto text-bank-fa mb-3" />No sales teams have been set up yet.</EmptyBlock>
      </div>
    )
  }

  const s = summary
  const revenue    = Number(s?.revenue) || 0
  const bonus      = Number(s?.bonus) || 0
  const tiers      = s?.tiers || []
  const members    = s?.members || []
  const maxTier    = !!s?.max_tier
  const memberTotal = members.reduce((sum, m) => sum + (Number(m.revenue) || 0), 0)
  const roleLabel  = { lead: 'Lead', closer: 'Closer', setter: 'Setter' }

  const selectCls = 'appearance-none px-3 py-1.5 min-h-[44px] md:min-h-0 md:h-9 rounded-lg text-[13px] text-bank-tx focus:outline-none'
  const label = 'text-[13px] font-semibold text-bank-fa uppercase tracking-wide mb-1'

  return (
    <div className="max-w-4xl mx-auto space-y-5" style={{ color: 'var(--tx)' }}>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={SURFACE.raise}>
            <Users size={18} className="text-bank-mu" />
          </div>
          <div>
            <h1 className="text-[18px] font-bold text-bank-tx leading-tight">{s?.team_name || 'My Team'}</h1>
            <p className="text-[13px] text-bank-mu">Team revenue bonus tracker</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Team selector — only when the viewer can see more than one team */}
          {teams.length > 1 && (
            <select value={teamId} onChange={e => setTeamId(e.target.value)} className={selectCls} style={SURFACE.raise} aria-label="Team">
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          {/* Month picker */}
          <div className="flex items-center gap-1">
            <IconButton onClick={() => setMonthIdx(i => Math.min(months.length - 1, i + 1))}
              disabled={monthIdx >= months.length - 1} title="Previous month" aria-label="Previous month"><ChevronLeft size={16} /></IconButton>
            <select value={monthIdx} onChange={e => setMonthIdx(Number(e.target.value))}
              className={`${selectCls} text-center`} style={{ ...SURFACE.raise, minWidth: 150 }} aria-label="Month">
              {months.map((m, i) => <option key={`${m.year}-${m.month}`} value={i}>{m.label}</option>)}
            </select>
            <IconButton onClick={() => setMonthIdx(i => Math.max(0, i - 1))}
              disabled={monthIdx <= 0} title="Next month" aria-label="Next month"><ChevronRight size={16} /></IconButton>
          </div>
        </div>
      </div>

      {error && <ErrorBlock title="Could not load team data" message={error} />}

      {loading ? (
        <LoadingBlock text="Loading the month…" />
      ) : !s ? null : (
        <>
          {/* Bonus + progress card */}
          <Card className="p-4 md:p-6">
            <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
              <div>
                <p className={label}>{months[monthIdx].label} team revenue</p>
                <p className="text-[30px] md:text-[38px] font-bold text-bank-tx leading-none tabular-nums">{usd0(revenue)}</p>
              </div>
              <div className="text-right">
                <p className={label}>Bonus earned</p>
                {/* The one gold number on this page. */}
                <p className="text-[26px] md:text-[30px] font-bold leading-none tabular-nums" style={{ color: 'var(--gold-tx)' }}>{usd0(bonus)}</p>
              </div>
            </div>

            <BonusBar revenue={revenue} tiers={tiers} maxTier={maxTier} />

            {/* Next-tier / max-tier line */}
            <div className="mt-4">
              {maxTier ? (
                <p className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: 'var(--pos)' }}>
                  <Trophy size={15} /> Top tier reached — max bonus of {usd0(bonus)} locked in for {months[monthIdx].label}.
                </p>
              ) : s.next_target != null ? (
                <p className="text-[13px] text-bank-mu">
                  <span className="font-bold text-bank-tx">{usd0(s.gap)}</span> more in revenue to reach the{' '}
                  <span className="font-bold text-bank-tx">{usd0(s.next_bonus)}</span> bonus
                  <span className="text-bank-fa"> (at {usd0(s.next_target)})</span>.
                </p>
              ) : (
                <p className="text-[13px] text-bank-mu">No bonus tiers configured.</p>
              )}
            </div>
          </Card>

          {/* Member breakdown */}
          <Card padded={false}>
            <div className="px-4 md:px-5 py-3 border-b border-bank-line">
              <p className={label.replace(' mb-1', '')}>Member breakdown</p>
            </div>
            {members.length === 0 ? (
              <EmptyBlock className="py-6 text-left px-4 md:px-5">No active team members this month.</EmptyBlock>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-bank-fa text-[13px] uppercase tracking-wide">
                        <th className="text-left  font-semibold px-4 md:px-5 py-2.5">Member</th>
                        <th className="text-left  font-semibold px-3 py-2.5">Role</th>
                        <th className="text-right font-semibold px-3 py-2.5">Deals</th>
                        <th className="text-right font-semibold px-4 md:px-5 py-2.5">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map(m => (
                        <tr key={m.user_id} className="border-t border-bank-line">
                          <td className="px-4 md:px-5 py-3 text-bank-tx font-medium">{m.name}</td>
                          <td className="px-3 py-3 text-bank-mu">{roleLabel[m.role] || m.role}</td>
                          <td className="px-3 py-3 text-right text-bank-mu tabular-nums">{m.deals}</td>
                          <td className="px-4 md:px-5 py-3 text-right text-bank-tx tabular-nums">{usd0(m.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-bank-line" style={{ background: 'var(--raise)' }}>
                        <td className="px-4 md:px-5 py-2.5 text-bank-mu text-[13px] uppercase tracking-wide font-semibold" colSpan={3}>Team total</td>
                        <td className="px-4 md:px-5 py-2.5 text-right text-bank-tx font-bold tabular-nums">{usd0(memberTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {/* Phones: compact rows (member · revenue) that open to role and deals */}
                <div className="md:hidden">
                  {members.map(m => (
                    <Expandable key={m.user_id} title={m.name}
                      right={<span className="text-[14px] font-bold text-bank-tx tabular-nums">{usd0(m.revenue)}</span>}>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3" style={{ background: 'var(--bg)' }}>
                        <div><p className="text-[13px] text-bank-fa">Role</p><p className="text-[13px] font-semibold text-bank-tx">{roleLabel[m.role] || m.role}</p></div>
                        <div><p className="text-[13px] text-bank-fa">Deals</p><p className="text-[13px] font-semibold text-bank-tx tabular-nums">{m.deals}</p></div>
                      </div>
                    </Expandable>
                  ))}
                  <div className="flex items-center justify-between px-4 py-3 border-t border-bank-line" style={{ background: 'var(--raise)' }}>
                    <span className="text-[13px] uppercase tracking-wide font-semibold text-bank-mu">Team total</span>
                    <span className="text-[14px] font-bold text-bank-tx tabular-nums">{usd0(memberTotal)}</span>
                  </div>
                </div>
              </>
            )}
            <p className="px-4 md:px-5 py-2.5 text-[13px] text-bank-mu border-t border-bank-line">
              Each deal counts once at full revenue, credited to its setter (or the closer when no team member set it).
            </p>
          </Card>
        </>
      )}
    </div>
  )
}
