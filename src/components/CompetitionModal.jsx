import { useState, useEffect, useMemo } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { COMP_TYPES, COMP_METRICS, COMP_GOAL_MODES, COMP_CREDIT_MODES, teamAvgRoster } from '../utils/competition'
import { headIdSet, teamLabel } from '../utils/team'
import { weeksInRange } from '../utils/dateRanges'
import { SURFACE, GOLD_WASH, FieldLabel, Input, Select, PrimaryButton, SecondaryButton, IconButton } from './ui'

// Private Bank form controls (44px tall on phones). Styling only.
const inputStyle = SURFACE.well
const Inp = (props) => <Input {...props} style={inputStyle} />
const Sel = ({ children, ...props }) => <Select {...props} style={inputStyle}>{children}</Select>
const Field = ({ label, children }) => (
  <div>
    <FieldLabel>{label}</FieldLabel>
    {children}
  </div>
)
const PANEL = { ...SURFACE.well, borderRadius: 12 }
const WELL_INPUT = { ...SURFACE.raise }
const eyebrow = 'text-[13px] font-semibold text-bank-fa uppercase tracking-wide'
const smallIn = 'px-2.5 py-1.5 min-h-[44px] md:min-h-0 rounded-lg text-[13px] text-bank-tx placeholder-bank-fa focus:outline-none'
const SLIDER = 'w-full accent-[#bfa46c] min-h-[44px] md:min-h-0'
const linkBtn = 'inline-flex items-center gap-1 text-[13px] font-semibold text-bank-gold-tx hover:underline min-h-[44px] md:min-h-0'
const chip = (on) => `px-2.5 py-1.5 min-h-[44px] md:min-h-0 rounded-full text-[13px] font-semibold transition-colors ${on ? 'text-bank-gold-tx' : 'text-bank-mu hover:text-bank-tx'}`
const chipStyle = (on) => on ? GOLD_WASH : { border: '1px solid var(--line)' }
const checkRow = 'w-full flex items-center gap-2.5 px-3 py-2 min-h-[44px] text-left hover:bg-bank-raise transition-colors border-b border-bank-line last:border-0'
const Box = ({ on }) => (
  <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
    style={on ? { background: 'var(--gold)' } : { border: '1.5px solid var(--mu)' }}>
    {on && <span className="text-[10px] font-bold" style={{ color: 'var(--gold-ink)' }}>✓</span>}
  </span>
)

const BLANK = {
  name: '', description: '', rules: '',
  type: 'individual', metric: 'revenue',
  goal_mode: 'race', goal_target: '',
  credit_mode: 'both', credit_split_pct: 0.5,
  start_date: '', end_date: '',
  participant_ids: [], manual_scores: {},
  sides: [], rounds: [],
  excluded_ids: [],   // Team Average: people left out of both the total and the head count
}
const newId = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

// `deals` + `teamCtx` feed the Team Average roster chips — the SAME roster the
// engine divides by (teamAvgRoster), so the modal can never list someone the
// score ignores or hide someone it counts.
export default function CompetitionModal({ competition, users = [], deals = [], teamCtx = null, isAdmin = false, onSave, onClose }) {
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (competition) {
      setForm({
        ...BLANK, ...competition,
        description: competition.description ?? '', rules: competition.rules ?? '',
        goal_mode: competition.goal_mode ?? 'race',
        goal_target: competition.goal_target ?? '',
        credit_mode: competition.credit_mode ?? 'both',
        credit_split_pct: competition.credit_split_pct ?? 0.5,
        start_date: competition.start_date ?? '', end_date: competition.end_date ?? '',
        participant_ids: competition.participant_ids ?? [],
        manual_scores: competition.manual_scores ?? {},
        sides: competition.sides ?? [],
        rounds: (competition.rounds ?? []).map(r => ({ ...r, prize: r.prize ?? '' })),
        excluded_ids: competition.excluded_ids ?? [],
      })
    } else setForm(BLANK)
  }, [competition])

  const visible  = (u) => isAdmin || !u.ghost   // ghosts only selectable by admins
  const sellers  = useMemo(() => users.filter(u => ['rep', 'manager', 'director', 'vp'].includes(u.role) && visible(u)), [users, isAdmin])
  const managers = useMemo(() => users.filter(u => u.role === 'manager' && visible(u)), [users, isAdmin])
  // Team heads for the squads builder — the shared rule (managers + a
  // director/VP with active directs, e.g. Garrison).
  const teamHeads = useMemo(() => {
    const heads = headIdSet(users)
    return users.filter(u => heads.has(u.id) && visible(u)).sort((a, b) => a.name.localeCompare(b.name))
  }, [users, isAdmin])
  const isSquads = form.type === 'squads'
  const isTeamAvg = form.type === 'team_avg'
  const isTeamPick = form.type === 'team' || isTeamAvg   // entrants are TEAMS (head ids)
  const needsPicks = form.type !== 'company' && !isSquads
  // Team Average picks from every team head (incl. a director with directs,
  // same rule as the People chart); the older 'team' type keeps managers only.
  const pickList = isTeamAvg ? teamHeads : form.type === 'team' ? managers : sellers
  const picked = new Set(form.participant_ids)
  // Team Average: who would count toward each picked team — the engine's own
  // roster rule (active members as of the window end ∪ anyone who earned
  // credit in the window), head first, then A–Z. Deactivated earners are
  // listed too (tagged) since they're in the divisor until left out.
  const usersById = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users])
  const rosterComp = { type: 'team_avg', metric: form.metric, credit_mode: form.credit_mode,
    start_date: form.start_date || null, end_date: form.end_date || null, excluded_ids: [] }
  const rosterOf = (head) => teamAvgRoster(head.id, deals, users, rosterComp, teamCtx)
    .map(id => usersById[id]).filter(u => u && visible(u))
    .sort((a, b) => (a.id === head.id ? -1 : b.id === head.id ? 1 : a.name.localeCompare(b.name)))
  // Declared before its first use: a const read above its declaration is a
  // temporal-dead-zone throw the build cannot see (it white-screened Leads).
  const toggleIn = (list = [], id) => list.includes(id) ? list.filter(x => x !== id) : [...list, id]
  const excluded = new Set(form.excluded_ids || [])
  const toggleExcluded = (id) => set('excluded_ids', toggleIn(form.excluded_ids, id))
  // Every id that can legitimately be excluded = the union of picked rosters.
  // Anything else in excluded_ids is stale (a team unpicked, a rep moved) and
  // is shown separately so it can be toggled back — and pruned on save.
  const pickedHeads = isTeamAvg ? form.participant_ids.map(id => usersById[id]).filter(Boolean) : []
  const rosterIds = new Set(pickedHeads.flatMap(h => rosterOf(h).map(u => u.id)))
  const strayExcluded = (form.excluded_ids || []).filter(id => !rosterIds.has(id))

  function togglePick(id) {
    set('participant_ids', picked.has(id) ? form.participant_ids.filter(x => x !== id) : [...form.participant_ids, id])
  }
  // Switching type swaps the pick list (reps ↔ managers ↔ all heads); keep only
  // picks that exist in the new list so a rep id can't linger as a "team".
  function changeType(t) {
    const heads = headIdSet(users)
    const ok = t === 'team_avg' ? (id) => heads.has(id)
      : t === 'team' ? (id) => usersById[id]?.role === 'manager'
      : (id) => ['rep', 'manager', 'director', 'vp'].includes(usersById[id]?.role)
    setForm(f => ({ ...f, type: t, participant_ids: (f.participant_ids || []).filter(ok) }))
  }
  function setManual(id, v) {
    setForm(f => ({ ...f, manual_scores: { ...f.manual_scores, [id]: v } }))
  }

  // ── Sides (squads) ──
  const addSide = () => set('sides', [...form.sides, { id: newId('s'), name: `Side ${form.sides.length + 1}`, team_ids: [], rep_ids: [] }])
  const patchSide = (id, patch) => set('sides', form.sides.map(s => s.id === id ? { ...s, ...patch } : s))
  const removeSide = (id) => set('sides', form.sides.filter(s => s.id !== id))

  // ── Rounds ──
  const addRound = () => set('rounds', [...form.rounds, { id: newId('r'), name: `Round ${form.rounds.length + 1}`, start: '', end: '', prize: '', winner_id: null }])
  const patchRound = (id, patch) => set('rounds', form.rounds.map(r => r.id === id ? { ...r, ...patch } : r))
  const removeRound = (id) => set('rounds', form.rounds.filter(r => r.id !== id))
  // One round per Sun–Sat week across the competition's date range.
  function autoWeeklyRounds() {
    if (!form.start_date || !form.end_date) return
    const weeks = weeksInRange(form.start_date, form.end_date)
    set('rounds', weeks.map((w, i) => ({
      id: newId('r'),
      name: `Round ${i + 1}`,
      start: w.weekStart < form.start_date ? form.start_date : w.weekStart,
      end: w.weekEnd > form.end_date ? form.end_date : w.weekEnd,
      prize: '', winner_id: null,
    })))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    // keep only non-empty numeric manual overrides, and only for picked entrants
    const manual = {}
    for (const id of form.participant_ids) {
      const v = form.manual_scores?.[id]
      if (v !== '' && v != null && !Number.isNaN(Number(v))) manual[id] = Number(v)
    }
    // Squads keep manual overrides keyed by side id.
    const squadManual = {}
    if (isSquads) {
      for (const s of form.sides) {
        const v = form.manual_scores?.[s.id]
        if (v !== '' && v != null && !Number.isNaN(Number(v))) squadManual[s.id] = Number(v)
      }
    }
    await onSave({
      name: form.name.trim(),
      description: form.description.trim() || null,
      rules: form.rules.trim() || null,
      type: form.type,
      metric: form.metric,
      goal_mode: form.goal_mode,
      goal_target: form.goal_mode === 'target' && form.goal_target !== '' ? Number(form.goal_target) : null,
      credit_mode: form.credit_mode,
      // 'lead_bonus' reuses this column as the CLOSER's part share, so it has
      // to survive the save the same way 'split' does.
      credit_split_pct: (form.credit_mode === 'split' || form.credit_mode === 'lead_bonus')
        ? Math.min(1, Math.max(0, Number(form.credit_split_pct) || 0)) : null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      participant_ids: needsPicks ? form.participant_ids : [],
      manual_scores: isSquads ? squadManual : needsPicks ? manual : {},
      sides: isSquads
        ? form.sides.filter(s => (s.team_ids?.length || s.rep_ids?.length || s.name?.trim()))
        : [],
      rounds: form.rounds
        .filter(r => r.start && r.end)
        .map(r => ({ ...r, name: (r.name || '').trim() || 'Round', prize: (r.prize || '').trim() || null }))
        .sort((a, b) => String(a.start).localeCompare(String(b.start))),
      // Only people on a picked team's roster — a stale id (team unpicked, rep
      // moved away) would otherwise silently zero them if they resurfaced.
      excluded_ids: isTeamAvg ? (form.excluded_ids || []).filter(id => rosterIds.has(id)) : [],
      active: competition?.active ?? true,
    })
    setSaving(false)
  }

  const nameOf = (id) => users.find(u => u.id === id)?.name ?? '—'

  return (
    // z-[60] so the sheet covers the mobile bottom nav; full height on phones with a sticky action bar.
    <div className="fixed inset-0 z-[60] flex flex-col justify-end md:justify-center md:items-center md:p-4">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(3px)' }} onClick={onClose} />
      <div className="relative w-full md:max-w-2xl h-[100dvh] md:h-auto md:max-h-[95dvh] rounded-none md:rounded-2xl overflow-y-auto flex flex-col"
        style={{ ...SURFACE.card, boxShadow: 'var(--card-shadow), 0 24px 60px rgba(0,0,0,0.55)', color: 'var(--tx)' }}
        role="dialog" aria-modal="true" aria-label={competition ? 'Edit Competition' : 'New Competition'}>
        <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 sticky top-0 z-10"
          style={{ background: 'var(--card)', borderBottom: '1px solid var(--line)' }}>
          <h2 className="text-[15px] font-bold text-bank-tx">{competition ? 'Edit Competition' : 'New Competition'}</h2>
          <IconButton onClick={onClose} aria-label="Close"><X size={16} /></IconButton>
        </div>

        <form onSubmit={handleSubmit} className="p-4 md:p-6 space-y-4 flex-1 flex flex-col">
          <Field label="Name *">
            <Inp required value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Top Closer — March" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <Sel value={form.type} onChange={e => changeType(e.target.value)}>
                {COMP_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </Sel>
            </Field>
            <Field label="Metric">
              <Sel value={form.metric} onChange={e => set('metric', e.target.value)}>
                {COMP_METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
              </Sel>
            </Field>
            <Field label="Start date">
              <Inp type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} />
            </Field>
            <Field label="End date">
              <Inp type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} />
            </Field>
          </div>

          {/* Goal: race vs. reach a target */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Goal">
              <Sel value={form.goal_mode} onChange={e => set('goal_mode', e.target.value)}>
                {COMP_GOAL_MODES.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
              </Sel>
            </Field>
            {form.goal_mode === 'target' && (
              <Field label={isTeamAvg
                ? (form.metric === 'deals' ? 'Target (avg deals per rep)' : 'Target (avg $ baseline per rep)')
                : (form.metric === 'deals' ? 'Target (deals)' : 'Target ($ baseline)')}>
                <Inp type="number" step="any" min="0" value={form.goal_target}
                  onChange={e => set('goal_target', e.target.value)}
                  placeholder={isTeamAvg ? (form.metric === 'deals' ? 'e.g. 4' : 'e.g. 25000') : (form.metric === 'deals' ? 'e.g. 20' : 'e.g. 100000')} />
              </Field>
            )}
          </div>

          {/* Credit: how setter/closer are attributed */}
          <Field label="Who gets credit">
            <Sel value={form.credit_mode} onChange={e => set('credit_mode', e.target.value)}>
              {COMP_CREDIT_MODES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </Sel>
          </Field>
          {form.credit_mode === 'lead_bonus' && (
            <div className="px-3 py-3 space-y-2" style={PANEL}>
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-bank-mu">Setter 100%</span>
                <span className="text-bank-mu">Closer {Math.round((Number(form.credit_split_pct) || 0) * 100)}%</span>
              </div>
              <input type="range" min="0" max="100" step="5" aria-label="Closer share on a lead"
                value={Math.round((Number(form.credit_split_pct) || 0) * 100)}
                onChange={e => set('credit_split_pct', Number(e.target.value) / 100)}
                className={SLIDER} />
              <p className="text-[13px] text-bank-mu">
                The setter always keeps a full credit; the closer earns this much on top for closing
                someone else&rsquo;s lead, so one lead is worth{' '}
                {(1 + (Number(form.credit_split_pct) || 0)).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} to the contest.
                A self-gen counts once &mdash; no lead changed hands.
                {(form.type === 'team' || form.type === 'squads' || form.type === 'team_avg') &&
                  ' On a team contest a deal still counts once, so this only changes individual standings.'}
              </p>
            </div>
          )}
          {form.credit_mode === 'split' && (
            <div className="px-3 py-3 space-y-2" style={PANEL}>
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-bank-mu">Setter {Math.round((1 - (Number(form.credit_split_pct) || 0)) * 100)}%</span>
                <span className="text-bank-mu">Closer {Math.round((Number(form.credit_split_pct) || 0) * 100)}%</span>
              </div>
              <input type="range" min="0" max="100" step="5" aria-label="Closer share of a split"
                value={Math.round((Number(form.credit_split_pct) || 0) * 100)}
                onChange={e => set('credit_split_pct', Number(e.target.value) / 100)}
                className={SLIDER} />
              <p className="text-[13px] text-bank-mu">On a lead (setter ≠ closer), each earns this share of the deal toward the contest. Self-gen deals count fully for the one rep.</p>
            </div>
          )}

          <Field label="Description">
            <Inp value={form.description} onChange={e => set('description', e.target.value)} placeholder="Short summary shown on the card" />
          </Field>
          <Field label="Rules">
            <textarea value={form.rules} onChange={e => set('rules', e.target.value)} rows={2}
              placeholder="How it's scored, the prize, fine print…" style={inputStyle}
              className="w-full px-3 py-2 rounded-lg text-[13px] text-bank-tx placeholder-bank-fa focus:outline-none resize-none" />
          </Field>

          {isSquads && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className={eyebrow}>Sides — group teams &amp; reps</label>
                <button type="button" onClick={addSide} className={linkBtn}><Plus size={12} /> Add side</button>
              </div>
              {form.sides.length === 0 && (
                <p className="text-[13px] text-bank-mu px-3 py-2.5" style={PANEL}>
                  Add at least two sides. Each side can be one team, several teams grouped together, individual reps, or any mix.
                </p>
              )}
              <div className="space-y-2">
                {form.sides.map(s => (
                  <div key={s.id} className="p-3 space-y-2" style={PANEL}>
                    <div className="flex items-center gap-2">
                      <input value={s.name} onChange={e => patchSide(s.id, { name: e.target.value })} placeholder="Side name" aria-label="Side name"
                        style={WELL_INPUT} className={`${smallIn} flex-1 font-semibold`} />
                      <IconButton onClick={() => removeSide(s.id)} title="Remove side" aria-label="Remove side"><Trash2 size={13} /></IconButton>
                    </div>
                    <div>
                      <p className={`${eyebrow} mb-1`}>Whole teams</p>
                      <div className="flex flex-wrap gap-1.5">
                        {teamHeads.map(h => {
                          const on = (s.team_ids || []).includes(h.id)
                          return (
                            <button key={h.id} type="button" onClick={() => patchSide(s.id, { team_ids: toggleIn(s.team_ids, h.id) })}
                              aria-pressed={on} className={chip(on)} style={chipStyle(on)}>
                              {teamLabel(h)}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <details>
                      <summary className="text-[13px] text-bank-mu cursor-pointer hover:text-bank-tx select-none min-h-[44px] md:min-h-0 flex items-center">
                        Individual reps ({(s.rep_ids || []).length} added)
                      </summary>
                      <div className="mt-1.5 rounded-lg max-h-40 overflow-y-auto" style={WELL_INPUT}>
                        {sellers.map(u => {
                          const on = (s.rep_ids || []).includes(u.id)
                          return (
                            <button key={u.id} type="button" onClick={() => patchSide(s.id, { rep_ids: toggleIn(s.rep_ids, u.id) })}
                              aria-pressed={on} className={checkRow}>
                              <Box on={on} />
                              <span className="text-[13px] text-bank-tx">{u.name}</span>
                              <span className="text-[12px] text-bank-fa ml-auto uppercase">{u.role}</span>
                            </button>
                          )
                        })}
                      </div>
                      <p className="text-[13px] text-bank-mu mt-1">Adds a rep on top of the whole teams — e.g. an unmanaged rep joining a side.</p>
                    </details>
                  </div>
                ))}
              </div>
              {form.sides.length > 0 && (
                <details className="mt-2">
                  <summary className="text-[13px] text-bank-mu cursor-pointer hover:text-bank-tx select-none min-h-[44px] md:min-h-0 flex items-center">Manual score overrides (optional)</summary>
                  <div className="mt-2 space-y-1.5">
                    {form.sides.map(s => (
                      <div key={s.id} className="flex items-center gap-2">
                        <span className="text-[13px] text-bank-mu flex-1 truncate">{s.name || 'Unnamed side'}</span>
                        <input type="number" step="any" value={form.manual_scores?.[s.id] ?? ''} aria-label={`Manual score for ${s.name || 'side'}`}
                          onChange={e => setManual(s.id, e.target.value)} placeholder="auto"
                          style={inputStyle} className={`${smallIn} w-28 text-right`} />
                      </div>
                    ))}
                    <p className="text-[13px] text-bank-mu">Leave blank to use the value calculated from deals.</p>
                  </div>
                </details>
              )}
              <p className="text-[13px] text-bank-mu mt-1.5">
                Team membership follows the sale date — a deal counts for the side its rep's team owned when it was sold, so mid-contest roster moves never rewrite the score.
              </p>
            </div>
          )}

          {form.type === 'company' ? (
            <p className="text-[13px] text-bank-mu px-3 py-2.5" style={PANEL}>
              Company-wide automatically includes every rep and manager — no need to pick participants.
            </p>
          ) : isSquads ? null : (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className={eyebrow}>
                  {form.type === 'team' ? 'Teams (pick managers)' : isTeamAvg ? 'Teams competing' : 'Participants'}
                </label>
                <span className="text-[13px] text-bank-mu">{form.participant_ids.length} selected</span>
              </div>
              <div className="rounded-lg max-h-52 overflow-y-auto" style={PANEL}>
                {pickList.map(u => {
                  const on = picked.has(u.id)
                  return (
                    <button key={u.id} type="button" onClick={() => togglePick(u.id)} aria-pressed={on} className={checkRow}>
                      <Box on={on} />
                      <span className="text-[13px] text-bank-tx">{isTeamPick ? teamLabel(u) : u.name}</span>
                      <span className="text-[12px] text-bank-fa ml-auto uppercase">{u.role}</span>
                    </button>
                  )
                })}
                {pickList.length === 0 && <div className="px-3 py-3 text-[13px] text-bank-mu">No people available.</div>}
              </div>

              {/* Team Average: who counts toward each team's average. Untick a
                  part-timer and they leave BOTH sides — their deals stop
                  counting for the team and they stop counting as a rep. */}
              {isTeamAvg && form.participant_ids.length > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className={eyebrow}>Who counts toward the average</label>
                    <span className="text-[13px] text-bank-mu">{form.excluded_ids?.length || 0} left out</span>
                  </div>
                  <div className="rounded-lg divide-y divide-bank-line max-h-72 overflow-y-auto" style={PANEL}>
                    {form.participant_ids.map(hid => {
                      const head = users.find(u => u.id === hid)
                      if (!head) return null
                      const roster = rosterOf(head)
                      const counted = roster.filter(u => !excluded.has(u.id)).length
                      return (
                        <div key={hid} className="px-3 py-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[13px] font-semibold text-bank-tx">{teamLabel(head)}</span>
                            <span className="text-[13px] text-bank-mu">{counted} of {roster.length} count</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {roster.map(u => {
                              const on = !excluded.has(u.id)
                              return (
                                <button key={u.id} type="button" onClick={() => toggleExcluded(u.id)} aria-pressed={on}
                                  title={on ? 'Counts — click to leave out' : 'Left out — click to count'}
                                  className={`px-2.5 py-1.5 min-h-[44px] md:min-h-0 rounded-full text-[13px] font-medium transition-colors ${on ? 'text-bank-gold-tx' : 'text-bank-fa line-through'}`}
                                  style={chipStyle(on)}>
                                  {u.name}
                                  {u.id === head.id ? <span className="text-[12px] uppercase tracking-wide opacity-70"> · {u.role}</span> : ''}
                                  {u.active === false ? <span className="text-[12px] uppercase tracking-wide opacity-70"> · deactivated</span> : ''}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                    {strayExcluded.length > 0 && (
                      <div className="px-3 py-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[13px] font-semibold" style={{ color: 'var(--warn)' }}>Also left out (not on a picked team)</span>
                          <span className="text-[13px] text-bank-mu">dropped on save</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {strayExcluded.map(id => (
                            <button key={id} type="button" onClick={() => toggleExcluded(id)} title="Click to remove from the left-out list"
                              className="px-2.5 py-1.5 min-h-[44px] md:min-h-0 rounded-full text-[13px] font-medium text-bank-fa line-through" style={{ border: '1px solid var(--line)' }}>
                              {nameOf(id)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <p className="text-[13px] text-bank-mu mt-1.5">
                    Each team's score is its {form.metric === 'deals' ? 'deal count' : 'baseline revenue'} ÷ the people who count.
                    Someone left out contributes no deals and isn't counted as a rep. Listed: everyone on the team as of the
                    contest's end (today while it runs) plus anyone who earned credit in the window — the same people the score divides by.
                    Set the dates first so the list matches the contest.
                  </p>
                </div>
              )}

              {/* Optional manual score overrides */}
              {form.participant_ids.length > 0 && (
                <details className="mt-2">
                  <summary className="text-[13px] text-bank-mu cursor-pointer hover:text-bank-tx select-none min-h-[44px] md:min-h-0 flex items-center">Manual score overrides (optional)</summary>
                  <div className="mt-2 space-y-1.5">
                    {form.participant_ids.map(id => (
                      <div key={id} className="flex items-center gap-2">
                        <span className="text-[13px] text-bank-mu flex-1 truncate">{isTeamPick ? teamLabel(users.find(x => x.id === id)) : nameOf(id)}</span>
                        <input type="number" step="any" value={form.manual_scores?.[id] ?? ''} aria-label="Manual score"
                          onChange={e => setManual(id, e.target.value)} placeholder="auto"
                          style={inputStyle} className={`${smallIn} w-28 text-right`} />
                      </div>
                    ))}
                    <p className="text-[13px] text-bank-mu">Leave blank to use the value calculated from deals.</p>
                  </div>
                </details>
              )}
            </div>
          )}

          {/* ── Rounds (optional, any type) ── */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={eyebrow}>Rounds (optional)</label>
              <div className="flex items-center gap-3">
                {form.start_date && form.end_date && (
                  <button type="button" onClick={autoWeeklyRounds}
                    className="text-[13px] font-semibold text-bank-mu hover:text-bank-tx transition-colors min-h-[44px] md:min-h-0"
                    title="One round per Sun–Sat week across the competition dates">
                    Auto-split into weeks
                  </button>
                )}
                <button type="button" onClick={addRound} className={linkBtn}><Plus size={12} /> Add round</button>
              </div>
            </div>
            {form.rounds.length === 0 ? (
              <p className="text-[13px] text-bank-mu px-3 py-2.5" style={PANEL}>
                No rounds — the competition runs as one race. Add rounds to give each stretch its own dates and prize (every round starts fresh at zero).
              </p>
            ) : (
              <div className="space-y-1.5">
                {form.rounds.map(r => (
                  <div key={r.id} className="p-2.5 grid grid-cols-2 md:grid-cols-[110px_1fr_1fr_1.4fr_44px] gap-1.5 items-center" style={PANEL}>
                    <input value={r.name} onChange={e => patchRound(r.id, { name: e.target.value })} placeholder="Round name" aria-label="Round name"
                      style={WELL_INPUT} className={`${smallIn} font-semibold`} />
                    <input type="date" value={r.start} onChange={e => patchRound(r.id, { start: e.target.value })} aria-label="Round start"
                      style={WELL_INPUT} className={smallIn} />
                    <input type="date" value={r.end} onChange={e => patchRound(r.id, { end: e.target.value })} aria-label="Round end"
                      style={WELL_INPUT} className={smallIn} />
                    <input value={r.prize} onChange={e => patchRound(r.id, { prize: e.target.value })} placeholder="Prize (e.g. $250)" aria-label="Round prize"
                      style={WELL_INPUT} className={`${smallIn} col-span-2 md:col-span-1`} />
                    <IconButton onClick={() => removeRound(r.id)} title="Remove round" aria-label="Remove round" className="justify-self-end"><Trash2 size={13} /></IconButton>
                  </div>
                ))}
                <p className="text-[13px] text-bank-mu">Each round is scored fresh from zero; overall standings across the whole date range show alongside. Winners are auto-crowned when a round ends — you can override on the card for ties.</p>
              </div>
            )}
          </div>

          {/* Actions — on phones this bar sticks to the bottom of the sheet */}
          <div className="sticky bottom-0 -mx-4 md:mx-0 px-4 md:px-0 pt-3 pb-3 md:pb-0 mt-auto flex gap-3 md:static"
            style={{ background: 'var(--card)', borderTop: '1px solid var(--line)', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
            <PrimaryButton type="submit" disabled={saving || !form.name.trim()} className="flex-1 py-3 text-[14px]">
              {saving ? 'Saving…' : competition ? 'Save changes' : 'Create competition'}
            </PrimaryButton>
            <SecondaryButton type="button" onClick={onClose} className="px-6 min-h-[44px]">Cancel</SecondaryButton>
          </div>
        </form>
      </div>
    </div>
  )
}
