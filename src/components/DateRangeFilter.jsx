import { Calendar } from 'lucide-react'
import { PRESETS, matchPreset, rangeMatches } from '../utils/dateRanges'

// Reusable date-range filter: a row of preset pills plus optional custom
// from/to inputs. Controlled via `from`/`to`; reports changes through
// onChange({ from, to, preset }). The active preset is derived from the dates,
// so callers only need to track from/to.
//
// Private Bank tokens. On phones every pill and input is at least 44px tall
// and the preset row wraps instead of scrolling sideways.
const dateInputCls   = 'h-11 md:h-8 rounded-lg text-[13px] text-bank-tx focus:outline-none transition-colors'
const dateInputStyle = { background: 'var(--raise)', border: '1px solid var(--line)' }
const ACTIVE = { background: 'var(--raise)', border: '1px solid var(--line)' }

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
    <div className={`space-y-2 min-w-0 ${className}`}>
      {/* Preset pills */}
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        <div className="inline-flex flex-wrap gap-1 p-1 rounded-xl max-w-full"
          style={{ background: 'var(--bg)', border: '1px solid var(--line)' }} role="group" aria-label="Date range">
          {presets.map(p => {
            const on = active === p.key
            return (
              <button
                key={p.key}
                onClick={() => applyPreset(p)}
                aria-pressed={on}
                className={`px-3 md:px-2.5 py-1 min-h-[44px] md:min-h-0 rounded-lg text-[13px] font-semibold transition-colors border ${
                  on
                    ? 'text-bank-gold-tx'
                    : 'text-bank-mu hover:text-bank-tx hover:bg-bank-raise border-transparent'
                }`}
                style={on ? ACTIVE : undefined}
              >
                {p.label}
              </button>
            )
          })}
        </div>

        {count != null && (
          <span className="text-[13px] text-bank-mu">
            <span className="font-bold text-bank-tx tabular-nums">{count}</span> {countLabel}
          </span>
        )}

        {active === 'custom' && (
          <span className="text-[13px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md"
            style={{ background: 'rgba(210,160,116,0.14)', color: 'var(--warn)', border: '1px solid rgba(210,160,116,0.35)' }}>
            Custom
          </span>
        )}
      </div>

      {/* Custom from → to */}
      {showCustom && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Calendar size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-bank-fa pointer-events-none" />
            <input
              type="date"
              value={from || ''}
              onChange={e => onChange({ from: e.target.value, to, preset: 'custom' })}
              style={dateInputStyle}
              aria-label="From date"
              className={`${dateInputCls} pl-8 pr-2 w-[150px]`}
            />
          </div>
          <span className="text-bank-fa text-xs" aria-hidden="true">→</span>
          <input
            type="date"
            value={to || ''}
            onChange={e => onChange({ from, to: e.target.value, preset: 'custom' })}
            style={dateInputStyle}
            aria-label="To date"
            className={`${dateInputCls} px-2.5 w-[150px]`}
          />
          {(from || to) && (
            <button
              onClick={() => onChange({ from: '', to: '', preset: 'all' })}
              className="text-[13px] min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 px-1 text-bank-mu hover:text-bank-tx underline ml-0.5"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}
