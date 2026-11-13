import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Check, Copy, HelpCircle, Info, ShieldAlert } from 'lucide-react'

// ============================================================
// The one modal that answers every confirm / prompt on the site.
// Mounted once in Layout; driven by src/lib/dialog.js over the same event bus
// toast.js uses. One dialog at a time (they're blocking by nature) — a second
// request while one is open is queued and shown after it resolves, so a
// call site can never have its promise dropped on the floor.
//
// Keyboard: Esc cancels, Enter confirms (Cmd/Ctrl+Enter in a textarea, where
// Enter is a newline). The confirm button takes focus on open for a plain
// confirm, the input for a prompt.
// ============================================================

const TONE = {
  // Private Bank palette: the primary button is gold; danger/warn keep their
  // own warning colours so a destructive dialog never looks like a routine one.
  default: { accent: '#bfa46c', btn: '#bfa46c', btnText: '#191509', icon: HelpCircle,   ring: 'rgba(191,164,108,0.35)' },
  danger:  { accent: '#d98c80', btn: '#d98c80', btnText: '#191509', icon: AlertTriangle, ring: 'rgba(217,140,128,0.35)' },
  warn:    { accent: '#d2a074', btn: '#d2a074', btnText: '#191509', icon: ShieldAlert,  ring: 'rgba(210,160,116,0.35)' },
  info:    { accent: '#a19e97', btn: '#bfa46c', btnText: '#191509', icon: Info,         ring: 'rgba(161,158,151,0.35)' },
}

export default function DialogHost() {
  const [queue, setQueue] = useState([])
  const d = queue[0] ?? null
  const [value, setValue] = useState('')
  const [copied, setCopied] = useState(false)
  const inputRef = useRef(null)
  const okRef = useRef(null)

  useEffect(() => {
    const onAsk = (e) => setQueue(q => [...q, { ...e.detail, key: Math.random().toString(36).slice(2) }])
    window.addEventListener('tt-dialog', onAsk)
    return () => window.removeEventListener('tt-dialog', onAsk)
  }, [])

  // Reset the field whenever a new dialog reaches the front of the queue.
  useEffect(() => {
    if (!d) return
    setValue(d.defaultValue ?? '')
    setCopied(false)
    const t = setTimeout(() => {
      if (d.kind === 'prompt') inputRef.current?.focus()
      else okRef.current?.focus()
    }, 30)
    return () => clearTimeout(t)
    // Keyed on the dialog's identity only — re-running on every field change
    // would steal focus back mid-typing.
  }, [d?.key, d?.kind, d?.defaultValue])

  if (!d) return null

  const tone = TONE[d.tone] || (d.kind === 'reveal' || d.kind === 'alert' ? TONE.info : TONE.default)
  const Icon = tone.icon
  const isPrompt = d.kind === 'prompt'
  const isReveal = d.kind === 'reveal'
  const isAlert  = d.kind === 'alert'
  const isChoice = d.kind === 'choice'
  const blocked  = isPrompt && d.required && !String(value).trim()

  const close = (answer) => {
    try { d.resolve(answer) } catch { /* caller vanished */ }
    setQueue(q => q.slice(1))
  }
  const cancel  = () => close(d.kind === 'confirm' ? false : (isReveal || isAlert ? true : null))
  const confirm = () => {
    if (blocked) return
    close(d.kind === 'confirm' ? true : (isPrompt ? String(value) : true))
  }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); return }
    if (e.key === 'Enter') {
      if (isChoice) return
      // In a textarea Enter is a newline — only the chord submits.
      if (d.multiline && !(e.metaKey || e.ctrlKey)) return
      e.preventDefault(); confirm()
    }
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(String(d.value ?? '')); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { /* clipboard refused — the value is on screen to select by hand */ }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4"
      onKeyDown={onKeyDown}
      role="dialog" aria-modal="true" aria-label={d.title}>
      {/* Backdrop — click to cancel, same as Esc */}
      <div className="absolute inset-0 tt-dlg-fade" style={{ background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(3px)' }}
        onClick={cancel} />

      <div className="relative w-full sm:w-[min(460px,100%)] tt-dlg-pop overflow-hidden
                      rounded-t-2xl sm:rounded-2xl"
        style={{ background: 'var(--card)', border: '1px solid var(--line)', boxShadow: 'var(--card-shadow), 0 24px 60px rgba(0,0,0,0.55)' }}>
        {/* Tone stripe — the one piece of colour, so a destructive dialog
            reads as destructive before anyone gets to the button. */}
        <div style={{ height: 3, background: tone.accent }} />

        <div className="p-5">
          <div className="flex items-start gap-3.5">
            <span className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ background: `${tone.accent}1a`, border: `1px solid ${tone.accent}44` }}>
              <Icon size={17} style={{ color: tone.accent }} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-bold text-bank-tx leading-snug">{d.title}</h2>
              {d.message && (
                <p className="text-[13px] text-bank-mu mt-1.5 leading-relaxed whitespace-pre-line">{d.message}</p>
              )}
            </div>
          </div>

          {/* Consequences, one per line — the part a \n-joined confirm() used
              to bury in a grey paragraph nobody read. */}
          {Array.isArray(d.bullets) && d.bullets.filter(Boolean).length > 0 && (
            <ul className="mt-3.5 rounded-xl p-3 space-y-1.5" style={{ background: 'var(--bg)', border: '1px solid var(--line)' }}>
              {d.bullets.filter(Boolean).map((b, i) => (
                <li key={i} className="flex gap-2 text-[13px] text-bank-mu leading-relaxed">
                  <span className="flex-shrink-0 mt-[7px] w-1 h-1 rounded-full" style={{ background: tone.accent }} />
                  <span className="min-w-0">{b}</span>
                </li>
              ))}
            </ul>
          )}

          {isPrompt && (
            <div className="mt-3.5">
              {d.label && <label className="block text-[13px] font-bold uppercase tracking-wide text-bank-fa mb-1.5">{d.label}</label>}
              {d.multiline ? (
                <textarea ref={inputRef} rows={3} value={value} onChange={e => setValue(e.target.value)}
                  placeholder={d.placeholder || ''}
                  className="w-full px-3 py-2 rounded-xl text-[13px] text-bank-tx placeholder-bank-fa resize-y focus:outline-none"
                  style={{ background: 'var(--bg)', border: '1px solid var(--line)' }}
                  onFocus={e => { e.target.style.borderColor = tone.accent; e.target.style.boxShadow = `0 0 0 3px ${tone.ring}` }}
                  onBlur={e => { e.target.style.borderColor = 'var(--line)'; e.target.style.boxShadow = 'none' }} />
              ) : (
                <input ref={inputRef} value={value} onChange={e => setValue(e.target.value)}
                  placeholder={d.placeholder || ''}
                  className="w-full px-3 py-2 rounded-xl text-[13px] text-bank-tx placeholder-bank-fa focus:outline-none"
                  style={{ background: 'var(--bg)', border: '1px solid var(--line)' }}
                  onFocus={e => { e.target.style.borderColor = tone.accent; e.target.style.boxShadow = `0 0 0 3px ${tone.ring}` }}
                  onBlur={e => { e.target.style.borderColor = 'var(--line)'; e.target.style.boxShadow = 'none' }} />
              )}
              {d.required && !String(value).trim() && (
                <p className="text-[12px] text-bank-fa mt-1.5">Required.</p>
              )}
            </div>
          )}

          {isReveal && (
            <div className="mt-3.5 flex items-center gap-2 rounded-xl px-3 py-2.5"
              style={{ background: 'var(--bg)', border: '1px solid var(--line)' }}>
              <code className="flex-1 min-w-0 text-[13px] text-bank-tx font-mono break-all select-all">{String(d.value ?? '')}</code>
              <button onClick={copy}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-bold flex-shrink-0 transition-colors ${
                  copied ? 'text-bank-pos' : 'text-bank-mu hover:text-bank-tx'}`}
                style={{ background: 'var(--raise)', border: '1px solid var(--line)' }}>
                {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}

          {/* A choice dialog's actions ARE its body — stacked, labelled and
              described, so neither one is "the other button". */}
          {isChoice && (
            <div className="mt-4 space-y-2">
              {(d.options || []).map((o, i) => {
                const ot = TONE[o.tone] || (i === 0 ? TONE.default : TONE.info)
                return (
                  <button key={o.key} ref={i === 0 ? okRef : undefined} onClick={() => close(o.key)}
                    className="w-full text-left px-3.5 py-2.5 min-h-[44px] rounded-xl transition-colors hover:bg-bank-raise"
                    style={{ background: 'var(--bg)', border: `1px solid ${i === 0 ? `${ot.accent}55` : 'var(--line)'}` }}>
                    <span className="block text-[13px] font-bold" style={{ color: i === 0 ? ot.accent : 'var(--tx)' }}>
                      {o.label}{i === 0 ? ' · recommended' : ''}
                    </span>
                    {o.description && <span className="block text-[12px] text-bank-mu mt-0.5 leading-relaxed">{o.description}</span>}
                  </button>
                )
              })}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 mt-5">
            {!isReveal && !isAlert && (
              <button onClick={cancel}
                className="px-3.5 py-2 min-h-[44px] sm:min-h-0 rounded-xl text-[13px] font-semibold text-bank-mu hover:text-bank-tx transition-colors"
                style={{ background: 'var(--raise)', border: '1px solid var(--line)' }}>
                {d.cancelLabel || 'Cancel'}
              </button>
            )}
            {!isChoice && <button ref={okRef} onClick={confirm} disabled={blocked}
              className="px-4 py-2 min-h-[44px] sm:min-h-0 rounded-xl text-[13px] font-bold transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: tone.btn, color: tone.btnText }}>
              {d.confirmLabel || (isReveal || isAlert ? 'Done' : isPrompt ? 'Save' : 'Confirm')}
            </button>}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes ttDlgFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes ttDlgPop  { from { opacity: 0; transform: translateY(10px) scale(.985) } to { opacity: 1; transform: none } }
        .tt-dlg-fade { animation: ttDlgFade .13s ease-out }
        .tt-dlg-pop  { animation: ttDlgPop .17s cubic-bezier(.2,.8,.3,1) }
        @media (prefers-reduced-motion: reduce) { .tt-dlg-fade, .tt-dlg-pop { animation: none } }
      `}</style>
    </div>,
    document.body
  )
}
