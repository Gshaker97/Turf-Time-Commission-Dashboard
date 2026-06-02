import { Calendar } from 'lucide-react'
import { PRESETS, matchPreset, rangeMatches } from '../utils/dateRanges'

// Reusable date-range filter: a polished row of preset pills plus optional
// custom from/to inputs. Controlled via `from`/`to`; reports changes through
// onChange({ from, to, preset }). The active preset is derived from the dates,
// so callers only need to track from/to.
const dateInputCls   = 'h-8 rounded-lg text-[12px] text-white focus:outline-none focus:border-teal/50 transition-colors'
const dateInputStyle = { background: '#1e1e1e', border: '1px solid #333' }

export default function DateRangeFilter({
  from,
  to,
  onChange,
  preset,
  presets = PRESETS,
  count,
  countLabel = 'records',
  showCustom = true,
  className = '',
}) {
  // Trust the caller's chosen preset when its range still matches the dates
  // (resolves coincident ranges like This Week == MTD); otherwise derive it.
  const active = (preset && rangeMatches(preset, from, to)) ? preset : matchPreset(from, to)

  const applyPreset = (p) => {
    const r = p.range()
    onChange({ from: r.from, to: r.to, preset: p.key })
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Preset pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex flex-wrap gap-1 p-1 rounded-xl"
          style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
          {presets.map(p => {
            const on = active === p.key
            return (
              <button
                key={p.key}
                onClick={() => applyPreset(p)}
                className={`px-2.5 py-1 rounded-lg text-[11px] md:text-[12px] font-semibold transition-all ${
                  on
                    ? 'bg-teal text-dark shadow-sm'
                    : 'text-white/45 hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                {p.label}
              </button>
            )
          })}
        </div>

        {count != null && (
          <span className="text-[12px] text-white/35">
            <span className="font-bold text-teal">{count}</span> {countLabel}
          </span>
        )}

        {active === 'custom' && (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md"
            style={{ background: '#f59e0b22', color: '#f59e0b' }}>
            Custom
          </span>
        )}
      </div>

      {/* Custom from → to */}
      {showCustom && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Calendar size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
            <input
              type="date"
              value={from || ''}
              onChange={e => onChange({ from: e.target.value, to, preset: 'custom' })}
              style={dateInputStyle}
              className={`${dateInputCls} pl-8 pr-2 w-[150px]`}
            />
          </div>
          <span className="text-white/25 text-xs">→</span>
          <input
            type="date"
            value={to || ''}
            onChange={e => onChange({ from, to: e.target.value, preset: 'custom' })}
            style={dateInputStyle}
            className={`${dateInputCls} px-2.5 w-[150px]`}
          />
          {(from || to) && (
            <button
              onClick={() => onChange({ from: '', to: '', preset: 'all' })}
              className="text-[11px] text-white/35 hover:text-white underline ml-0.5"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}
