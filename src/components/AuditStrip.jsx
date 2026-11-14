import { Check, Circle, X, Lock, RefreshCw, CalendarClock, Users, UploadCloud } from 'lucide-react'
import { SURFACE, SecondaryButton } from './ui'

// X/7 pill shown next to the deal name on the Needs-review table.
export function AuditBadge({ done, total, reviewed }) {
  const full = done >= total
  return (
    <span className="px-2 py-0.5 rounded-full text-[12px] font-bold flex-shrink-0 whitespace-nowrap"
      style={full
        ? { background: 'rgba(169,196,178,0.14)', color: 'var(--pos)', border: '1px solid rgba(169,196,178,0.4)' }
        : { background: 'rgba(210,160,116,0.14)', color: 'var(--warn)', border: '1px solid rgba(210,160,116,0.4)' }}>
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
        <SecondaryButton onClick={audit.rerunAll} disabled={anyBusy || audit.state === 'loading'}
          title="Re-check every deal against the install sheet + GHL now (otherwise cached for an hour)">
          <RefreshCw size={12} className={audit.state === 'loading' ? 'animate-spin' : ''} /> Refresh
        </SecondaryButton>
      )}
      {canAudit && audit.state === 'ready' && ago && (
        <span className="text-[13px] text-bank-mu">updated {ago}</span>
      )}
      {audit.state === 'loading' && <span className="text-[13px] text-bank-mu">Running audit…</span>}
      {audit.state === 'disabled' && <span className="text-[13px] text-bank-mu">The audit runs on the live site (disabled in demo mode).</span>}
      {audit.state === 'error' && (
        <span className="text-[13px]" style={{ color: 'var(--neg)' }}>Audit failed: {audit.err}{' '}
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
      className="inline-flex items-center gap-1 px-2.5 py-1 min-h-[44px] md:min-h-0 rounded-lg text-[13px] font-semibold disabled:opacity-40 hover:brightness-105"
      style={{ background: 'var(--gold)', color: 'var(--gold-ink)' }}>
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
    ? <Check size={14} style={{ color: 'var(--pos)' }} />
    : clickable ? <Circle size={14} className="text-bank-fa" />
    : item.manual ? <Lock size={12} className="text-bank-fa" />
    : <X size={13} style={{ color: 'var(--warn)' }} />
  const label = (
    <span className={`inline-flex items-center gap-1.5 text-[13px] font-semibold ${done ? 'text-bank-mu' : 'text-bank-tx'}`}>
      {icon}{item.label}{item.manual && <span className="text-bank-fa text-[12px] font-normal">(manual)</span>}
    </span>
  )
  const lines = detailLines(item, deal, audit.byId[deal.id])
  return (
    <div className="rounded-xl px-3 py-2" style={SURFACE.well}>
      {clickable
        ? <button onClick={() => onToggle(!done)} disabled={busy} title={done ? 'Uncheck' : 'Check'} aria-pressed={done}
            className="min-h-[44px] md:min-h-0 disabled:opacity-40 hover:opacity-80 transition-opacity">{label}</button>
        : label}
      {lines.length > 0 && (
        <div className="mt-1 ml-[20px] space-y-0.5">
          {lines.map((ln, i) => {
            const text = typeof ln === 'string' ? ln : ln.text
            const tone = typeof ln === 'string' ? null : ln.tone
            const color = tone === 'match' ? 'var(--pos)'
              : tone === 'mismatch' ? 'var(--neg)'
              : tone === 'blank' ? 'var(--warn)'
              : tone === 'nofield' ? 'var(--fa)'
              : 'var(--mu)'
            return <p key={i} className="text-[13px] leading-snug" style={{ color }}>{text}</p>
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
  //
  // Test the ITEMS ARRAY, not just the object: a cached entry without one got
  // this far and then threw on `a.items.map`, taking the whole Needs-review
  // tab down with it. Render nothing instead — the strip is an aid, and a
  // missing one must never cost you the page.
  if (!a || !Array.isArray(a.items)) return null

  return (
    <div className="rounded-xl px-3 py-2.5" style={SURFACE.raise}>
      {/* Name the customer this checklist belongs to, so each card is clearly its own. */}
      <div className="flex items-center gap-2 mb-2.5 pb-2 border-b border-bank-line">
        <span className="text-[13px] font-bold uppercase tracking-wide text-bank-mu truncate">{deal.deal_name}</span>
        <AuditBadge done={a.done} total={a.total} reviewed={a.reviewed} />
      </div>
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
