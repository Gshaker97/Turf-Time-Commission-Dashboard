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
// Desktop keeps the table; phones get compact rows that expand.
// ============================================================
import { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { teamLabel } from '../utils/team'
import { SURFACE, EmptyBlock, Expandable } from './ui'

const pct = (v) => (v == null ? '—' : `${v.toFixed(0)}%`)

// Role / outcome tones on the palette; every chip also carries its label.
const ROLE = {
  self:   { label: 'Self-Gen', color: 'var(--pos)',  bg: 'rgba(169,196,178,0.14)' },
  set:    { label: 'Set',      color: 'var(--tx)',   bg: 'rgba(237,231,218,0.10)' },
  closer: { label: 'Closer',   color: 'var(--warn)', bg: 'rgba(210,160,116,0.14)' },
}
const OUTCOME = {
  sold:      { label: 'Sold',      color: 'var(--pos)' },
  completed: { label: 'Ran',       color: 'var(--tx)' },
  scheduled: { label: 'Scheduled', color: 'var(--mu)' },
  no_show:   { label: 'No Show',   color: 'var(--warn)' },
  canceled:  { label: 'Canceled',  color: 'var(--fa)' },
}

// A value with no `tone` must still name its own colour. Leaving it
// undefined made the span INHERIT, and nothing up the tree set a text colour,
// so Set/Ran/Closed rendered pure black on the dark page — unreadable.
// Never let text in this component fall through to an inherited colour.
const FG = 'var(--tx)', DIM = 'var(--fa)'
function Stat({ value, rate, tone, muted }) {
  return (
    <>
      <span className="text-[15px] font-semibold tabular-nums" style={{ color: muted && !value ? DIM : (tone || FG) }}>
        {value}
      </span>
      {rate !== undefined && (
        <span className="block text-[13px] text-bank-mu tabular-nums">{pct(rate)}</span>
      )}
    </>
  )
}

function Person({ id, name, usersById, viewerTeam, teamOf }) {
  if (!id) return <span className="text-bank-fa">not recorded</span>
  const u = usersById[id]
  // Name the other team when a lead crossed one — the thing that makes a
  // cross-team close legible instead of looking like a stray row.
  const theirTeam = u && teamOf ? teamOf(id) : null
  const away = theirTeam && viewerTeam && theirTeam !== viewerTeam
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <span>{name}</span>
      {away && (
        <span className="text-[12px] font-bold uppercase tracking-wide px-1.5 py-px rounded-full whitespace-nowrap"
          style={{ color: 'var(--warn)', border: '1px solid rgba(210,160,116,0.4)' }}>
          {teamLabel(usersById[theirTeam])}
        </span>
      )}
    </span>
  )
}

const RoleChip = ({ r }) => (
  <span className="text-[12px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full whitespace-nowrap"
    style={{ color: r.color, background: r.bg }}>{r.label}</span>
)
const OutcomeChip = ({ o, text }) => (
  <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
    style={{ color: o.color, border: `1px solid ${o.color}`, opacity: 0.95 }}>{text}</span>
)

function Appointments({ row, usersById, teamOf, viewerTeam }) {
  if (!row.appts.length) {
    return <p className="px-3 py-4 text-[13px] text-bank-mu">No appointments in this range.</p>
  }
  const nameOf = (id, fallback) => (id ? (usersById[id]?.name || 'Unknown') : (fallback || null))
  const TH = 'px-3 py-2 border-b border-bank-line whitespace-nowrap text-left text-[13px] font-semibold uppercase tracking-wide text-bank-fa'
  return (
    <>
      {/* Desktop: the appointments table */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px] text-bank-tx">
          <thead>
            <tr>
              <th className={TH}>Date</th>
              <th className={TH}>Customer</th>
              <th className={TH}>Role</th>
              <th className={TH}>Setter</th>
              <th className={TH}>Closer</th>
              <th className={TH}>RepCard outcome</th>
            </tr>
          </thead>
          <tbody>
            {row.appts.map(a => {
              const r = ROLE[a.role]
              const o = OUTCOME[a.status] || { label: a.status || '—', color: 'var(--fa)' }
              const setterTxt = nameOf(a.setterId, a.setterName)
              const closerTxt = nameOf(a.closerId, a.closerName)
              return (
                <tr key={`${a.id}-${a.role}`} className="border-b border-bank-line last:border-0">
                  <td className="px-3 py-2 text-bank-mu whitespace-nowrap tabular-nums">{a.day || '—'}</td>
                  <td className="px-3 py-2">{a.customer}</td>
                  <td className="px-3 py-2"><RoleChip r={r} /></td>
                  {/* The viewer's own name is muted on whichever side is theirs,
                      so the OTHER person is what the eye lands on. */}
                  <td className={`px-3 py-2 ${a.setterId === row.id ? 'text-bank-fa' : ''}`}>
                    {a.setterId === row.id
                      ? setterTxt
                      : <Person id={a.setterId} name={setterTxt} usersById={usersById} teamOf={teamOf} viewerTeam={viewerTeam} />}
                  </td>
                  <td className={`px-3 py-2 ${a.closerId === row.id ? 'text-bank-fa' : ''}`}>
                    {a.closerId === row.id
                      ? closerTxt
                      : <Person id={a.closerId} name={closerTxt} usersById={usersById} teamOf={teamOf} viewerTeam={viewerTeam} />}
                  </td>
                  <td className="px-3 py-2"><OutcomeChip o={o} text={a.disposition || o.label} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {/* Phones: one row per appointment, every column stacked */}
      <div className="lg:hidden divide-y divide-bank-line">
        {row.appts.map(a => {
          const r = ROLE[a.role]
          const o = OUTCOME[a.status] || { label: a.status || '—', color: 'var(--fa)' }
          const setterTxt = nameOf(a.setterId, a.setterName)
          const closerTxt = nameOf(a.closerId, a.closerName)
          return (
            <div key={`${a.id}-${a.role}`} className="px-3 py-2.5 text-[13px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-bank-tx truncate">{a.customer}</span>
                <OutcomeChip o={o} text={a.disposition || o.label} />
              </div>
              <div className="flex items-center gap-2 mt-1 text-bank-mu">
                <span className="tabular-nums">{a.day || '—'}</span><RoleChip r={r} />
              </div>
              <div className="mt-1 text-bank-mu">
                <span className="text-bank-fa">Setter </span>
                {a.setterId === row.id ? setterTxt : <Person id={a.setterId} name={setterTxt} usersById={usersById} teamOf={teamOf} viewerTeam={viewerTeam} />}
                <span className="text-bank-fa"> · Closer </span>
                {a.closerId === row.id ? closerTxt : <Person id={a.closerId} name={closerTxt} usersById={usersById} teamOf={teamOf} viewerTeam={viewerTeam} />}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

export default function RepActivityTable({ data, usersById, teamOf, isAdmin }) {
  const [open, setOpen] = useState(null)
  const { rows, totals, distinct } = data

  if (!rows.length) {
    return (
      <div className="rounded-2xl" style={SURFACE.card}>
        <EmptyBlock>Nobody has appointments or deals in this range.</EmptyBlock>
      </div>
    )
  }

  const Th = ({ children, hint, gap }) => (
    <th className={`px-3.5 py-2.5 text-right text-[13px] font-semibold uppercase tracking-wide text-bank-fa whitespace-nowrap border-b border-bank-line ${gap ? 'border-l border-bank-line' : ''}`}>
      {children}
      {hint && <span className="block text-[12px] font-medium normal-case tracking-normal text-bank-fa opacity-80">{hint}</span>}
    </th>
  )
  const tags = (r) => (
    <>
      {r.ghost && isAdmin && <span className="text-[12px] text-bank-fa uppercase tracking-wide">ghost</span>}
      {!r.active && <span className="text-[12px] text-bank-fa uppercase tracking-wide">inactive</span>}
    </>
  )

  return (
    <div className="rounded-2xl overflow-hidden text-bank-tx" style={SURFACE.card}>
      {/* Desktop table */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead>
            <tr>
              <th className="px-3.5 py-2.5 text-left text-[13px] font-semibold uppercase tracking-wide text-bank-fa border-b border-bank-line">Rep</th>
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
                  className="cursor-pointer hover:bg-bank-raise transition-colors"
                  style={isOpen ? { background: 'var(--raise)' } : undefined}>
                  <td className="px-3.5 py-2.5 border-b border-bank-line align-top">
                    <span className="flex items-center gap-1.5">
                      {isOpen ? <ChevronDown size={12} className="text-bank-fa flex-shrink-0" />
                              : <ChevronRight size={12} className="text-bank-fa flex-shrink-0" />}
                      <span className="text-[13.5px] font-semibold">{r.name}</span>
                      {tags(r)}
                    </span>
                    {myTeam && (
                      <span className="block text-[13px] text-bank-mu ml-[18px]">{teamLabel(usersById[myTeam])}</span>
                    )}
                  </td>
                  <td className="px-3.5 py-2.5 text-right border-b border-bank-line align-top"><Stat value={r.set} muted /></td>
                  <td className="px-3.5 py-2.5 text-right border-b border-bank-line align-top"><Stat value={r.ran} rate={r.ranRate} muted /></td>
                  <td className="px-3.5 py-2.5 text-right border-b border-bank-line align-top"><Stat value={r.closed} rate={r.closeRate} tone="var(--pos)" muted /></td>
                  <td className="px-3.5 py-2.5 text-right border-b border-bank-line border-l align-top"><Stat value={r.leadsRan} tone="var(--warn)" muted /></td>
                  <td className="px-3.5 py-2.5 text-right border-b border-bank-line align-top"><Stat value={r.leadsClosed} rate={r.leadsCloseRate} tone="var(--pos)" muted /></td>
                </tr>,
                isOpen && (
                  <tr key={r.id + '-d'}>
                    <td colSpan={6} className="border-b border-bank-line" style={{ background: 'var(--bg)' }}>
                      <div className="p-3">
                        <div className="rounded-xl overflow-hidden" style={SURFACE.card}>
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
              <td className="px-3.5 py-2.5 text-[13px] uppercase tracking-wide text-bank-fa border-t border-bank-line">Column totals</td>
              <td className="px-3.5 py-2.5 text-right border-t border-bank-line tabular-nums">{totals.set}</td>
              <td className="px-3.5 py-2.5 text-right border-t border-bank-line tabular-nums">{totals.ran}
                <span className="block text-[13px] font-medium text-bank-mu">{pct(totals.ranRate)}</span></td>
              <td className="px-3.5 py-2.5 text-right border-t border-bank-line tabular-nums" style={{ color: 'var(--pos)' }}>{totals.closed}
                <span className="block text-[13px] font-medium text-bank-mu">{pct(totals.closeRate)}</span></td>
              <td className="px-3.5 py-2.5 text-right border-t border-l border-bank-line tabular-nums" style={{ color: 'var(--warn)' }}>{totals.leadsRan}</td>
              <td className="px-3.5 py-2.5 text-right border-t border-bank-line tabular-nums" style={{ color: 'var(--pos)' }}>{totals.leadsClosed}
                <span className="block text-[13px] font-medium text-bank-mu">{pct(totals.leadsCloseRate)}</span></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Phones: compact rows (name · Set · Closed) that open to the rest + appointments */}
      <div className="lg:hidden">
        {rows.map(r => {
          const myTeam = teamOf ? teamOf(r.id) : null
          return (
            <Expandable key={`m-${r.id}`}
              title={<span className="flex items-center gap-1.5">{r.name}{tags(r)}</span>}
              meta={myTeam ? teamLabel(usersById[myTeam]) : null}
              right={
                <span className="flex items-center gap-4 text-right">
                  <span><span className="block text-[12px] text-bank-fa uppercase">Set</span><span className="text-[15px] font-semibold tabular-nums text-bank-tx">{r.set}</span></span>
                  <span><span className="block text-[12px] text-bank-fa uppercase">Closed</span><span className="text-[15px] font-semibold tabular-nums" style={{ color: 'var(--pos)' }}>{r.closed}</span></span>
                </span>
              }>
              <div className="grid grid-cols-3 gap-2 px-4 py-3 text-right" style={{ background: 'var(--bg)' }}>
                {[['Ran', r.ran, r.ranRate, null], ['Closed', r.closed, r.closeRate, 'var(--pos)'], ['Leads Ran', r.leadsRan, undefined, 'var(--warn)'], ['Leads Closed', r.leadsClosed, r.leadsCloseRate, 'var(--pos)'], ['Set', r.set, undefined, null]].map(([l, v, rate, tone]) => (
                  <div key={l}><p className="text-[12px] text-bank-fa uppercase">{l}</p><Stat value={v} rate={rate} tone={tone} muted /></div>
                ))}
              </div>
              <div className="border-t border-bank-line"><Appointments row={r} usersById={usersById} teamOf={teamOf} viewerTeam={myTeam} /></div>
            </Expandable>
          )
        })}
        <div className="grid grid-cols-3 gap-2 px-4 py-3 text-right border-t border-bank-line" style={{ background: 'var(--raise)' }}>
          <div className="col-span-3 text-left text-[13px] uppercase tracking-wide text-bank-fa font-semibold">Column totals</div>
          <div><p className="text-[12px] text-bank-fa uppercase">Set</p><span className="text-[15px] font-bold tabular-nums">{totals.set}</span></div>
          <div><p className="text-[12px] text-bank-fa uppercase">Ran</p><span className="text-[15px] font-bold tabular-nums">{totals.ran}</span><span className="block text-[13px] text-bank-mu">{pct(totals.ranRate)}</span></div>
          <div><p className="text-[12px] text-bank-fa uppercase">Closed</p><span className="text-[15px] font-bold tabular-nums" style={{ color: 'var(--pos)' }}>{totals.closed}</span><span className="block text-[13px] text-bank-mu">{pct(totals.closeRate)}</span></div>
          <div><p className="text-[12px] text-bank-fa uppercase">Leads Ran</p><span className="text-[15px] font-bold tabular-nums" style={{ color: 'var(--warn)' }}>{totals.leadsRan}</span></div>
          <div><p className="text-[12px] text-bank-fa uppercase">Leads Closed</p><span className="text-[15px] font-bold tabular-nums" style={{ color: 'var(--pos)' }}>{totals.leadsClosed}</span><span className="block text-[13px] text-bank-mu">{pct(totals.leadsCloseRate)}</span></div>
        </div>
      </div>

      {/* The columns above credit each person, so one appointment with a
          setter and a closer lands on two rows. These count it ONCE (per
          Keaton) and are the figures to quote as the group's own. */}
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 px-3.5 py-3 m-3 mt-3 rounded-xl" style={SURFACE.well}>
        <span><span className="text-[17px] font-bold tabular-nums">{distinct.appointments}</span>
          <span className="text-[13px] text-bank-mu ml-1.5">appointments</span></span>
        <span><span className="text-[17px] font-bold tabular-nums" style={{ color: 'var(--pos)' }}>{distinct.deals}</span>
          <span className="text-[13px] text-bank-mu ml-1.5">deals</span></span>
        <span><span className="text-[17px] font-bold tabular-nums">{pct(distinct.closeRate)}</span>
          <span className="text-[13px] text-bank-mu ml-1.5">close rate</span></span>
        <span className="text-[13px] text-bank-mu flex-1 min-w-[200px]">
          Counted once each. An appointment one rep set and another ran is one appointment, and one
          deal if it closed — it shows on both their rows, which is why the columns add to more.
        </span>
      </div>
    </div>
  )
}
