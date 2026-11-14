import { KpiFigure } from './ui'

// Pass value2 (+ valueLabel/value2Label) to show two figures side by side in
// one card — e.g. Avg Deal's baseline + job price. Thin wrapper over the
// shared KpiFigure so the Deals page reads like every other page. `accent`
// is accepted for old callers and ignored: gold is reserved for the one key
// number per screen; pass `gold` on exactly that card.
export default function KpiCard({ label, value, sub, accent: _accent = true, gold = false, value2, valueLabel, value2Label }) {
  return <KpiFigure label={label} value={value} sub={sub} value2={value2} valueLabel={valueLabel} value2Label={value2Label} color={gold ? 'var(--gold-tx)' : undefined} />
}
