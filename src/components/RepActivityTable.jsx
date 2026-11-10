// ============================================================
// The Leads page's "By rep" view (per Keaton). One row per rep, five stats in
// two groups that do not overlap, and a row opens to that person's
// appointments with both people named.
//
//   what they BOOKED:  Set → Ran → Closed
//   someone else's:    Leads Ran → Leads Closed
//
// Engine is `repActivity` in utils/repActivity.js — nothing is counted here.
// Rates ride UNDER the count they describe, never as their own columns (the
// site's convention), and blank when they would exceed 100%.
// ============================================================
import { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { teamLabel } from '../utils/team'

const pct = (v) => (v == null ? '—' : `${v.toFixed(0)}%`)

const ROLE = {
  self:   { label: 'Self-Gen', color: '#34d399', bg: 'rgba(52,211,153,0.1)' },
  set:    { label: 'Set',      color: '#60a5fa', bg: 'rgba(96,165,250,0.1)' },
  closer: { label: 'Closer',   color: '#c084fc', bg: 'rgba(192,132,252,0.12)' },
}
const OUTCOME = {
  sold:      { label: 'Sold',      color: '#4ade80' },
  completed: { label: 'Ran',       color: '#74b9ff' },
  scheduled: { label: 'Scheduled', color: '#6b7280' },
  no_show:   { label: 'No Show',   color: '#fb923c' },
  canceled:  { label: 'Canceled',  color: '#6b7280' },
}

function Stat({ value, rate, tone, muted }) {
  return (
    <>
      <span className="text-[15px] font-semibold tabular-nums" style={{ color: muted && !value ? 'rgba(255,255,255,0.25)' : tone }}>
        {value}
      </span>
      {rate !== undefined && (
        <span className="block text-[10.5px] text-white/40 tabular-nums">{pct(rate)}</span>
      )}
    </>
  )
}

function Person({ id, name, usersById, viewerTeam, teamOf }) {
  if (!id) return <span className="text-white/30">not recorded</span>
  const u = usersById[id]
  // Name the other team when a lead crossed one — the thing that makes a
  // cross-team close legible instead of looking like a stray row.
  const theirTeam = u && teamOf ? teamOf(id) : null
  const away = theirTeam && viewerTeam && theirTeam !== viewerTeam
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <span>{name}</span>
      {away && (
        <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-px rounded-full whitespace-nowrap"
          style={{ color: '#f59e0b', border: '1px solid rgba(245,158,11,0.35)' }}>
          {teamLabel(usersById[theirTeam])}
        </span>
      )}
    </span>
  )
}

function Appointments({ row, usersById, teamOf, viewerTeam }) {
  if (!row.appts.length) {
    return <p className="px-3 py-4 text-[12.5px] text-white/30">No appointments in this range.</p>
  }
  const nameOf = (id, fallback) => (id ? (usersById[id]?.name || 'Unknown') : (fallback || null))
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[12.5px]">
        <thead>
          <tr className="text-left text-[9px] font-extrabold uppercase tracking-[0.1em] text-white/30">
            <th className="px-3 py-2 border-b border-white/10 whitespace-nowrap">Date</th>
            <th className="px-3 py-2 border-b border-white/10">Customer</th>
            <th className="px-3 py-2 border-b border-white/10 whitespace-nowrap">Role</th>
            <th className="px-3 py-2 border-b border-white/10 whitespace-nowrap">Setter</th>
            <th className="px-3 py-2 border-b border-white/10 whitespace-nowrap">Closer</th>
            <th className="px-3 py-2 border-b border-white/10 whitespace-nowrap">RepCard outcome</th>
          </tr>
        </thead>
        <tbody>
          {row.appts.map(a => {
            const r = ROLE[a.role]
            const o = OUTCOME[a.status] || { label: a.status || '—', color: '#6b7280' }
            const setterTxt = nameOf(a.setterId, a.setterName)
            const closerTxt = nameOf(a.closerId, a.closerName)
            return (
              <tr key={`${a.id}-${a.role}`} className="border-b border-white/5 last:border-0">
                <td className="px-3 py-1.5 text-white/50 whitespace-nowrap tabular-nums">{a.day || '—'}</td>
                <td className="px-3 py-1.5">{a.customer}</td>
                <td className="px-3 py-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full whitespace-nowrap"
                    style={{ color: r.color, background: r.bg }}>{r.label}</span>
                </td>
                {/* The viewer's own name is muted on whichever side is theirs,
                    so the OTHER person is what the eye lands on. */}
                <td className={`px-3 py-1.5 ${a.setterId === row.id ? 'text-white/35' : ''}`}>
                  {a.setterId === row.id
                    ? setterTxt
                    : <Person id={a.setterId} name={setterTxt} usersById={usersById} teamOf={teamOf} viewerTeam={viewerTeam} />}
                </td>
                <td className={`px-3 py-1.5 ${a.closerId === row.id ? 'text-white/35' : ''}`}>
                  {a.closerId === row.id
                    ? closerTxt
                    : <Person id={a.closerId} name={closerTxt} usersById={usersById} teamOf={teamOf} viewerTeam={viewerTeam} />}
                </td>
                <td className="px-3 py-1.5">
                  <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                    style={{ color: o.color, background: o.color + '1f' }}>
                    {a.disposition || o.label}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function RepActivityTable({ data, usersById, teamOf, isAdmin }) {
  const [open, setOpen] = useState(null)
  const { rows, totals, distinct } = data

  if (!rows.length) {
    return (
      <div className="rounded-xl" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
        <p className="px-4 py-8 text-center text-[13px] text-white/30">
          Nobody has appointments or deals in this range.
        </p>
      </div>
    )
  }

  const Th = ({ children, hint, gap }) => (
    <th className={`px-3.5 py-2.5 text-right text-[9.5px] font-extrabold uppercase tracking-[0.1em] text-white/30 whitespace-nowrap border-b border-white/10 ${gap ? 'border-l border-white/15' : ''}`}>
      {children}
      {hint && <span className="block text-[9px] font-medium normal-case tracking-normal text-white/20">{hint}</span>}
    </th>
  )

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead>
            <tr>
              <th className="px-3.5 py-2.5 text-left text-[9.5px] font-extrabold uppercase tracking-[0.1em] text-white/30 border-b border-white/10">Rep</th>
              <Th hint="they booked it">Set</Th>
              <Th hint="of those">Ran</Th>
              <Th hint="of those">Closed</Th>
              <Th hint="another rep's" gap>Leads Ran</Th>
              <Th hint="of those">Leads Closed</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const isOpen = open === r.id
              const myTeam = teamOf ? teamOf(r.id) : null
              return [
                <tr key={r.id} onClick={() => setOpen(isOpen ? null : r.id)}
                  className="cursor-pointer hover:bg-white/[0.03] transition-colors"
                  style={isOpen ? { background: 'rgba(255,255,255,0.03)' } : undefined}>
                  <td className="px-3.5 py-2.5 border-b border-white/10 align-top">
                    <span className="flex items-center gap-1.5">
                      {isOpen ? <ChevronDown size={12} className="text-white/30 flex-shrink-0" />
                              : <ChevronRight size={12} className="text-white/30 flex-shrink-0" />}
                      <span className="text-[13.5px] font-semibold">{r.name}</span>
                      {r.ghost && isAdmin && <span className="text-[9px] text-white/25 uppercase tracking-wide">ghost</span>}
                      {!r.active && <span className="text-[9px] text-white/25 uppercase tracking-wide">inactive</span>}
                    </span>
                    {myTeam && (
                      <span className="block text-[11px] text-white/30 ml-[18px]">{teamLabel(usersById[myTeam])}</span>
                    )}
                  </td>
                  <td className="px-3.5 py-2.5 text-right border-b border-white/10 align-top"><Stat value={r.set} muted /></td>
                  <td className="px-3.5 py-2.5 text-right border-b border-white/10 align-top"><Stat value={r.ran} rate={r.ranRate} muted /></td>
                  <td className="px-3.5 py-2.5 text-right border-b border-white/10 align-top"><Stat value={r.closed} rate={r.closeRate} tone="#34d399" muted /></td>
                  <td className="px-3.5 py-2.5 text-right border-b border-white/10 border-l border-white/15 align-top"><Stat value={r.leadsRan} tone="#c084fc" muted /></td>
                  <td className="px-3.5 py-2.5 text-right border-b border-white/10 align-top"><Stat value={r.leadsClosed} rate={r.leadsCloseRate} tone="#34d399" muted /></td>
                </tr>,
                isOpen && (
                  <tr key={r.id + '-d'}>
                    <td colSpan={6} className="border-b border-white/10" style={{ background: '#171717' }}>
                      <div className="p-3">
                        <div className="rounded-lg overflow-hidden" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
                          <Appointments row={r} usersById={usersById} teamOf={teamOf} viewerTeam={myTeam} />
                        </div>
                      </div>
                    </td>
                  </tr>
                ),
              ]
            })}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td className="px-3.5 py-2.5 text-[10px] uppercase tracking-[0.1em] text-white/30 border-t border-white/10">Column totals</td>
              <td className="px-3.5 py-2.5 text-right border-t border-white/10 tabular-nums">{totals.set}</td>
              <td className="px-3.5 py-2.5 text-right border-t border-white/10 tabular-nums">{totals.ran}
                <span className="block text-[10.5px] font-medium text-white/40">{pct(totals.ranRate)}</span></td>
              <td className="px-3.5 py-2.5 text-right border-t border-white/10 tabular-nums text-teal">{totals.closed}
                <span className="block text-[10.5px] font-medium text-white/40">{pct(totals.closeRate)}</span></td>
              <td className="px-3.5 py-2.5 text-right border-t border-l border-white/15 tabular-nums" style={{ color: '#c084fc' }}>{totals.leadsRan}</td>
              <td className="px-3.5 py-2.5 text-right border-t border-white/10 tabular-nums text-teal">{totals.leadsClosed}
                <span className="block text-[10.5px] font-medium text-white/40">{pct(totals.leadsCloseRate)}</span></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* The columns above credit each person, so one appointment with a
          setter and a closer lands on two rows. These count it ONCE (per
          Keaton) and are the figures to quote as the group's own. */}
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 px-3.5 py-3 m-3 mt-0 rounded-lg"
        style={{ background: '#232323', border: '1px solid #2a2a2a' }}>
        <span><span className="text-[17px] font-bold tabular-nums">{distinct.appointments}</span>
          <span className="text-[11px] text-white/45 ml-1.5">appointments</span></span>
        <span><span className="text-[17px] font-bold tabular-nums text-teal">{distinct.deals}</span>
          <span className="text-[11px] text-white/45 ml-1.5">deals</span></span>
        <span><span className="text-[17px] font-bold tabular-nums">{pct(distinct.closeRate)}</span>
          <span className="text-[11px] text-white/45 ml-1.5">close rate</span></span>
        <span className="text-[11.5px] text-white/30 flex-1 min-w-[200px]">
          Counted once each. An appointment one rep set and another ran is one appointment, and one
          deal if it closed — it shows on both their rows, which is why the columns add to more.
        </span>
      </div>
    </div>
  )
}
