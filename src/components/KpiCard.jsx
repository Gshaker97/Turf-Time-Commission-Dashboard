// Pass value2 (+ valueLabel/value2Label) to show two figures side by side in
// one card — e.g. Avg Deal's baseline + job price.
export default function KpiCard({ label, value, sub, accent = true, value2, valueLabel, value2Label }) {
  return (
    <div
      className="rounded-xl p-3 md:p-5 w-full min-w-0"
      style={{ background: '#242424', border: '1px solid #2e2e2e' }}
    >
      <p className="text-[9px] md:text-[10px] font-semibold text-white/40 uppercase tracking-[0.1em] mb-1.5 truncate">
        {label}
      </p>
      {value2 != null ? (
        <div className="flex items-start gap-4 md:gap-6 min-w-0">
          <div className="min-w-0">
            <p className={`text-[17px] md:text-[22px] font-bold leading-tight truncate ${accent ? 'text-teal' : 'text-white'}`}>
              {value}
            </p>
            {valueLabel && <p className="text-[8px] md:text-[9px] text-white/30 uppercase tracking-wider mt-0.5 truncate">{valueLabel}</p>}
          </div>
          <div className="min-w-0">
            <p className="text-[17px] md:text-[22px] font-bold leading-tight truncate text-white/80">
              {value2}
            </p>
            {value2Label && <p className="text-[8px] md:text-[9px] text-white/30 uppercase tracking-wider mt-0.5 truncate">{value2Label}</p>}
          </div>
        </div>
      ) : (
        <p className={`text-[17px] md:text-[22px] font-bold leading-tight truncate ${accent ? 'text-teal' : 'text-white'}`}>
          {value}
        </p>
      )}
      {sub && <p className="text-[10px] md:text-[11px] text-white/30 mt-1 truncate">{sub}</p>}
    </div>
  )
}
