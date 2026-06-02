import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { rollup } from "../utils/commission";

const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");

function monthRange(d = new Date()) {
  const y = d.getFullYear(), m = d.getMonth();
  const iso = (x) => x.toISOString().slice(0, 10);
  return {
    y, m: m + 1,
    start: iso(new Date(y, m, 1)),
    nextStart: iso(new Date(y, m + 1, 1)),
    label: new Date(y, m, 1).toLocaleString("en-US", { month: "long", year: "numeric" }),
  };
}

export default function Home() {
  const mr = useMemo(() => monthRange(), []);
  const [deals, setDeals] = useState([]);
  const [target, setTarget] = useState(0);
  const [goalInput, setGoalInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingGoal, setSavingGoal] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: d }, { data: g }] = await Promise.all([
        supabase.from("deals").select("*").gte("sale_date", mr.start).lt("sale_date", mr.nextStart).order("sale_date", { ascending: false }),
        supabase.from("monthly_goals").select("baseline_target").eq("year", mr.y).eq("month", mr.m).maybeSingle(),
      ]);
      setDeals(d || []);
      setTarget(g?.baseline_target || 0);
      setGoalInput(g?.baseline_target ? String(g.baseline_target) : "");
      setLoading(false);
    })();
  }, [mr]);

  const totals = useMemo(() => rollup(deals), [deals]);
  const pct = target > 0 ? (totals.baselineRevenue / target) * 100 : 0;
  const remaining = Math.max(target - totals.baselineRevenue, 0);

  async function saveGoal() {
    const t = Number(goalInput) || 0;
    setSavingGoal(true);
    const { error } = await supabase
      .from("monthly_goals")
      .upsert({ year: mr.y, month: mr.m, baseline_target: t }, { onConflict: "year,month" });
    setSavingGoal(false);
    if (!error) setTarget(t);
  }

  return (
    <div className="ttd-home">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&display=swap');
        .ttd-home{ --bg:#f6f7f5; --card:#fff; --line:#e3e6e1; --text:#1c2420; --muted:#6b746c;
          --green:#15803d; --track:#e7ebe5;
          font-family:'Hanken Grotesk',-apple-system,sans-serif; color:var(--text);
          background:var(--bg); min-height:100%; padding:28px 22px 60px; box-sizing:border-box; }
        .ttd-home *{ box-sizing:border-box; }
        .ttd-home h1{ font-size:22px; font-weight:700; margin:0 0 2px; }
        .ttd-home .lead{ color:var(--muted); font-size:13px; margin:0 0 22px; }
        .grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:14px; max-width:920px; }
        @media(max-width:620px){ .grid{ grid-template-columns:1fr; } }
        .card{ background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px; }
        .klabel{ font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); font-weight:600; }
        .kval{ font-size:30px; font-weight:700; margin-top:8px; }
        .goal{ max-width:920px; margin-top:14px; }
        .goalrow{ display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap; }
        label{ display:block; font-size:12px; font-weight:600; margin:0 0 5px; }
        input{ padding:9px 10px; border:1px solid var(--line); border-radius:9px; font:inherit; font-size:14px; width:180px; }
        input:focus{ outline:none; border-color:var(--green); }
        .btn{ padding:10px 16px; border:0; border-radius:9px; background:var(--green); color:#fff;
          font:inherit; font-weight:700; font-size:14px; cursor:pointer; }
        .btn:disabled{ opacity:.5; }
        .bar{ height:14px; background:var(--track); border-radius:99px; overflow:hidden; margin:16px 0 8px; }
        .fill{ height:100%; background:var(--green); border-radius:99px; transition:width .4s ease; }
        .barmeta{ display:flex; justify-content:space-between; font-size:13px; color:var(--muted); }
        .barmeta b{ color:var(--text); }
      `}</style>

      <h1>{mr.label}</h1>
      <p className="lead">Progress is measured on baseline revenue.</p>

      {loading ? (
        <p className="lead">Loading…</p>
      ) : (
        <>
          <div className="grid">
            <div className="card"><div className="klabel">Deals</div><div className="kval">{totals.count}</div></div>
            <div className="card"><div className="klabel">Baseline revenue</div><div className="kval">{money(totals.baselineRevenue)}</div></div>
            <div className="card"><div className="klabel">Commission</div><div className="kval">{money(totals.commission)}</div></div>
          </div>

          <div className="card goal">
            <div className="goalrow">
              <div>
                <label>Monthly goal (baseline)</label>
                <input type="number" value={goalInput} onChange={(e) => setGoalInput(e.target.value)} placeholder="e.g. 250000" />
              </div>
              <button className="btn" disabled={savingGoal} onClick={saveGoal}>{savingGoal ? "Saving…" : "Save goal"}</button>
            </div>

            {target > 0 && (
              <>
                <div className="bar"><div className="fill" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                <div className="barmeta">
                  <span><b>{pct.toFixed(1)}%</b> of goal</span>
                  <span><b>{money(remaining)}</b> to go</span>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
