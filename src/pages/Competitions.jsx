import { useEffect, useMemo, useRef, useState } from 'react'
import { Trophy, Plus, Pencil, Trash2, ChevronDown, Download, Copy, Check } from 'lucide-react'
import { format } from 'date-fns'
import { toPng, toBlob } from 'html-to-image'
import { useAuth } from '../contexts/AuthContext'
import { fetchCompetitions, fetchDeals, fetchUsers, insertCompetition, updateCompetition, deleteCompetition } from '../lib/db'
import { competitionStandings, competitionStatus, competitionEntryDeals, typeLabel, metricLabel, creditLabel, fmtScore } from '../utils/competition'
import CompetitionModal from '../components/CompetitionModal'

const todayISO = () => new Date().toISOString().slice(0, 10)
const fmtRange = (a, b) => {
  const f = (d) => d ? format(new Date(d + 'T12:00:00'), 'MMM d') : null
  if (!a && !b) return 'No date range'
  if (a && b) return `${f(a)} – ${f(b)}`
  return a ? `From ${f(a)}` : `Through ${f(b)}`
}
const STATUS = {
  active:   { label: 'Active',   color: '#00b894' },
  upcoming: { label: 'Upcoming', color: '#fdcb6e' },
  ended:    { label: 'Ended',    color: '#94a3b8' },
}
const RANK_COLOR = { 1: '#fbbf24', 2: '#cbd5e1', 3: '#fb923c' }

function StandRow({ e, comp, deals, users, canManage, mine }) {
  const metric = comp.metric
  const [open, setOpen] = useState(false)
  const rc = RANK_COLOR[e.rank]
  const hasTarget = e.target > 0
  // Admins can drill into a (computed, non-manual) entry to verify its deals.
  const clickable = canManage && !e.manual
  const entryDeals = useMemo(
    () => (open ? competitionEntryDeals(comp, e.id, deals, users) : []),
    [open, comp, e.id, deals, users]
  )
  const fmtDate = (d) => d ? format(new Date(d + 'T12:00:00'), 'MMM d') : '—'

  return (
    <div className="rounded-lg" style={mine ? { background: '#00b89415', border: '1px solid #00b89430' } : undefined}>
      <div className={`flex items-center gap-3 px-3 py-2 rounded-lg ${clickable ? 'cursor-pointer hover:bg-white/[0.04]' : ''}`}
        onClick={clickable ? () => setOpen(o => !o) : undefined}
        title={clickable ? 'Click to verify the deals counted' : undefined}>
        <span className="w-6 text-center text-[12px] font-bold flex-shrink-0" style={{ color: rc || 'rgba(255,255,255,0.4)' }}>
          {e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : e.rank}
        </span>
        <span className="flex-1 min-w-0 truncate text-[13px] text-white/85">{e.name}{mine && <span className="text-teal text-[11px]"> · you</span>}</span>
        {e.manual && <span className="text-[9px] uppercase text-white/30 tracking-wide">manual</span>}
        {e.earned && (
          <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
            style={{ color: '#00b894', border: '1px solid #00b89455' }}>🎉 Earned</span>
        )}
        <span className="text-[13px] font-bold text-white whitespace-nowrap">{fmtScore(e.score, metric)}</span>
        {clickable && <ChevronDown size={12} className={`text-white/25 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />}
      </div>
      {hasTarget && (
        <div className="px-3 pb-2 -mt-0.5 flex items-center gap-2">
          <span className="w-6 flex-shrink-0" />
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#ffffff12' }}>
            <div className="h-full rounded-full transition-all"
              style={{ width: `${(e.progress || 0) * 100}%`, background: e.earned ? '#00b894' : '#2dd4bf' }} />
          </div>
          <span className="text-[10px] text-white/30 whitespace-nowrap">of {fmtScore(e.target, metric)}</span>
        </div>
      )}
      {open && (
        <div className="mx-3 mb-2 rounded-lg p-2" style={{ background: '#141414', border: '1px solid #262626' }}>
          {entryDeals.length === 0 ? (
            <p className="text-[11px] text-white/30 px-1 py-1.5">No deals in this window.</p>
          ) : (
            <>
              <div className="flex items-center justify-between px-1 pb-1.5 mb-1 border-b border-white/5 text-[9px] font-bold uppercase tracking-wider text-white/30">
                <span>{entryDeals.filter(x => !x.canceled).length} deal{entryDeals.filter(x => !x.canceled).length === 1 ? '' : 's'} counted</span>
                <span>Counts toward score</span>
              </div>
              {entryDeals.map(({ deal, value, credit, contribution, canceled }) => (
                <div key={deal.id} className={`flex items-center gap-2 px-1 py-1 text-[11px] ${canceled ? 'opacity-60' : ''}`}>
                  <span className={`flex-1 min-w-0 truncate ${canceled ? 'line-through text-white/40' : 'text-white/75'}`}>{deal.deal_name || '—'}</span>
                  {canceled && <span className="text-[8px] font-bold uppercase tracking-wide text-red-400 whitespace-nowrap">canceled</span>}
                  <span className={`whitespace-nowrap ${canceled ? 'text-white/25' : 'text-white/30'}`}>{fmtDate(deal.sale_date)}</span>
                  {credit !== 1 && <span className={`whitespace-nowrap ${canceled ? 'text-white/25' : 'text-white/30'}`}>{Math.round(credit * 100)}%</span>}
                  <span className={`font-semibold whitespace-nowrap w-20 text-right ${canceled ? 'line-through text-red-400/60' : 'text-white/80'}`}>
                    {fmtScore(canceled ? value * credit : contribution, metric)}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between px-1 pt-1.5 mt-1 border-t border-white/5 text-[11px]">
                <span className="font-bold text-white/50 uppercase tracking-wider text-[9px]">Total</span>
                <span className="font-bold text-teal">{fmtScore(e.score, metric)}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function CompetitionCard({ comp, deals, users, profileId, canManage, isAdmin, onEdit, onDelete, onExport, onCopy, copied, exporting }) {
  const [open, setOpen] = useState(false)
  const ghostIds = useMemo(() => new Set(users.filter(u => u.ghost).map(u => u.id)), [users])
  const standings = useMemo(
    () => competitionStandings(comp, deals, users, { hiddenIds: isAdmin ? null : ghostIds }),
    [comp, deals, users, isAdmin, ghostIds]
  )
  const status = competitionStatus(comp, todayISO())
  const st = STATUS[status]
  const isMine = (e) => e.id === profileId || (comp.type === 'team' && users.find(u => u.id === profileId)?.manager_id === e.id)
  const myEntry = standings.find(isMine)
  const top = open ? standings : standings.slice(0, 5)

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-[15px] font-bold text-white truncate">{comp.name}</h3>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ color: st.color, border: `1px solid ${st.color}40` }}>{st.label}</span>
            </div>
            <p className="text-[11px] text-white/40 mt-0.5">
              {typeLabel(comp.type)} · {metricLabel(comp.metric)} · {fmtRange(comp.start_date, comp.end_date)}
            </p>
            <p className="text-[10px] text-white/30 mt-0.5">
              {creditLabel(comp.credit_mode)}
              {comp.goal_mode === 'target' && comp.goal_target ? ` · Goal ${fmtScore(Number(comp.goal_target), comp.metric)}` : ''}
            </p>
            {comp.description && <p className="text-[12px] text-white/55 mt-1.5">{comp.description}</p>}
          </div>
          {canManage && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={() => onCopy(comp)} disabled={exporting} className={`p-1.5 rounded transition-colors disabled:opacity-40 ${copied ? 'text-emerald-400' : 'text-white/30 hover:text-teal hover:bg-teal/10'}`} title="Copy standings image to clipboard (paste into Canva)">{copied ? <Check size={13} /> : <Copy size={13} />}</button>
              <button onClick={() => onExport(comp)} disabled={exporting} className="p-1.5 rounded text-white/30 hover:text-teal hover:bg-teal/10 transition-colors disabled:opacity-40" title="Download standings as an image (PNG)"><Download size={13} /></button>
              <button onClick={() => onEdit(comp)} className="p-1.5 rounded text-white/30 hover:text-teal hover:bg-teal/10 transition-colors" title="Edit"><Pencil size={13} /></button>
              <button onClick={() => onDelete(comp)} className="p-1.5 rounded text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Delete"><Trash2 size={13} /></button>
            </div>
          )}
        </div>

        {/* Standings */}
        <div className="mt-3 space-y-0.5">
          {standings.length === 0 ? (
            <p className="text-[12px] text-white/30 px-3 py-2">No participants yet.</p>
          ) : (
            top.map(e => <StandRow key={e.id} e={e} comp={comp} deals={deals} users={users} canManage={canManage} mine={isMine(e)} />)
          )}
          {/* If the viewer is outside the visible top and not shown, pin their row */}
          {!open && myEntry && myEntry.rank > 5 && (
            <>
              <p className="text-center text-white/20 text-[11px]">···</p>
              <StandRow e={myEntry} comp={comp} deals={deals} users={users} canManage={canManage} mine />
            </>
          )}
        </div>

        {(standings.length > 5 || comp.rules) && (
          <button onClick={() => setOpen(o => !o)}
            className="mt-2 flex items-center gap-1 text-[11px] text-white/40 hover:text-white transition-colors">
            <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            {open ? 'Show less' : (standings.length > 5 ? `Show all ${standings.length}` : 'Details')}
          </button>
        )}

        {open && comp.rules && (
          <div className="mt-3 rounded-lg p-3 text-[12px] text-white/60 leading-snug" style={{ background: '#171717', border: '1px solid #262626' }}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-white/30 mb-1">Rules</p>
            {comp.rules}
          </div>
        )}
      </div>
    </div>
  )
}

// A clean, share-ready render of one competition's standings — same look as the
// live card, minus the admin buttons / drill-downs — captured to a PNG for
// dropping into Canva, slides, etc. Rendered off-screen only while exporting.
const exHeadCol  = 'rgba(255,255,255,0.3)'
function CompetitionExportCard({ comp, deals, users, ghostIds }) {
  // Hide ghost names (this image is a team-facing artifact, like what non-admins see).
  const standings = competitionStandings(comp, deals, users, { hiddenIds: ghostIds })
  const status = competitionStatus(comp, todayISO())
  const st = STATUS[status]
  return (
    <div style={{ width: 880, background: '#1a1a1a', padding: 28, fontFamily: 'Inter, Arial, sans-serif' }}>
      <div style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 16, padding: 24 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontSize: 22 }}>🏆</span>
          <h3 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>{comp.name}</h3>
          <span style={{ fontSize: 11, fontWeight: 600, color: st.color, border: `1px solid ${st.color}40`, borderRadius: 999, padding: '2px 10px' }}>{st.label}</span>
        </div>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: '2px 0 0' }}>
          {typeLabel(comp.type)} · {metricLabel(comp.metric)} · {fmtRange(comp.start_date, comp.end_date)}
        </p>
        <p style={{ fontSize: 11, color: exHeadCol, margin: '2px 0 0' }}>
          {creditLabel(comp.credit_mode)}
          {comp.goal_mode === 'target' && comp.goal_target ? ` · Goal ${fmtScore(Number(comp.goal_target), comp.metric)}` : ''}
        </p>
        {comp.description && <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', margin: '8px 0 0' }}>{comp.description}</p>}

        {/* Standings (full) */}
        <div style={{ marginTop: 16 }}>
          {standings.length === 0 ? (
            <p style={{ fontSize: 13, color: exHeadCol, padding: '8px 0' }}>No participants yet.</p>
          ) : standings.map(e => {
            const rc = RANK_COLOR[e.rank]
            const hasTarget = e.target > 0
            return (
              <div key={e.id} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', borderRadius: 8, background: e.rank <= 3 && rc ? rc + '14' : '#181818' }}>
                  <span style={{ width: 28, textAlign: 'center', fontSize: 15, fontWeight: 700, color: rc || 'rgba(255,255,255,0.45)' }}>
                    {e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : e.rank}
                  </span>
                  <span style={{ flex: 1, fontSize: 14, color: 'rgba(255,255,255,0.9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
                  {e.earned && <span style={{ fontSize: 10, fontWeight: 700, color: '#00b894', border: '1px solid #00b89455', borderRadius: 999, padding: '2px 8px' }}>🎉 Earned</span>}
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>{fmtScore(e.score, comp.metric)}</span>
                </div>
                {hasTarget && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 12px 6px' }}>
                    <span style={{ width: 28, flexShrink: 0 }} />
                    <div style={{ flex: 1, height: 6, borderRadius: 999, background: '#ffffff12', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.min((e.progress || 0) * 100, 100)}%`, background: e.earned ? '#00b894' : '#2dd4bf', borderRadius: 999 }} />
                    </div>
                    <span style={{ fontSize: 10, color: exHeadCol, whiteSpace: 'nowrap' }}>of {fmtScore(e.target, comp.metric)}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer / branding */}
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #262626', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#00b894', letterSpacing: 0.5 }}>TURF TIME</span>
          <span style={{ fontSize: 11, color: exHeadCol }}>{format(new Date(), 'MMM d, yyyy')}</span>
        </div>
      </div>
    </div>
  )
}

const slugName = (s) => String(s || 'competition').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'competition'

export default function Competitions() {
  const { profile, isAdmin } = useAuth()
  // Everyone can VIEW competitions/standings; only admins create/edit/delete.
  const canManage = isAdmin
  const [comps, setComps] = useState([])
  const [deals, setDeals] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editComp, setEditComp] = useState(null)
  const [exportComp, setExportComp] = useState(null)   // comp currently being captured
  const [exporting,  setExporting]  = useState(false)
  const [copiedId,   setCopiedId]   = useState('')     // comp id just copied
  const exportRef = useRef(null)

  const ghostIds = useMemo(() => new Set(users.filter(u => u.ghost).map(u => u.id)), [users])

  // Render the hidden export card for `comp`, let it paint, then run `fn` on the
  // node (snapshot to PNG / blob). Always tears the node back down afterward.
  async function withExportNode(comp, fn) {
    setExportComp(comp)
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    await new Promise(r => setTimeout(r, 60))
    try { if (exportRef.current) await fn(exportRef.current) }
    finally { setExportComp(null) }
  }

  async function downloadComp(comp) {
    await withExportNode(comp, async (node) => {
      const dataUrl = await toPng(node, { pixelRatio: 2, cacheBust: true })
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `${slugName(comp.name)}_standings.png`
      a.click()
    })
  }

  async function copyComp(comp) {
    await withExportNode(comp, async (node) => {
      const blob = await toBlob(node, { pixelRatio: 2, cacheBust: true })
      if (!blob) return
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })])
        setCopiedId(comp.id); setTimeout(() => setCopiedId(''), 1800)
      } else {
        // Clipboard images unsupported — fall back to a download.
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = `${slugName(comp.name)}_standings.png`; a.click()
        URL.revokeObjectURL(url)
      }
    })
  }

  async function exportOne(comp) {
    if (exporting) return
    setExporting(true)
    try { await downloadComp(comp) } finally { setExporting(false) }
  }
  async function copyOne(comp) {
    if (exporting) return
    setExporting(true)
    try { await copyComp(comp) } catch { /* clipboard blocked */ } finally { setExporting(false) }
  }
  async function exportAll() {
    if (exporting) return
    setExporting(true)
    try {
      for (const comp of sorted) {
        await downloadComp(comp)
        await new Promise(r => setTimeout(r, 200))   // stagger downloads
      }
    } finally { setExporting(false) }
  }

  useEffect(() => { load() }, [])
  async function load() {
    const [{ data: c }, { data: d }, { data: u }] = await Promise.all([fetchCompetitions(), fetchDeals(), fetchUsers()])
    setComps(c || []); setDeals(d || []); setUsers(u || []); setLoading(false)
  }

  const sorted = useMemo(() => {
    const rank = { active: 0, upcoming: 1, ended: 2 }
    return [...comps].sort((a, b) => rank[competitionStatus(a, todayISO())] - rank[competitionStatus(b, todayISO())])
  }, [comps])

  async function handleSave(data) {
    if (editComp) {
      setComps(cs => cs.map(c => c.id === editComp.id ? { ...c, ...data } : c))
      await updateCompetition(editComp.id, data)
    } else {
      await insertCompetition(data, profile?.id)
    }
    setModal(false); setEditComp(null); load()
  }
  async function handleDelete(comp) {
    if (!confirm(`Delete the competition "${comp.name}"? This cannot be undone.`)) return
    setComps(cs => cs.filter(c => c.id !== comp.id))
    const res = await deleteCompetition(comp.id)
    if (res?.error) load()
  }

  return (
    <div style={{ background: '#1a1a1a', color: '#fff', minHeight: '100%' }}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg md:text-xl font-bold text-white flex items-center gap-2"><Trophy size={18} className="text-teal" /> Competitions</h1>
          <p className="text-[12px] text-white/40 mt-0.5">See how you stack up in the contests we're running.</p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {sorted.length > 0 && (
              <button onClick={exportAll} disabled={exporting}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold text-white/70 hover:text-white transition-colors disabled:opacity-50"
                style={{ background: '#1e1e1e', border: '1px solid #2e2e2e' }}
                title="Download a PNG of every competition's standings (one per slide)">
                <Download size={15} /> {exporting ? 'Exporting…' : 'Export all'}
              </button>
            )}
            <button onClick={() => { setEditComp(null); setModal(true) }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold text-dark bg-teal hover:bg-teal-dark transition-colors">
              <Plus size={15} /> New
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="py-16 text-center text-white/30 text-sm">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl p-10 text-center text-white/40 text-[13px]" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
          No competitions yet.{canManage ? ' Click “New” to start one.' : ' Check back soon!'}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {sorted.map(comp => (
            <CompetitionCard key={comp.id} comp={comp} deals={deals} users={users}
              profileId={profile?.id} canManage={canManage} isAdmin={isAdmin}
              onEdit={(c) => { setEditComp(c); setModal(true) }} onDelete={handleDelete}
              onExport={exportOne} onCopy={copyOne} copied={copiedId === comp.id} exporting={exporting} />
          ))}
        </div>
      )}

      {/* Off-screen render used only to snapshot a competition to a PNG. */}
      {exportComp && (
        <div style={{ position: 'fixed', left: -99999, top: 0, pointerEvents: 'none', zIndex: -1 }} aria-hidden>
          <div ref={exportRef}>
            <CompetitionExportCard comp={exportComp} deals={deals} users={users} ghostIds={ghostIds} />
          </div>
        </div>
      )}

      {modal && (
        <CompetitionModal competition={editComp} users={users} isAdmin={isAdmin}
          onSave={handleSave} onClose={() => { setModal(false); setEditComp(null) }} />
      )}
    </div>
  )
}
