import { useState, useEffect, useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { Users, Trophy, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchMyTeams, fetchTeamMonthSummary } from '../lib/db'

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
      <div className="relative h-4 rounded-full overflow-hidden" style={{ background: '#1a1a1a', border: '1px solid #2e2e2e' }}>
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
          style={{
            width: `${pct}%`,
            background: maxTier
              ? 'linear-gradient(90deg,#00b894,#34d399)'
              : 'linear-gradient(90deg,#00b894aa,#00b894)',
          }}
        />
        {/* Tier gridlines sitting on top of the track */}
        {tiers.map(t => {
          const left = Math.min(100, (Number(t.min_revenue) / TOP) * 100)
          if (left >= 100) return null
          return <div key={t.min_revenue} className="absolute top-0 bottom-0 w-px" style={{ left: `${left}%`, background: '#00000055' }} />
        })}
      </div>

      {/* Tick labels — cleared tiers in teal, the rest muted. Abbreviated so
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
              className={`absolute top-0 text-[9px] md:text-[10px] font-semibold tabular-nums ${cleared ? 'text-teal' : 'text-white/35'}`}
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
  const [expanded,    setExpanded]    = useState(false)  // for the oversight (non-lead) view

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

  // The team LEAD gets the full, always-open view. Everyone else who's allowed
  // to see it (admins + the lead's management chain: Conner, Garrison, Keaton)
  // gets a collapsed-by-default panel so it stays a quiet peek, not clutter.
  const selectedTeam = (teams || []).find(t => t.id === teamId)
  const isLead = !!selectedTeam && selectedTeam.team_lead_user_id === profile?.id
  useEffect(() => { setExpanded(isLead) }, [isLead, teamId])

  // ── Access control (client side) ──────────────────────────
  // The nav item is already hidden for non-leads, and every data call is
  // re-checked server-side — this just keeps a non-authorized user who types
  // the URL from seeing an empty shell.
  if (teams === null) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 border-2 border-teal/30 border-t-teal rounded-full animate-spin" />
      </div>
    )
  }
  if (!isAdmin && teams.length === 0) return <Navigate to="/dashboard" replace />
  if (teams.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <Users size={28} className="mx-auto text-white/20" />
        <p className="mt-3 text-[14px] text-white/50">No sales teams have been set up yet.</p>
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

  return (
    <div className="max-w-4xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: '#00b89420', border: '1px solid #00b89430' }}>
            <Users size={18} className="text-teal" />
          </div>
          <div>
            <h1 className="text-[18px] font-bold text-white leading-tight">{s?.team_name || 'My Team'}</h1>
            <p className="text-[11px] text-white/40">Team revenue bonus tracker</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Team selector — only when the viewer can see more than one team */}
          {teams.length > 1 && (
            <select
              value={teamId}
              onChange={e => setTeamId(e.target.value)}
              className="appearance-none px-3 py-1.5 rounded-lg text-[12px] text-white/80 focus:outline-none"
              style={{ background: '#242424', border: '1px solid #2e2e2e' }}
            >
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          {/* Month picker */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setMonthIdx(i => Math.min(months.length - 1, i + 1))}
              disabled={monthIdx >= months.length - 1}
              className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/5 disabled:opacity-30 transition-colors"
              title="Previous month"
            ><ChevronLeft size={16} /></button>
            <select
              value={monthIdx}
              onChange={e => setMonthIdx(Number(e.target.value))}
              className="appearance-none px-3 py-1.5 rounded-lg text-[12px] text-white/80 focus:outline-none text-center"
              style={{ background: '#242424', border: '1px solid #2e2e2e', minWidth: 140 }}
            >
              {months.map((m, i) => <option key={`${m.year}-${m.month}`} value={i}>{m.label}</option>)}
            </select>
            <button
              onClick={() => setMonthIdx(i => Math.max(0, i - 1))}
              disabled={monthIdx <= 0}
              className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/5 disabled:opacity-30 transition-colors"
              title="Next month"
            ><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl p-4 text-[13px]" style={{ background: '#3a1f1f', border: '1px solid #5a2a2a', color: '#f8b4b4' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-teal/30 border-t-teal rounded-full animate-spin" />
        </div>
      ) : !s ? null : (
        <>
          {/* Oversight (non-lead) viewers — admins + the lead's chain — get a
              collapsed-by-default peek with the key numbers on the toggle. */}
          {!isLead && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="w-full flex items-center justify-between gap-3 rounded-xl px-4 md:px-5 py-3 text-left transition-colors hover:bg-white/[0.02]"
              style={{ background: '#242424', border: '1px solid #2e2e2e' }}
            >
              <span className="flex items-center gap-2 text-[13px] font-semibold text-white/80">
                <ChevronDown size={15} className={`text-white/40 transition-transform ${expanded ? '' : '-rotate-90'}`} />
                Team bonus details
              </span>
              <span className="text-[12px] text-white/50 tabular-nums">
                {usd0(revenue)} · <span className="text-teal font-semibold">{usd0(bonus)}</span> bonus
              </span>
            </button>
          )}

          {(isLead || expanded) && (<>
          {/* Bonus + progress card */}
          <div className="rounded-xl p-4 md:p-6" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
            <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
              <div>
                <p className="text-[10px] font-semibold text-white/40 uppercase tracking-[0.1em] mb-1">
                  {months[monthIdx].label} team revenue
                </p>
                <p className="text-[30px] md:text-[38px] font-bold text-white leading-none tabular-nums">{usd0(revenue)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-semibold text-white/40 uppercase tracking-[0.1em] mb-1">Bonus earned</p>
                <p className="text-[22px] md:text-[26px] font-bold text-teal leading-none tabular-nums">{usd0(bonus)}</p>
              </div>
            </div>

            <BonusBar revenue={revenue} tiers={tiers} maxTier={maxTier} />

            {/* Next-tier / max-tier line */}
            <div className="mt-4">
              {maxTier ? (
                <p className="flex items-center gap-2 text-[13px] font-semibold text-teal">
                  <Trophy size={15} /> Top tier reached — max bonus of {usd0(bonus)} locked in for {months[monthIdx].label}.
                </p>
              ) : s.next_target != null ? (
                <p className="text-[13px] text-white/60">
                  <span className="font-bold text-white">{usd0(s.gap)}</span> more in revenue to reach the{' '}
                  <span className="font-bold text-white">{usd0(s.next_bonus)}</span> bonus
                  <span className="text-white/35"> (at {usd0(s.next_target)})</span>.
                </p>
              ) : (
                <p className="text-[13px] text-white/50">No bonus tiers configured.</p>
              )}
              {bonus === 0 && !maxTier && s.next_target != null && (
                <p className="text-[11px] text-white/30 mt-1">
                  Bonus starts at {usd0(tiers[0]?.min_revenue)} in team revenue.
                </p>
              )}
            </div>
          </div>

          {/* Member breakdown */}
          <div className="rounded-xl overflow-hidden" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
            <div className="px-4 md:px-5 py-3 border-b" style={{ borderColor: '#2e2e2e' }}>
              <p className="text-[10px] font-semibold text-white/40 uppercase tracking-[0.1em]">Member breakdown</p>
            </div>
            {members.length === 0 ? (
              <p className="px-4 md:px-5 py-6 text-[13px] text-white/40">No active team members this month.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-white/40 text-[10px] uppercase tracking-wider">
                      <th className="text-left  font-semibold px-4 md:px-5 py-2.5">Member</th>
                      <th className="text-left  font-semibold px-3 py-2.5">Role</th>
                      <th className="text-right font-semibold px-3 py-2.5">Deals</th>
                      <th className="text-right font-semibold px-4 md:px-5 py-2.5">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map(m => (
                      <tr key={m.user_id} className="border-t" style={{ borderColor: '#2a2a2a' }}>
                        <td className="px-4 md:px-5 py-3 text-white/90 font-medium">{m.name}</td>
                        <td className="px-3 py-3 text-white/50">{roleLabel[m.role] || m.role}</td>
                        <td className="px-3 py-3 text-right text-white/70 tabular-nums">{m.deals}</td>
                        <td className="px-4 md:px-5 py-3 text-right text-white/90 tabular-nums">{usd0(m.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t" style={{ borderColor: '#2e2e2e', background: '#1f1f1f' }}>
                      <td className="px-4 md:px-5 py-2.5 text-white/50 text-[11px] uppercase tracking-wider font-semibold" colSpan={3}>Team total</td>
                      <td className="px-4 md:px-5 py-2.5 text-right text-teal font-bold tabular-nums">{usd0(memberTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <p className="px-4 md:px-5 py-2.5 text-[10px] text-white/25 border-t" style={{ borderColor: '#2a2a2a' }}>
              Each deal counts once at full revenue, credited to its setter (or the closer when no team member set it).
            </p>
          </div>
          </>)}
        </>
      )}
    </div>
  )
}
