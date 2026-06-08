import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Trophy, TrendingUp, Award, Target, ClipboardList, Percent, DollarSign, Wallet, Layers } from "lucide-react";
import { fetchDeals, fetchCompetitions, fetchUsers, fetchWeeklyStats } from "../lib/db";
import { getUserCommission, isCanceled } from "../utils/commission";
import { useAuth } from "../contexts/AuthContext";
import { competitionStandings, competitionStatus, fmtScore } from "../utils/competition";

const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
const SELLER = (u) => ["rep", "manager", "director", "vp"].includes(u.role);

function getMonths(n = 12) {
  const months = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const pad = (x) => String(x).padStart(2, "0");
    months.push({
      y: d.getFullYear(), m: d.getMonth() + 1,
      key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
      label: d.toLocaleString("en-US", { month: "long", year: "numeric" }),
    });
  }
  return months;
}

function rateColor(r) {
  if (r == null) return "#6b7280";
  if (r >= 40) return "#4ade80";
  if (r >= 25) return "#fbbf24";
  return "#fb923c";
}

function StatTile({ icon: Icon, label, value, sub, color = "#00b894" }) {
  return (
    <div className="rounded-xl p-3 md:p-4 min-w-0" style={{ background: "#1e1e1e", border: "1px solid #2a2a2a" }}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon size={12} style={{ color }} />
        <p className="text-[9px] md:text-[10px] uppercase tracking-widest text-white/30 font-semibold leading-tight">{label}</p>
      </div>
      <p className="text-[17px] md:text-[22px] font-bold leading-none truncate" style={{ color }}>{value}</p>
      {sub && <p className="text-[10px] text-white/30 mt-1 truncate">{sub}</p>}
    </div>
  );
}

export default function Home() {
  const { profile, isAdmin } = useAuth();
  const months = useMemo(() => getMonths(12), []);
  const [selected, setSelected] = useState(0);
  const [allDeals, setAllDeals] = useState([]);
  const [comps, setComps] = useState([]);
  const [users, setUsers] = useState([]);
  const [weekly, setWeekly] = useState([]);
  const [loading, setLoading] = useState(true);

  const mr = months[selected];
  const me = profile?.id;

  useEffect(() => {
    Promise.all([fetchDeals(), fetchCompetitions(), fetchUsers(), fetchWeeklyStats()])
      .then(([{ data: d }, { data: c }, { data: u }, { data: w }]) => {
        setAllDeals((d ?? []).filter(x => !isCanceled(x)));
        setComps(c || []); setUsers(u || []); setWeekly(w || []);
        setLoading(false);
      });
  }, []);

  const ghostIds = useMemo(() => new Set(users.filter(u => u.ghost).map(u => u.id)), [users]);

  // Deals in the selected month.
  const monthDeals = useMemo(() => allDeals.filter(d => d.sale_date?.startsWith(mr.key)), [allDeals, mr.key]);

  // My personal stats (setter-based revenue/deals to match the company leaderboard).
  const stats = useMemo(() => {
    const mine = monthDeals.filter(d => d.setter_id === me);
    const revenue = mine.reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0);
    const deals = mine.length;
    const commission = getUserCommission(monthDeals, me);
    const estimates = weekly
      .filter(s => s.rep_id === me && (s.week_start || "").startsWith(mr.key))
      .reduce((s, x) => s + (Number(x.estimates) || 0), 0);
    const closeRate = estimates > 0 ? (deals / estimates) * 100 : null;
    const avgDeal = deals > 0 ? revenue / deals : 0;
    return { revenue, deals, commission, estimates, closeRate, avgDeal };
  }, [monthDeals, weekly, me, mr.key]);

  // Company rank by setter revenue this month (ghosts excluded so reps don't see them).
  const rank = useMemo(() => {
    const revBy = {};
    for (const d of monthDeals) if (d.setter_id) revBy[d.setter_id] = (revBy[d.setter_id] || 0) + (parseFloat(d.baseline_revenue) || 0);
    const board = users
      .filter(u => SELLER(u) && !u.ghost)
      .map(u => ({ id: u.id, name: u.name, revenue: revBy[u.id] || 0 }))
      .filter(r => r.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue);
    const idx = board.findIndex(r => r.id === me);
    if (idx === -1) return { ranked: false, total: board.length };
    const ahead = idx > 0 ? board[idx - 1] : null;
    const behind = board[idx + 1] || null;
    return {
      ranked: true, rank: idx + 1, total: board.length, myRev: board[idx].revenue,
      ahead, gapAhead: ahead ? ahead.revenue - board[idx].revenue : 0,
      behind, leadBehind: behind ? board[idx].revenue - behind.revenue : 0,
    };
  }, [monthDeals, users, me]);

  // Personal pace vs the rep's own trailing 3-month average (×1.1).
  const pace = useMemo(() => {
    const setterRev = (key) => allDeals
      .filter(d => d.setter_id === me && d.sale_date?.startsWith(key))
      .reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0);
    const prev = [1, 2, 3].map(i => months[selected + i]).filter(Boolean).map(m => setterRev(m.key));
    if (!prev.length) return null;
    const goal = Math.max((prev.reduce((s, v) => s + v, 0) / prev.length) * 1.1, 5000);
    return { goal, pct: Math.min((stats.revenue / goal) * 100, 100) };
  }, [allDeals, me, months, selected, stats.revenue]);

  // Active competitions the rep is entered in.
  const myComps = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const hiddenIds = isAdmin ? null : ghostIds;
    return comps
      .filter(c => competitionStatus(c, today) === "active")
      .map(c => {
        const standings = competitionStandings(c, allDeals, users, { hiddenIds });
        const mine = standings.find(e => e.id === me || (c.type === "team" && e.id === profile?.manager_id));
        if (!mine) return null;
        const ahead = mine.rank > 1 ? standings[mine.rank - 2] : null;
        return { comp: c, mine, count: standings.length, leader: standings[0], ahead, gap: ahead ? ahead.score - mine.score : 0 };
      })
      .filter(Boolean);
  }, [comps, allDeals, users, me, profile, isAdmin, ghostIds]);

  const firstName = (profile?.name || "").split(" ")[0] || "there";
  const initials = (profile?.name || "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

  if (loading) return <div className="text-white/30 text-sm py-16 text-center" style={{ background: "#1a1a1a", minHeight: "100%" }}>Loading…</div>;

  return (
    <div style={{ background: "#1a1a1a", color: "#fff", minHeight: "100%" }} className="pb-8">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-full flex items-center justify-center text-[15px] font-bold text-dark flex-shrink-0"
            style={{ background: "linear-gradient(135deg,#2dd4bf,#00b894)" }}>{initials}</div>
          <div className="min-w-0">
            <h1 className="text-lg md:text-xl font-bold text-white truncate">{profile?.name}</h1>
            <p className="text-[12px] text-white/40 capitalize">{profile?.role} · {mr.label}</p>
          </div>
        </div>
        <select value={selected} onChange={e => setSelected(Number(e.target.value))}
          className="text-[12px] px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white flex-shrink-0">
          {months.map((m, i) => <option key={i} value={i} style={{ background: "#2a2a2a" }}>{m.label}</option>)}
        </select>
      </div>

      {/* Rank hero */}
      <div className="rounded-2xl p-4 md:p-5 mb-3 relative overflow-hidden"
        style={{ background: "linear-gradient(135deg,#0e3b35,#143d52)", border: "1px solid #1c5a50" }}>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-white/50 font-semibold mb-1 flex items-center gap-1.5">
              <Award size={13} className="text-amber-300" /> Company Rank
            </p>
            {rank.ranked ? (
              <>
                <p className="text-[30px] md:text-[40px] font-extrabold leading-none text-white">
                  #{rank.rank}<span className="text-[16px] md:text-[20px] font-bold text-white/40"> / {rank.total}</span>
                </p>
                <p className="text-[12px] md:text-[13px] mt-2 text-white/80">
                  {rank.ahead
                    ? <><span className="font-bold text-amber-300">{money(rank.gapAhead)}</span> to pass <span className="font-semibold">{rank.ahead.name}</span></>
                    : <>🏆 You're #1{rank.behind ? <> — leading {rank.behind.name} by <span className="font-bold text-amber-300">{money(rank.leadBehind)}</span></> : ""}</>}
                </p>
              </>
            ) : (
              <>
                <p className="text-[22px] md:text-[26px] font-extrabold leading-tight text-white">Not ranked yet</p>
                <p className="text-[12px] mt-1.5 text-white/60">Log a sale this month to hit the board, {firstName}.</p>
              </>
            )}
          </div>
          <Trophy size={54} className="text-white/10 flex-shrink-0" />
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3 mb-3">
        <StatTile icon={DollarSign}    label="Revenue"    value={money(stats.revenue)} sub="baseline you set" />
        <StatTile icon={Wallet}        label="Commission" value={money(stats.commission)} sub="your earnings" color="#34d399" />
        <StatTile icon={Layers}        label="Deals"      value={stats.deals} sub="closed this month" color="#fff" />
        <StatTile icon={ClipboardList} label="Estimates"  value={stats.estimates} sub="given this month" color="#74b9ff" />
        <StatTile icon={Percent}       label="Closing %"  value={stats.closeRate == null ? "—" : `${stats.closeRate.toFixed(0)}%`} sub="deals ÷ estimates" color={rateColor(stats.closeRate)} />
        <StatTile icon={TrendingUp}    label="Avg Deal"   value={money(stats.avgDeal)} sub="per deal" color="#fff" />
      </div>

      {/* Personal pace */}
      {pace && (
        <div className="rounded-xl p-4 mb-3" style={{ background: "#1e1e1e", border: "1px solid #2a2a2a" }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] uppercase tracking-widest text-white/30 font-semibold flex items-center gap-1.5">
              <Target size={12} className="text-teal" /> Monthly pace
            </p>
            <p className="text-[11px] text-white/40">
              <span className="font-bold text-white">{money(stats.revenue)}</span> of {money(pace.goal)} target
            </p>
          </div>
          <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "#2a2a2a" }}>
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${pace.pct}%`, background: pace.pct >= 100 ? "#4ade80" : "#00b894" }} />
          </div>
          <p className="text-[10px] text-white/30 mt-1.5">Target = your trailing 3-month average +10%.</p>
        </div>
      )}

      {/* Active competitions */}
      <div className="rounded-xl p-4 md:p-5" style={{ background: "#1e1e1e", border: "1px solid #2a2a2a" }}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] uppercase tracking-widest text-white/30 font-semibold flex items-center gap-1.5">
            <Trophy size={13} className="text-amber-300" /> Your competitions
          </p>
          <Link to="/competitions" className="text-[11px] text-teal hover:underline">View all</Link>
        </div>
        {myComps.length === 0 ? (
          <p className="text-[12px] text-white/30 py-2">You're not in any active competitions right now.</p>
        ) : (
          <div className="space-y-2">
            {myComps.map(({ comp, mine, count, leader, ahead, gap }) => {
              const target = mine.target > 0 ? mine.target : 0;
              return (
                <Link key={comp.id} to="/competitions"
                  className="block rounded-lg px-3 py-2.5 hover:bg-white/[0.03] transition-colors"
                  style={{ background: "#171717", border: "1px solid #262626" }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-white truncate">{comp.name}</span>
                    <span className="text-[12px] font-bold whitespace-nowrap" style={{ color: mine.rank === 1 ? "#fbbf24" : "#2dd4bf" }}>
                      {mine.earned ? "🎉 Earned" : `#${mine.rank} of ${count}`}
                    </span>
                  </div>
                  <div className="text-[11px] text-white/40 mt-1">
                    You: <span className="text-white/70 font-semibold">{fmtScore(mine.score, comp.metric)}</span>
                    {target > 0
                      ? <> · target {fmtScore(target, comp.metric)}</>
                      : ahead
                        ? <> · <span className="text-amber-300">{fmtScore(gap, comp.metric)}</span> to pass {ahead.name}</>
                        : <> · 🏆 leading</>}
                  </div>
                  {/* progress bar: toward target, else share of the leader */}
                  {(() => {
                    const denom = target > 0 ? target : (leader?.score || 0);
                    const w = denom > 0 ? Math.min((mine.score / denom) * 100, 100) : 0;
                    return (
                      <div className="h-1.5 rounded-full overflow-hidden mt-2" style={{ background: "#ffffff12" }}>
                        <div className="h-full rounded-full" style={{ width: `${w}%`, background: mine.earned ? "#00b894" : "#2dd4bf" }} />
                      </div>
                    );
                  })()}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
