export default function KpiCard({ label, value, sub, accent = true }) {
  return (
    <div
      className="rounded-xl p-3 md:p-5 w-full min-w-0"
      style={{ background: '#242424', border: '1px solid #2e2e2e' }}
    >
      <p className="text-[9px] md:text-[10px] font-semibold text-white/40 uppercase tracking-[0.1em] mb-1.5 truncate">
        {label}
      </p>
      <p className={`text-[17px] md:text-[22px] font-bold leading-tight truncate ${accent ? 'text-teal' : 'text-white'}`}>
        {value}
      </p>
      {sub && <p className="text-[10px] md:text-[11px] text-white/30 mt-1 truncate">{sub}</p>}
    </div>
  )
}
