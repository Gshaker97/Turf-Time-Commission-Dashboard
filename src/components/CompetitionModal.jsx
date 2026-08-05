import { useState, useEffect, useMemo } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { COMP_TYPES, COMP_METRICS, COMP_GOAL_MODES, COMP_CREDIT_MODES } from '../utils/competition'
import { headIdSet } from '../utils/team'
import { weeksInRange } from '../utils/dateRanges'

const inputCls = 'w-full px-3 py-2 rounded-lg text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-teal/40 transition-colors'
const inputStyle = { background: '#1a1a1a', border: '1px solid #3a3a3a' }
const Inp = (props) => <input {...props} style={inputStyle} className={inputCls} />
const Sel = ({ children, ...props }) => <select {...props} style={inputStyle} className={inputCls}>{children}</select>
const Field = ({ label, children }) => (
  <div>
    <label className="block text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1.5">{label}</label>
    {children}
  </div>
)

const BLANK = {
  name: '', description: '', rules: '',
  type: 'individual', metric: 'revenue',
  goal_mode: 'race', goal_target: '',
  credit_mode: 'both', credit_split_pct: 0.5,
  start_date: '', end_date: '',
  participant_ids: [], manual_scores: {},
  sides: [], rounds: [],
}
const newId = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

export default function CompetitionModal({ competition, users = [], isAdmin = false, onSave, onClose }) {
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
  const needsPicks = form.type !== 'company' && !isSquads
  const pickList = form.type === 'team' ? managers : sellers
  const picked = new Set(form.participant_ids)

  function togglePick(id) {
    set('participant_ids', picked.has(id) ? form.participant_ids.filter(x => x !== id) : [...form.participant_ids, id])
  }
  function setManual(id, v) {
    setForm(f => ({ ...f, manual_scores: { ...f.manual_scores, [id]: v } }))
  }

  // ── Sides (squads) ──
  const addSide = () => set('sides', [...form.sides, { id: newId('s'), name: `Side ${form.sides.length + 1}`, team_ids: [], rep_ids: [] }])
  const patchSide = (id, patch) => set('sides', form.sides.map(s => s.id === id ? { ...s, ...patch } : s))
  const removeSide = (id) => set('sides', form.sides.filter(s => s.id !== id))
  const toggleIn = (list = [], id) => list.includes(id) ? list.filter(x => x !== id) : [...list, id]

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
      credit_split_pct: form.credit_mode === 'split'
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
      active: competition?.active ?? true,
    })
    setSaving(false)
  }

  const nameOf = (id) => users.find(u => u.id === id)?.name ?? '—'

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:justify-center md:items-center md:p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full md:max-w-2xl rounded-t-2xl md:rounded-2xl overflow-y-auto shadow-2xl"
        style={{ background: '#242424', border: '1px solid #333', maxHeight: '95dvh' }}>
        <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 sticky top-0 z-10"
          style={{ background: '#242424', borderBottom: '1px solid #2e2e2e' }}>
          <h2 className="text-[15px] font-semibold text-white">{competition ? 'Edit Competition' : 'New Competition'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/10 transition-colors"><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 md:p-6 space-y-4" style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
          <Field label="Name *">
            <Inp required value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Top Closer — March" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <Sel value={form.type} onChange={e => set('type', e.target.value)}>
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
              <Field label={form.metric === 'deals' ? 'Target (deals)' : 'Target ($ baseline)'}>
                <Inp type="number" step="any" min="0" value={form.goal_target}
                  onChange={e => set('goal_target', e.target.value)}
                  placeholder={form.metric === 'deals' ? 'e.g. 20' : 'e.g. 100000'} />
              </Field>
            )}
          </div>

          {/* Credit: how setter/closer are attributed */}
          <Field label="Who gets credit">
            <Sel value={form.credit_mode} onChange={e => set('credit_mode', e.target.value)}>
              {COMP_CREDIT_MODES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </Sel>
          </Field>
          {form.credit_mode === 'split' && (
            <div className="rounded-lg px-3 py-3 space-y-2" style={inputStyle}>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-white/60">Setter {Math.round((1 - (Number(form.credit_split_pct) || 0)) * 100)}%</span>
                <span className="text-white/60">Closer {Math.round((Number(form.credit_split_pct) || 0) * 100)}%</span>
              </div>
              <input type="range" min="0" max="100" step="5"
                value={Math.round((Number(form.credit_split_pct) || 0) * 100)}
                onChange={e => set('credit_split_pct', Number(e.target.value) / 100)}
                className="w-full accent-teal" />
              <p className="text-[10px] text-white/30">On a lead (setter ≠ closer), each earns this share of the deal toward the contest. Self-gen deals count fully for the one rep.</p>
            </div>
          )}

          <Field label="Description">
            <Inp value={form.description} onChange={e => set('description', e.target.value)} placeholder="Short summary shown on the card" />
          </Field>
          <Field label="Rules">
            <textarea value={form.rules} onChange={e => set('rules', e.target.value)} rows={2}
              placeholder="How it's scored, the prize, fine print…" style={inputStyle}
              className="w-full px-3 py-2 rounded-lg text-[13px] text-white placeholder-white/20 focus:outline-none resize-none" />
          </Field>

          {isSquads && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">Sides — group teams &amp; reps</label>
                <button type="button" onClick={addSide}
                  className="flex items-center gap-1 text-[11px] font-semibold text-teal hover:underline"><Plus size={12} /> Add side</button>
              </div>
              {form.sides.length === 0 && (
                <p className="text-[12px] text-white/40 rounded-lg px-3 py-2.5" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
                  Add at least two sides. Each side can be one team, several teams grouped together, individual reps, or any mix.
                </p>
              )}
              <div className="space-y-2">
                {form.sides.map(s => (
                  <div key={s.id} className="rounded-lg p-3 space-y-2" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
                    <div className="flex items-center gap-2">
                      <input value={s.name} onChange={e => patchSide(s.id, { name: e.target.value })} placeholder="Side name"
                        style={{ background: '#141414', border: '1px solid #3a3a3a' }}
                        className="flex-1 px-2.5 py-1.5 rounded-lg text-[13px] font-semibold text-white placeholder-white/20 focus:outline-none" />
                      <button type="button" onClick={() => removeSide(s.id)}
                        className="p-1.5 rounded text-white/25 hover:text-red-400" title="Remove side"><Trash2 size={13} /></button>
                    </div>
                    <div>
                      <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest mb-1">Whole teams</p>
                      <div className="flex flex-wrap gap-1.5">
                        {teamHeads.map(h => {
                          const on = (s.team_ids || []).includes(h.id)
                          return (
                            <button key={h.id} type="button" onClick={() => patchSide(s.id, { team_ids: toggleIn(s.team_ids, h.id) })}
                              className={`px-2 py-1 rounded-full text-[11px] font-semibold transition-colors ${on ? 'bg-teal text-dark' : 'text-white/50 hover:text-white'}`}
                              style={on ? undefined : { border: '1px solid #3a3a3a' }}>
                              {h.name.split(' ')[0]}'s Team
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <details>
                      <summary className="text-[11px] text-white/40 cursor-pointer hover:text-white/70 select-none">
                        Individual reps ({(s.rep_ids || []).length} added)
                      </summary>
                      <div className="mt-1.5 rounded-lg max-h-40 overflow-y-auto" style={{ background: '#141414', border: '1px solid #2a2a2a' }}>
                        {sellers.map(u => {
                          const on = (s.rep_ids || []).includes(u.id)
                          return (
                            <button key={u.id} type="button" onClick={() => patchSide(s.id, { rep_ids: toggleIn(s.rep_ids, u.id) })}
                              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-white/[0.04] transition-colors border-b border-white/5 last:border-0">
                              <span className="w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0"
                                style={on ? { background: '#00b894' } : { border: '1.5px solid rgba(255,255,255,0.3)' }}>
                                {on && <span className="text-dark text-[9px] font-bold">✓</span>}
                              </span>
                              <span className="text-[12px] text-white/85">{u.name}</span>
                              <span className="text-[9px] text-white/30 ml-auto uppercase">{u.role}</span>
                            </button>
                          )
                        })}
                      </div>
                      <p className="text-[10px] text-white/30 mt-1">Adds a rep on top of the whole teams — e.g. an unmanaged rep joining a side.</p>
                    </details>
                  </div>
                ))}
              </div>
              {form.sides.length > 0 && (
                <details className="mt-2">
                  <summary className="text-[11px] text-white/40 cursor-pointer hover:text-white/70 select-none">Manual score overrides (optional)</summary>
                  <div className="mt-2 space-y-1.5">
                    {form.sides.map(s => (
                      <div key={s.id} className="flex items-center gap-2">
                        <span className="text-[12px] text-white/60 flex-1 truncate">{s.name || 'Unnamed side'}</span>
                        <input type="number" step="any" value={form.manual_scores?.[s.id] ?? ''}
                          onChange={e => setManual(s.id, e.target.value)} placeholder="auto"
                          style={inputStyle} className="w-28 px-2 py-1.5 rounded-lg text-[12px] text-white text-right focus:outline-none" />
                      </div>
                    ))}
                    <p className="text-[10px] text-white/30">Leave blank to use the value calculated from deals.</p>
                  </div>
                </details>
              )}
              <p className="text-[10px] text-white/30 mt-1.5">
                Team membership follows the sale date — a deal counts for the side its rep's team owned when it was sold, so mid-contest roster moves never rewrite the score.
              </p>
            </div>
          )}

          {form.type === 'company' ? (
            <p className="text-[12px] text-white/40 rounded-lg px-3 py-2.5" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
              Company-wide automatically includes every rep and manager — no need to pick participants.
            </p>
          ) : isSquads ? null : (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">
                  {form.type === 'team' ? 'Teams (pick managers)' : 'Participants'}
                </label>
                <span className="text-[11px] text-white/30">{form.participant_ids.length} selected</span>
              </div>
              <div className="rounded-lg max-h-52 overflow-y-auto" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
                {pickList.map(u => {
                  const on = picked.has(u.id)
                  return (
                    <button key={u.id} type="button" onClick={() => togglePick(u.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[0.04] transition-colors border-b border-white/5 last:border-0">
                      <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                        style={on ? { background: '#00b894' } : { border: '1.5px solid rgba(255,255,255,0.3)' }}>
                        {on && <span className="text-dark text-[10px] font-bold">✓</span>}
                      </span>
                      <span className="text-[13px] text-white/85">{u.name}{form.type === 'team' ? "'s Team" : ''}</span>
                      <span className="text-[10px] text-white/30 ml-auto uppercase">{u.role}</span>
                    </button>
                  )
                })}
                {pickList.length === 0 && <div className="px-3 py-3 text-[12px] text-white/30">No people available.</div>}
              </div>

              {/* Optional manual score overrides */}
              {form.participant_ids.length > 0 && (
                <details className="mt-2">
                  <summary className="text-[11px] text-white/40 cursor-pointer hover:text-white/70 select-none">Manual score overrides (optional)</summary>
                  <div className="mt-2 space-y-1.5">
                    {form.participant_ids.map(id => (
                      <div key={id} className="flex items-center gap-2">
                        <span className="text-[12px] text-white/60 flex-1 truncate">{nameOf(id)}{form.type === 'team' ? "'s Team" : ''}</span>
                        <input type="number" step="any" value={form.manual_scores?.[id] ?? ''}
                          onChange={e => setManual(id, e.target.value)} placeholder="auto"
                          style={inputStyle} className="w-28 px-2 py-1.5 rounded-lg text-[12px] text-white text-right focus:outline-none" />
                      </div>
                    ))}
                    <p className="text-[10px] text-white/30">Leave blank to use the value calculated from deals.</p>
                  </div>
                </details>
              )}
            </div>
          )}

          {/* ── Rounds (optional, any type) ── */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">Rounds (optional)</label>
              <div className="flex items-center gap-3">
                {form.start_date && form.end_date && (
                  <button type="button" onClick={autoWeeklyRounds}
                    className="text-[11px] font-semibold text-white/40 hover:text-teal transition-colors"
                    title="One round per Sun–Sat week across the competition dates">
                    Auto-split into weeks
                  </button>
                )}
                <button type="button" onClick={addRound}
                  className="flex items-center gap-1 text-[11px] font-semibold text-teal hover:underline"><Plus size={12} /> Add round</button>
              </div>
            </div>
            {form.rounds.length === 0 ? (
              <p className="text-[11px] text-white/30 rounded-lg px-3 py-2" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
                No rounds — the competition runs as one race. Add rounds to give each stretch its own dates and prize (every round starts fresh at zero).
              </p>
            ) : (
              <div className="space-y-1.5">
                {form.rounds.map(r => (
                  <div key={r.id} className="rounded-lg p-2.5 grid grid-cols-2 md:grid-cols-[110px_1fr_1fr_1.4fr_28px] gap-1.5 items-center"
                    style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
                    <input value={r.name} onChange={e => patchRound(r.id, { name: e.target.value })} placeholder="Round name"
                      style={{ background: '#141414', border: '1px solid #3a3a3a' }}
                      className="px-2 py-1.5 rounded-lg text-[12px] font-semibold text-white placeholder-white/20 focus:outline-none" />
                    <input type="date" value={r.start} onChange={e => patchRound(r.id, { start: e.target.value })}
                      style={{ background: '#141414', border: '1px solid #3a3a3a' }}
                      className="px-2 py-1.5 rounded-lg text-[12px] text-white focus:outline-none" />
                    <input type="date" value={r.end} onChange={e => patchRound(r.id, { end: e.target.value })}
                      style={{ background: '#141414', border: '1px solid #3a3a3a' }}
                      className="px-2 py-1.5 rounded-lg text-[12px] text-white focus:outline-none" />
                    <input value={r.prize} onChange={e => patchRound(r.id, { prize: e.target.value })} placeholder="Prize (e.g. $250)"
                      style={{ background: '#141414', border: '1px solid #3a3a3a' }}
                      className="px-2 py-1.5 rounded-lg text-[12px] text-white placeholder-white/20 focus:outline-none col-span-2 md:col-span-1" />
                    <button type="button" onClick={() => removeRound(r.id)}
                      className="p-1.5 rounded text-white/25 hover:text-red-400 justify-self-end" title="Remove round"><Trash2 size={13} /></button>
                  </div>
                ))}
                <p className="text-[10px] text-white/30">Each round is scored fresh from zero; overall standings across the whole date range show alongside. Winners are auto-crowned when a round ends — you can override on the card for ties.</p>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={saving || !form.name.trim()}
              className="flex-1 py-3 rounded-xl text-[14px] font-bold text-dark bg-teal hover:bg-teal-dark disabled:opacity-50 transition-colors">
              {saving ? 'Saving…' : competition ? 'Save changes' : 'Create competition'}
            </button>
            <button type="button" onClick={onClose}
              className="px-6 py-3 rounded-xl text-[13px] font-medium text-white/50 hover:text-white transition-colors" style={{ border: '1px solid #3a3a3a' }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
