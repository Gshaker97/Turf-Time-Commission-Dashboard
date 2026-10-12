import { Check, Circle, X, Lock, RefreshCw, CalendarClock, Users, UploadCloud } from 'lucide-react'

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

// A short "updated 12m ago" / "just now" label from a timestamp.
function agoLabel(at) {
  if (!at) return null
  const m = Math.round((Date.now() - at) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return `${h}h ago`
}

// Re-run all + queue status, shown up by the Needs review / All deals tabs.
export function AuditControls({ audit, canAudit }) {
  const anyBusy = Object.values(audit.busy).some(Boolean)
  const ago = agoLabel(audit.cachedAt)
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {canAudit && (
        <button onClick={audit.rerunAll} disabled={anyBusy || audit.state === 'loading'}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white/60 hover:text-white disabled:opacity-40"
          style={{ background: '#1e1e1e', border: '1px solid #2e2e2e' }}
          title="Re-check every deal against the install sheet + GHL now (otherwise cached for an hour)">
          <RefreshCw size={12} className={audit.state === 'loading' ? 'animate-spin' : ''} /> Refresh
        </button>
      )}
      {canAudit && audit.state === 'ready' && ago && (
        <span className="text-[11px] text-white/35">updated {ago}</span>
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

const nm = (p) => (p && p.name) || '—'

// The detail lines listed UNDER each check — the actual values the check looks
// at (setter/closer, dates, customer fields, manager), plus the engine's reason
// when something is off. Pulled from the deal row (which carries the joined
// people + customer fields) so every item shows its info, whether it passed or
// not. `a` is the audit result (carries on_calendar + each item's reason/fix).
function detailLines(item, deal, a) {
  const lines = []
  switch (item.key) {
    case 'on_calendar':
      lines.push(a.on_calendar ? 'Matched a non-cancelled install booking on the calendar.' : (item.reason || 'No calendar booking matched this deal.'))
      break
    case 'install_date':
      lines.push(`Site install date: ${deal.install_date || '—'}`)
      if (item.reason) lines.push(item.reason)
      break
    case 'financing':
      lines.push(`Payment method: ${deal.payment_method || '—'}`)
      if (item.reason) lines.push(item.reason)
      break
    case 'setter_closer':
      lines.push(`Setter: ${nm(deal.setter)}`)
      lines.push(`Closer: ${nm(deal.closer)}`)
      if (item.reason) lines.push(item.reason)
      break
    case 'customer_info':
      lines.push(`Name: ${deal.deal_name || '—'}`)
      lines.push(`Phone: ${deal.customer_phone || '—'}`)
      lines.push(`Address: ${deal.customer_address || '—'}`)
      if (item.reason) lines.push(item.reason)
      break
    case 'manager_override':
      lines.push(`Manager: ${nm(deal.manager)}`)
      if (item.reason) lines.push(item.reason)
      break
    case 'drawing_commission':
      if (item.reason) lines.push(item.reason)
      break
    case 'ghl_information':
      // The server summarises all four GHL fields in one ' • '-joined string;
      // split it so each (sales rep / install date / commission / payment
      // method / contact) lists on its own line, and colour each by state:
      // match = green, mismatch = red, blank in GHL = amber, no field = grey.
      if (item.reason) item.reason.split(' • ').forEach(part => {
        const tone = /no field in GHL/i.test(part) ? 'nofield'
          : /blank in GHL/i.test(part) ? 'blank'
          : /mismatch/i.test(part) ? 'mismatch'
          : /matches/i.test(part) ? 'match' : null
        lines.push({ text: part, tone })
      })
      break
    default:
      if (item.reason) lines.push(item.reason)
  }
  return lines.filter(Boolean)
}

function FixButton({ fix, busy, onFix }) {
  const label = fix.type === 'use_calendar_date' ? 'Use calendar date'
    : fix.type === 'use_calendar_people' ? 'Use calendar setter/closer'
    : fix.type === 'assign_team' ? 'Assign team'
    : fix.type === 'ghl_fill' ? 'Fill blanks in GHL' : null
  if (!label) return null
  const Icon = fix.type === 'use_calendar_date' ? CalendarClock
    : fix.type === 'ghl_fill' ? UploadCloud : Users
  return (
    <button onClick={onFix} disabled={busy}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold text-dark bg-teal disabled:opacity-40">
      <Icon size={10} /> {label}
    </button>
  )
}

// One check section: the check (icon + label) on top, then its info listed
// underneath. Auto items are display-only; manual items (Financing, Drawing &
// commission) are a clickable checkbox for admin/Keaton.
function AuditRow({ deal, item, audit, canAudit, busy, onToggle, onFix }) {
  const done = item.checked
  const clickable = item.manual && canAudit
  const icon = done
    ? <Check size={14} className="text-teal" />
    : clickable ? <Circle size={14} className="text-white/35" />
    : item.manual ? <Lock size={12} className="text-white/25" />
    : <X size={13} className="text-amber-400" />
  const label = (
    <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold ${done ? 'text-white/55' : 'text-white/90'}`}>
      {icon}{item.label}{item.manual && <span className="text-white/25 text-[10px] font-normal">(manual)</span>}
    </span>
  )
  const lines = detailLines(item, deal, audit.byId[deal.id])
  return (
    <div className="rounded-lg px-2.5 py-1.5" style={{ background: '#242424', border: '1px solid #2a2a2a' }}>
      {clickable
        ? <button onClick={() => onToggle(!done)} disabled={busy} title={done ? 'Uncheck' : 'Check'}
            className="disabled:opacity-40 hover:opacity-80 transition-opacity">{label}</button>
        : label}
      {lines.length > 0 && (
        <div className="mt-1 ml-[20px] space-y-0.5">
          {lines.map((ln, i) => {
            const text = typeof ln === 'string' ? ln : ln.text
            const tone = typeof ln === 'string' ? null : ln.tone
            const cls = tone === 'match' ? 'text-teal'
              : tone === 'mismatch' ? 'text-red-400'
              : tone === 'blank' ? 'text-amber-400'
              : tone === 'nofield' ? 'text-white/35'
              : 'text-white/45'
            return <p key={i} className={`text-[11px] leading-snug ${cls}`}>{text}</p>
          })}
          {canAudit && item.fix && (
            <div className="pt-0.5"><FixButton fix={item.fix} busy={busy} onFix={onFix} /></div>
          )}
        </div>
      )}
    </div>
  )
}

// The full-width checklist rendered directly under a deal's row on the
// Needs-review table: a compact grid of the checks (3 across on desktop, 2 on
// tablet, 1 on phones) so it stays short, each cell with its own info beneath.
export default function AuditStrip({ deal, audit, canAudit }) {
  const a = audit.byId[deal.id]
  const busy = !!audit.busy[deal.id]

  // The queue's loading / error / demo-disabled state is reported once up by
  // the tabs, not on every row — so there's nothing to draw until a result
  // exists for this deal.
  if (!a) return null

  return (
    <div className="rounded-lg px-3 py-2" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {a.items.map(it => (
          <AuditRow key={it.key} deal={deal} item={it} audit={audit} canAudit={canAudit} busy={busy}
            onToggle={(v) => audit.toggleManual(deal.id, it.key, v)}
            onFix={() => audit.applyFix(deal.id, it.fix)} />
        ))}
      </div>
    </div>
  )
}
