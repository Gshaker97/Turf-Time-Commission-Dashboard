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
  default: { accent: '#00b894', btn: '#00b894', btnText: '#0b0b0b', icon: HelpCircle,   ring: 'rgba(0,184,148,0.35)' },
  danger:  { accent: '#ef4444', btn: '#ef4444', btnText: '#ffffff', icon: AlertTriangle, ring: 'rgba(239,68,68,0.35)' },
  warn:    { accent: '#f59e0b', btn: '#f59e0b', btnText: '#0b0b0b', icon: ShieldAlert,  ring: 'rgba(245,158,11,0.35)' },
  info:    { accent: '#60a5fa', btn: '#00b894', btnText: '#0b0b0b', icon: Info,         ring: 'rgba(96,165,250,0.35)' },
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
        style={{ background: '#1c1c1c', border: '1px solid #303030', boxShadow: '0 24px 60px rgba(0,0,0,0.65)' }}>
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
              <h2 className="text-[15px] font-bold text-white leading-snug">{d.title}</h2>
              {d.message && (
                <p className="text-[12.5px] text-white/55 mt-1.5 leading-relaxed whitespace-pre-line">{d.message}</p>
              )}
            </div>
          </div>

          {/* Consequences, one per line — the part a \n-joined confirm() used
              to bury in a grey paragraph nobody read. */}
          {Array.isArray(d.bullets) && d.bullets.filter(Boolean).length > 0 && (
            <ul className="mt-3.5 rounded-xl p-3 space-y-1.5" style={{ background: '#161616', border: '1px solid #282828' }}>
              {d.bullets.filter(Boolean).map((b, i) => (
                <li key={i} className="flex gap-2 text-[12px] text-white/65 leading-relaxed">
                  <span className="flex-shrink-0 mt-[7px] w-1 h-1 rounded-full" style={{ background: tone.accent }} />
                  <span className="min-w-0">{b}</span>
                </li>
              ))}
            </ul>
          )}

          {isPrompt && (
            <div className="mt-3.5">
              {d.label && <label className="block text-[10px] font-bold uppercase tracking-wider text-white/35 mb-1.5">{d.label}</label>}
              {d.multiline ? (
                <textarea ref={inputRef} rows={3} value={value} onChange={e => setValue(e.target.value)}
                  placeholder={d.placeholder || ''}
                  className="w-full px-3 py-2 rounded-xl text-[13px] text-white placeholder-white/25 resize-y focus:outline-none"
                  style={{ background: '#141414', border: '1px solid #333' }}
                  onFocus={e => { e.target.style.borderColor = tone.accent; e.target.style.boxShadow = `0 0 0 3px ${tone.ring}` }}
                  onBlur={e => { e.target.style.borderColor = '#333'; e.target.style.boxShadow = 'none' }} />
              ) : (
                <input ref={inputRef} value={value} onChange={e => setValue(e.target.value)}
                  placeholder={d.placeholder || ''}
                  className="w-full px-3 py-2 rounded-xl text-[13px] text-white placeholder-white/25 focus:outline-none"
                  style={{ background: '#141414', border: '1px solid #333' }}
                  onFocus={e => { e.target.style.borderColor = tone.accent; e.target.style.boxShadow = `0 0 0 3px ${tone.ring}` }}
                  onBlur={e => { e.target.style.borderColor = '#333'; e.target.style.boxShadow = 'none' }} />
              )}
              {d.required && !String(value).trim() && (
                <p className="text-[11px] text-white/30 mt-1.5">Required.</p>
              )}
            </div>
          )}

          {isReveal && (
            <div className="mt-3.5 flex items-center gap-2 rounded-xl px-3 py-2.5"
              style={{ background: '#141414', border: '1px solid #333' }}>
              <code className="flex-1 min-w-0 text-[13px] text-white font-mono break-all select-all">{String(d.value ?? '')}</code>
              <button onClick={copy}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex-shrink-0 transition-colors ${
                  copied ? 'text-emerald-300' : 'text-white/60 hover:text-white'}`}
                style={{ background: '#1e1e1e', border: '1px solid #3a3a3a' }}>
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
                    className="w-full text-left px-3.5 py-2.5 rounded-xl transition-colors hover:bg-white/[0.04]"
                    style={{ background: '#161616', border: `1px solid ${i === 0 ? `${ot.accent}55` : '#2e2e2e'}` }}>
                    <span className="block text-[13px] font-bold" style={{ color: i === 0 ? ot.accent : 'rgba(255,255,255,0.85)' }}>
                      {o.label}{i === 0 ? ' · recommended' : ''}
                    </span>
                    {o.description && <span className="block text-[11.5px] text-white/45 mt-0.5 leading-relaxed">{o.description}</span>}
                  </button>
                )
              })}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 mt-5">
            {!isReveal && !isAlert && (
              <button onClick={cancel}
                className="px-3.5 py-2 rounded-xl text-[12.5px] font-semibold text-white/55 hover:text-white transition-colors"
                style={{ background: '#222', border: '1px solid #333' }}>
                {d.cancelLabel || 'Cancel'}
              </button>
            )}
            {!isChoice && <button ref={okRef} onClick={confirm} disabled={blocked}
              className="px-4 py-2 rounded-xl text-[12.5px] font-bold transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
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
