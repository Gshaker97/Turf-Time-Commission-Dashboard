import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { dealAmounts, rollup } from "../utils/commission";

const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");

function monthRange(d = new Date()) {
  const y = d.getFullYear(), m = d.getMonth();
  const iso = (x) => x.toISOString().slice(0, 10);
  return {
    start: iso(new Date(y, m, 1)),
    nextStart: iso(new Date(y, m + 1, 1)),
    label: new Date(y, m, 1).toLocaleString("en-US", { month: "long", year: "numeric" }),
  };
}

export default function Deals() {
  const mr = useMemo(() => monthRange(), []);
  const [deals, setDeals] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("rep"); // rep | team | total

  useEffect(() => {
    (async () => {
      const [{ data: d }, { data: p }] = await Promise.all([
        supabase.from("deals").select("*").gte("sale_date", mr.start).lt("sale_date", mr.nextStart).order("sale_date", { ascending: false }),
        supabase.from("profiles").select("id,name"),
      ]);
      setDeals(d || []);
      setProfiles(p || []);
      setLoading(false);
    })();
  }, [mr]);

  const nameById = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p.name])), [profiles]);

  const byRep = useMemo(() => {
    const m = {};
    const bump = (id, amt, dealId) => {
      if (!id) return;
      if (!m[id]) m[id] = { id, name: nameById[id] || "—", amount: 0, deals: new Set() };
      m[id].amount += amt;
      m[id].deals.add(dealId);
    };
    deals.forEach((d) => {
      const a = dealAmounts(d);
      bump(d.setter_id, a.setter, d.id);
      if (d.closer_id) bump(d.closer_id, a.closer, d.id);
    });
    return Object.values(m).map((r) => ({ ...r, count: r.deals.size })).sort((x, y) => y.amount - x.amount);
  }, [deals, nameById]);

  const byTeam = useMemo(() => {
    const m = {};
    deals.forEach((d) => {
      const key = d.manager_id || "none";
      if (!m[key]) m[key] = { name: key === "none" ? "No manager" : nameById[key] || "—", count: 0, baseline: 0, commission: 0, override: 0 };
      const a = dealAmounts(d);
      m[key].count += 1;
      m[key].baseline += a.baseline;
      m[key].commission += a.totalCommission;
      m[key].override += a.manager;
    });
    return Object.values(m).sort((x, y) => y.commission - x.commission);
  }, [deals, nameById]);

  const totals = useMemo(() => rollup(deals), [deals]);

  return (
    <div className="ttd-deals">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&display=swap');
        .ttd-deals{ --bg:#f6f7f5; --card:#fff; --line:#e3e6e1; --text:#1c2420; --muted:#6b746c; --green:#15803d;
          font-family:'Hanken Grotesk',-apple-system,sans-serif; color:var(--text);
          background:var(--bg); min-height:100%; padding:28px 22px 60px; box-sizing:border-box; }
        .ttd-deals *{ box-sizing:border-box; }
        .ttd-deals h1{ font-size:22px; font-weight:700; margin:0 0 2px; }
        .ttd-deals .lead{ color:var(--muted); font-size:13px; margin:0 0 18px; }
        .toggle{ display:inline-flex; border:1px solid var(--line); border-radius:10px; overflow:hidden; margin-bottom:18px; }
        .toggle button{ border:0; background:#fff; padding:9px 18px; font:inherit; font-size:13px; font-weight:600;
          color:var(--muted); cursor:pointer; }
        .toggle button.on{ background:var(--green); color:#fff; }
        .card{ background:var(--card); border:1px solid var(--line); border-radius:14px; padding:6px 18px; max-width:920px; }
        table{ width:100%; border-collapse:collapse; }
        th,td{ text-align:left; padding:12px 8px; font-size:14px; border-bottom:1px solid var(--line); }
        th{ font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); font-weight:600; }
        td.num,th.num{ text-align:right; font-variant-numeric:tabular-nums; }
        tr:last-child td{ border-bottom:0; }
        .totbar{ display:grid; grid-template-columns:repeat(3,1fr); gap:14px; max-width:920px; margin-bottom:14px; }
        @media(max-width:620px){ .totbar{ grid-template-columns:1fr; } }
        .kcard{ background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; }
        .klabel{ font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); font-weight:600; }
        .kval{ font-size:26px; font-weight:700; margin-top:6px; }
      `}</style>

      <h1>Deals — {mr.label}</h1>
      <p className="lead">Toggle how deals roll up.</p>

      <div className="toggle">
        <button className={view === "rep" ? "on" : ""} onClick={() => setView("rep")}>By rep</button>
        <button className={view === "team" ? "on" : ""} onClick={() => setView("team")}>By manager's team</button>
        <button className={view === "total" ? "on" : ""} onClick={() => setView("total")}>Total</button>
      </div>

      {loading ? (
        <p className="lead">Loading…</p>
      ) : view === "rep" ? (
        <div className="card">
          <table>
            <thead><tr><th>Rep</th><th className="num">Deals</th><th className="num">Commission</th></tr></thead>
            <tbody>
              {byRep.map((r) => (
                <tr key={r.id}><td>{r.name}</td><td className="num">{r.count}</td><td className="num">{money(r.amount)}</td></tr>
              ))}
              {byRep.length === 0 && <tr><td colSpan={3}>No deals this month.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : view === "team" ? (
        <div className="card">
          <table>
            <thead><tr><th>Manager</th><th className="num">Deals</th><th className="num">Baseline</th><th className="num">Mgr override</th><th className="num">Total comm.</th></tr></thead>
            <tbody>
              {byTeam.map((t, i) => (
                <tr key={i}><td>{t.name}</td><td className="num">{t.count}</td><td className="num">{money(t.baseline)}</td><td className="num">{money(t.override)}</td><td className="num">{money(t.commission)}</td></tr>
              ))}
              {byTeam.length === 0 && <tr><td colSpan={5}>No deals this month.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="totbar">
            <div className="kcard"><div className="klabel">Deals</div><div className="kval">{totals.count}</div></div>
            <div className="kcard"><div className="klabel">Baseline revenue</div><div className="kval">{money(totals.baselineRevenue)}</div></div>
            <div className="kcard"><div className="klabel">Commission</div><div className="kval">{money(totals.commission)}</div></div>
          </div>
          <div className="card">
            <table>
              <thead><tr><th>Deal</th><th>Date</th><th className="num">Baseline</th><th className="num">Commission</th></tr></thead>
              <tbody>
                {deals.map((d) => (
                  <tr key={d.id}><td>{d.deal_name}</td><td>{d.sale_date}</td><td className="num">{money(d.baseline_revenue)}</td><td className="num">{money(dealAmounts(d).totalCommission)}</td></tr>
                ))}
                {deals.length === 0 && <tr><td colSpan={4}>No deals this month.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
