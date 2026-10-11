import { Check, Circle, X, Lock, RefreshCw, CalendarClock, Users } from 'lucide-react'

// X/7 pill shown next to the deal name on the Needs-review table.
export function AuditBadge({ done, total, reviewed }) {
  const full = done >= total
  return (
    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0"
      style={{ background: full ? '#00b89420' : '#f59e0b20', color: full ? '#34d399' : '#f59e0b' }}>
      {done}/{total}{reviewed ? ' · Reviewed' : ''}
    </span>
  )
}

// Re-run all + queue status, shown up by the Needs review / All deals tabs.
export function AuditControls({ audit, canAudit }) {
  const anyBusy = Object.values(audit.busy).some(Boolean)
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {canAudit && (
        <button onClick={audit.rerunAll} disabled={anyBusy || audit.state === 'loading'}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white/60 hover:text-white disabled:opacity-40"
          style={{ background: '#1e1e1e', border: '1px solid #2e2e2e' }}>
          <RefreshCw size={12} className={audit.state === 'loading' ? 'animate-spin' : ''} /> Re-run all
        </button>
      )}
      {audit.state === 'loading' && <span className="text-[11px] text-white/40">Running audit…</span>}
      {audit.state === 'disabled' && <span className="text-[11px] text-white/40">The audit runs on the live site (disabled in demo mode).</span>}
      {audit.state === 'error' && (
        <span className="text-[11px] text-red-300">Audit failed: {audit.err}{' '}
          <button onClick={audit.rerunAll} className="underline">retry</button>
        </span>
      )}
    </div>
  )
}

// One chip in the horizontal strip. Auto items are display-only; manual items
// (Financing, Drawing & commission) are a clickable checkbox for admin/Keaton.
function AuditChip({ item, canAudit, busy, onToggle }) {
  const done = item.checked
  const clickable = item.manual && canAudit
  const icon = done
    ? <Check size={13} className="text-teal" />
    : clickable ? <Circle size={13} className="text-white/35" />
    : item.manual ? <Lock size={11} className="text-white/25" />
    : <X size={12} className="text-amber-400" />
  const body = (
    <span className={`inline-flex items-center gap-1 text-[11px] whitespace-nowrap ${done ? 'text-white/50' : 'text-white/85'}`}>
      {icon}{item.label}
    </span>
  )
  if (!clickable) return body
  return (
    <button onClick={() => onToggle(!done)} disabled={busy} title={done ? 'Uncheck' : 'Check'}
      className="disabled:opacity-40 hover:opacity-80 transition-opacity">
      {body}
    </button>
  )
}

function FixButton({ fix, busy, onFix }) {
  const label = fix.type === 'use_calendar_date' ? 'Use calendar date'
    : fix.type === 'use_calendar_people' ? 'Use calendar setter/closer'
    : fix.type === 'assign_team' ? 'Assign team' : null
  if (!label) return null
  const Icon = fix.type === 'use_calendar_date' ? CalendarClock : Users
  return (
    <button onClick={onFix} disabled={busy}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold text-dark bg-teal disabled:opacity-40">
      <Icon size={10} /> {label}
    </button>
  )
}

// The compact, full-width checklist rendered directly under a deal's row on the
// Needs-review table: a horizontal strip of the 7 items, with each unchecked
// item's reason (and its fix button) listed beneath.
export default function AuditStrip({ deal, audit, canAudit }) {
  const a = audit.byId[deal.id]
  const busy = !!audit.busy[deal.id]

  // While the queue is still loading, the status chip by the tabs says so — a
  // per-row spinner under every deal would just be noise. Likewise an error /
  // demo-disabled state is reported once up there, not on each row.
  if (!a) return null

  const unchecked = a.items.filter(it => !it.checked && (it.reason || it.fix))
  return (
    <div className="rounded-lg px-3 py-2 space-y-1.5" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {a.items.map(it => (
          <AuditChip key={it.key} item={it} canAudit={canAudit} busy={busy}
            onToggle={(v) => audit.toggleManual(deal.id, it.key, v)} />
        ))}
      </div>
      {unchecked.length > 0 && (
        <div className="space-y-1 pt-0.5 border-t border-white/5">
          {unchecked.map(it => (
            <div key={it.key} className="flex items-center flex-wrap gap-x-2 gap-y-1 text-[11px] text-white/45">
              <span className="text-white/35">{it.label}:</span>
              {it.reason && <span>{it.reason}</span>}
              {canAudit && it.fix && (
                <FixButton fix={it.fix} busy={busy} onFix={() => audit.applyFix(deal.id, it.fix)} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
