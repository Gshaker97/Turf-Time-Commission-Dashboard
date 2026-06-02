import React, { useEffect, useMemo, useState } from "react";
import { fetchDeals, fetchGoal, saveGoal } from "../lib/db";
import { rollup } from "../utils/commission";

const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");

function getMonths(n = 12) {
  const months = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const pad = (x) => String(x).padStart(2, "0");
    const startKey = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    months.push({
      y: d.getFullYear(), m: d.getMonth() + 1,
      key: startKey,
      label: d.toLocaleString("en-US", { month: "long", year: "numeric" }),
    });
  }
  return months;
}

export default function Home() {
  const months = useMemo(() => getMonths(12), []);
  const [selected, setSelected] = useState(0);
  const [allDeals, setAllDeals] = useState([]);
  const [target, setTarget] = useState(0);
  const [goalInput, setGoalInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingGoal, setSavingGoal] = useState(false);

  const mr = months[selected];

  // Load all deals once
  useEffect(() => {
    fetchDeals().then(({ data }) => { setAllDeals(data ?? []); });
  }, []);

  // Load the goal whenever the selected month changes
  useEffect(() => {
    setLoading(true);
    fetchGoal(mr.y, mr.m).then(({ data }) => {
      setTarget(data || 0);
      setGoalInput(data ? String(data) : "");
      setLoading(false);
    });
  }, [mr.y, mr.m]);

  const deals = useMemo(
    () => allDeals.filter(d => d.sale_date?.startsWith(mr.key)),
    [allDeals, mr.key]
  );

  const totals = useMemo(() => rollup(deals), [deals]);
  const pct = target > 0 ? (totals.baselineRevenue / target) * 100 : 0;
  const remaining = Math.max(target - totals.baselineRevenue, 0);

  async function handleSaveGoal() {
    const t = Number(goalInput) || 0;
    setSavingGoal(true);
    await saveGoal(mr.y, mr.m, t);
    setSavingGoal(false);
    setTarget(t);
  }

  return (
    <div style={{ background: '#1a1a1a', color: '#fff', minHeight: '100%' }}>

      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-lg md:text-xl font-bold text-white">{mr.label}</h1>
          <p className="text-[12px] text-white/40 mt-0.5">Progress measured on baseline revenue</p>
        </div>
        <select value={selected} onChange={e => setSelected(Number(e.target.value))}
          className="text-[12px] px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white flex-shrink-0">
          {months.map((m, i) => <option key={i} value={i} style={{ background: '#2a2a2a' }}>{m.label}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-white/30 text-sm py-8 text-center">Loading…</div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-3 gap-2 md:gap-3 mb-3">
            {[
              { label: 'Deals',            value: totals.count.toString() },
              { label: 'Baseline Revenue', value: money(totals.baselineRevenue) },
              { label: 'Commission',       value: money(totals.commission) },
            ].map(c => (
              <div key={c.label} className="rounded-xl p-3 md:p-4"
                style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
                <p className="text-[9px] md:text-[11px] uppercase tracking-wider text-white/30 font-semibold mb-1.5 leading-tight">{c.label}</p>
                <p className="text-[15px] md:text-2xl font-bold truncate text-teal">{c.value}</p>
              </div>
            ))}
          </div>

          {/* Goal card */}
          <div className="rounded-xl p-4 md:p-5" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
            <div className="flex flex-wrap gap-3 items-end mb-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/30 font-semibold mb-1.5">
                  Monthly goal (baseline) — {mr.label}
                </p>
                <input type="number" value={goalInput} onChange={e => setGoalInput(e.target.value)}
                  placeholder="e.g. 600000"
                  className="h-9 px-3 rounded-lg text-[13px] text-white border border-white/10 bg-white/5 focus:outline-none focus:border-teal/40 w-40" />
              </div>
              <button onClick={handleSaveGoal} disabled={savingGoal}
                className="h-9 px-4 rounded-lg text-[13px] font-bold disabled:opacity-50 transition-colors bg-teal text-dark">
                {savingGoal ? 'Saving…' : 'Save goal'}
              </button>
            </div>

            {target > 0 && (
              <>
                <div className="h-3 rounded-full overflow-hidden mb-2" style={{ background: '#2a2a2a' }}>
                  <div className="h-full rounded-full transition-all duration-700 bg-teal"
                    style={{ width: `${Math.min(pct, 100)}%` }} />
                </div>
                <div className="flex justify-between text-[12px] text-white/40">
                  <span><span className="font-bold text-white">{pct.toFixed(1)}%</span> of goal</span>
                  <span><span className="font-bold text-white">{money(remaining)}</span> to go</span>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
