import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { startOfWeek, endOfWeek, addDays, format as dfFormat } from "date-fns";
import { Trophy, TrendingUp, Award, Target, ClipboardList, Percent, DollarSign, Wallet, Layers, Flame, Clock, Share2, Check, X } from "lucide-react";
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

function StatTile({ icon: Icon, label, value, sub, color = "#00b894", trend, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick}
      className={`rounded-xl p-3 md:p-4 min-w-0 text-left w-full ${onClick ? "cursor-pointer hover:border-white/25 transition-colors" : ""}`}
      style={{ background: "#1e1e1e", border: "1px solid #2a2a2a" }}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon size={12} style={{ color }} />
        <p className="text-[9px] md:text-[10px] uppercase tracking-widest text-white/30 font-semibold leading-tight">{label}</p>
      </div>
      <p className="text-[17px] md:text-[22px] font-bold leading-none truncate" style={{ color }}>{value}</p>
      {trend ? <div className="mt-1">{trend}</div> : sub && <p className="text-[10px] text-white/30 mt-1 truncate">{sub}</p>}
    </Tag>
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
  const [shared, setShared] = useState("");
  const [viewId, setViewId] = useState(null);   // admins can view another rep's card

  const mr = months[selected];
  const me = viewId || profile?.id;
  const viewUser = useMemo(() => users.find(u => u.id === me) || profile, [users, me, profile]);
  const viewingOther = !!viewId && viewId !== profile?.id;

  useEffect(() => {
    Promise.all([fetchDeals(), fetchCompetitions(), fetchUsers(), fetchWeeklyStats()])
      .then(([{ data: d }, { data: c }, { data: u }, { data: w }]) => {
        setAllDeals((d ?? []).filter(x => !isCanceled(x)));
        setComps(c || []); setUsers(u || []); setWeekly(w || []);
        setLoading(false);
      });
  }, []);

  const ghostIds = useMemo(() => new Set(users.filter(u => u.ghost).map(u => u.id)), [users]);
  const monthDeals = useMemo(() => allDeals.filter(d => d.sale_date?.startsWith(mr.key)), [allDeals, mr.key]);

  const setterRevForMonth = (key) => allDeals
    .filter(d => d.setter_id === me && d.sale_date?.startsWith(key))
    .reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0);
  const wkSum = (key, field) => weekly
    .filter(s => s.rep_id === me && (s.week_start || "").startsWith(key))
    .reduce((s, x) => s + (Number(x[field]) || 0), 0);
  const sgEstForMonth = (key) => wkSum(key, "self_gen_estimates");
  const ldEstForMonth = (key) => wkSum(key, "lead_estimates");
  const setterCountForMonth = (key) => allDeals.filter(d => d.setter_id === me && d.sale_date?.startsWith(key)).length;

  // My stats for the selected month — split self-gen (deals I set) vs leads
  // (deals I closed that someone else set).
  const stats = useMemo(() => {
    const setterDeals = monthDeals.filter(d => d.setter_id === me);
    const leadDeals   = monthDeals.filter(d => d.closer_id === me && d.setter_id !== me);
    const sum = (arr) => arr.reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0);
    const sgRevenue = sum(setterDeals), sgCloses = setterDeals.length, sgEst = sgEstForMonth(mr.key);
    const ldRevenue = sum(leadDeals),   ldCloses = leadDeals.length,   ldEst = ldEstForMonth(mr.key);
    return {
      sgRevenue, sgCloses, sgEst, sgRate: sgEst > 0 ? (sgCloses / sgEst) * 100 : null,
      ldRevenue, ldCloses, ldEst, ldRate: ldEst > 0 ? (ldCloses / ldEst) * 100 : null,
      commission: getUserCommission(monthDeals, me),
      avgDeal: sgCloses > 0 ? sgRevenue / sgCloses : 0,
      hasLeads: ldEst > 0 || ldCloses > 0,
    };
  }, [monthDeals, weekly, allDeals, me, mr.key]);

  // Self-gen closing-% trend vs the previous month.
  const closeDelta = useMemo(() => {
    const pm = months[selected + 1]; if (!pm) return null;
    const est = sgEstForMonth(pm.key); if (!est) return null;
    const prev = (setterCountForMonth(pm.key) / est) * 100;
    return stats.sgRate == null ? null : stats.sgRate - prev;
  }, [months, selected, allDeals, weekly, me, stats.sgRate]);

  // Company rank by setter revenue this month (ghosts excluded for non-admins).
  const rank = useMemo(() => {
    const revBy = {};
    for (const d of monthDeals) if (d.setter_id) revBy[d.setter_id] = (revBy[d.setter_id] || 0) + (parseFloat(d.baseline_revenue) || 0);
    const board = users
      .filter(u => SELLER(u) && (isAdmin || !u.ghost))
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
  }, [monthDeals, users, me, isAdmin]);

  // Personal pace vs the rep's trailing 3-month average (×1.1).
  const pace = useMemo(() => {
    const prev = [1, 2, 3].map(i => months[selected + i]).filter(Boolean).map(m => setterRevForMonth(m.key));
    if (!prev.length) return null;
    const goal = Math.max((prev.reduce((s, v) => s + v, 0) / prev.length) * 1.1, 5000);
    return { goal, pct: Math.min((stats.sgRevenue / goal) * 100, 100) };
  }, [allDeals, me, months, selected, stats.sgRevenue]);

  // Momentum: weekly win streak + last sale.
  const momentum = useMemo(() => {
    const mine = allDeals.filter(d => d.setter_id === me && d.sale_date).map(d => d.sale_date);
    const last = mine.sort((a, b) => b.localeCompare(a))[0] || null;
    const now = new Date();
    const daysSince = last ? Math.max(0, Math.floor((now - new Date(last + "T12:00:00")) / 86400000)) : null;
    const hasWeek = (p) => {
      const ws = dfFormat(p, "yyyy-MM-dd"), we = dfFormat(endOfWeek(p, { weekStartsOn: 1 }), "yyyy-MM-dd");
      return mine.some(d => d >= ws && d <= we);
    };
    let streak = 0, ptr = startOfWeek(now, { weekStartsOn: 1 });
    if (!hasWeek(ptr)) ptr = addDays(ptr, -7);       // current week may be incomplete
    for (let i = 0; i < 52; i++) { if (!hasWeek(ptr)) break; streak++; ptr = addDays(ptr, -7); }
    return { last, daysSince, streak };
  }, [allDeals, me]);

  // Personal best month (by setter revenue) across the last 12 months.
  const best = useMemo(() => {
    let bk = null, bl = null, br = 0;
    for (const m of months) { const r = setterRevForMonth(m.key); if (r > br) { br = r; bk = m.key; bl = m.label; } }
    return br > 0 ? { key: bk, label: bl, rev: br } : null;
  }, [allDeals, me, months]);
  const isBest = best && best.key === mr.key && stats.sgRevenue > 0;

  // Active competitions the rep is entered in.
  const myComps = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const hiddenIds = isAdmin ? null : ghostIds;
    return comps
      .filter(c => competitionStatus(c, today) === "active")
      .map(c => {
        const standings = competitionStandings(c, allDeals, users, { hiddenIds });
        const mine = standings.find(e => e.id === me || (c.type === "team" && e.id === viewUser?.manager_id));
        if (!mine) return null;
        const ahead = mine.rank > 1 ? standings[mine.rank - 2] : null;
        return { comp: c, mine, count: standings.length, leader: standings[0], ahead, gap: ahead ? ahead.score - mine.score : 0 };
      })
      .filter(Boolean);
  }, [comps, allDeals, users, me, viewUser, isAdmin, ghostIds]);

  // Tap-to-view breakdown for a stat tile.
  const [drill, setDrill] = useState(null);
  const toggleDrill = (k) => setDrill(d => d === k ? null : k);
  const drillData = useMemo(() => {
    if (!drill) return null;
    const fmtD = (d) => d ? dfFormat(new Date(d + "T12:00:00"), "MMM d") : "—";
    const byDate = (arr) => arr.slice().sort((a, b) => (b.sale_date || "").localeCompare(a.sale_date || ""));
    const setterDeals = byDate(monthDeals.filter(d => d.setter_id === me));
    const leadDeals   = byDate(monthDeals.filter(d => d.closer_id === me && d.setter_id !== me));
    const dealRows = (arr) => arr.map(d => ({ id: d.id, name: d.deal_name, sub: `${fmtD(d.sale_date)} · ${d.status}`, value: money(parseFloat(d.baseline_revenue) || 0) }));

    if (drill === "sgRevenue" || drill === "sgCloses" || drill === "avgDeal")
      return { title: "Self-gen — deals you set", total: `${stats.sgCloses} deals · ${money(stats.sgRevenue)}`, rows: dealRows(setterDeals) };
    if (drill === "ldRevenue" || drill === "ldCloses")
      return { title: "Leads — deals you closed for another setter", total: `${stats.ldCloses} deals · ${money(stats.ldRevenue)}`, rows: dealRows(leadDeals) };
    if (drill === "sgEst" || drill === "ldEst") {
      const field = drill === "sgEst" ? "self_gen_estimates" : "lead_estimates";
      const rows = weekly.filter(s => s.rep_id === me && (s.week_start || "").startsWith(mr.key))
        .sort((a, b) => (b.week_start || "").localeCompare(a.week_start || ""))
        .map(s => ({ id: s.week_start, name: `Week of ${fmtD(s.week_start)}`, value: String(Number(s[field]) || 0) }));
      return { title: drill === "sgEst" ? "Self-gen estimates" : "Lead estimates", total: `${drill === "sgEst" ? stats.sgEst : stats.ldEst} estimates`, rows };
    }
    if (drill === "commission") {
      const rows = monthDeals.map(d => ({ d, amt: getUserCommission([d], me) })).filter(x => x.amt > 0)
        .sort((a, b) => b.amt - a.amt)
        .map(({ d, amt }) => {
          const roles = [];
          if (d.setter_id === me) roles.push("Self-gen");
          if (d.closer_id === me && d.closer_id !== d.setter_id) roles.push("Closer");
          if (d.manager_id === me) roles.push("Override");
          if (d.director_id === me) roles.push("Override");
          if (d.vp_id === me) roles.push("Override");
          return { id: d.id, name: d.deal_name, sub: `${fmtD(d.sale_date)} · ${[...new Set(roles)].join(", ") || "—"}`, value: money(amt) };
        });
      return { title: "Commission — your earnings", total: `${money(stats.commission)} total`, rows };
    }
    return null;
  }, [drill, monthDeals, weekly, me, mr.key, stats]);

  const firstName = (viewUser?.name || "").split(" ")[0] || "there";
  const initials = (viewUser?.name || "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

  // Share: render the card to a PNG and copy to clipboard (download fallback).
  async function shareCard() {
    const W = 1080, H = 1080, P = 60;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };

    ctx.fillStyle = "#141414"; ctx.fillRect(0, 0, W, H);
    // header band
    const g = ctx.createLinearGradient(0, 0, W, 300); g.addColorStop(0, "#0e3b35"); g.addColorStop(1, "#143d52");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, 300);
    // avatar
    ctx.beginPath(); ctx.arc(P + 56, 150, 56, 0, Math.PI * 2); ctx.fillStyle = "#00b894"; ctx.fill();
    ctx.fillStyle = "#0b0b0b"; ctx.font = "bold 46px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(initials, P + 56, 152);
    // name + sub
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#fff"; ctx.font = "bold 52px Arial"; ctx.fillText(viewUser?.name || "", P + 130, 140);
    ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.font = "28px Arial";
    ctx.fillText(`${(viewUser?.role || "").toUpperCase()} · ${mr.label}`, P + 132, 184);
    // rank (right)
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "bold 22px Arial"; ctx.fillText("COMPANY RANK", W - P, 110);
    ctx.fillStyle = "#fbbf24"; ctx.font = "bold 96px Arial";
    ctx.fillText(rank.ranked ? `#${rank.rank}` : "—", W - P, 200);
    if (rank.ranked) { ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "24px Arial"; ctx.fillText(`of ${rank.total}`, W - P, 240); }
    ctx.textAlign = "left";

    // gap / best ribbon
    ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.font = "26px Arial";
    const ribbon = isBest ? "🔥 Personal best month"
      : rank.ranked ? (rank.ahead ? `${money(rank.gapAhead)} to pass ${rank.ahead.name}` : "🏆 #1 in the company")
      : "Make your first sale to hit the board";
    ctx.fillText(ribbon, P, 262);

    // stat cards
    const tiles = [
      ["REVENUE", money(stats.sgRevenue), "#2dd4bf"],
      ["COMMISSION", money(stats.commission), "#34d399"],
      ["DEALS", String(stats.sgCloses), "#fff"],
      ["CLOSING %", stats.sgRate == null ? "—" : `${stats.sgRate.toFixed(0)}%`, rateColor(stats.sgRate)],
      ["ESTIMATES", String(stats.sgEst), "#74b9ff"],
      [stats.hasLeads ? "LEADS CLOSED" : "WIN STREAK", stats.hasLeads ? String(stats.ldCloses) : `${momentum.streak} wk`, "#fbbf24"],
    ];
    const cw = (W - P * 2 - 40) / 2, ch = 190, gap = 40;
    tiles.forEach((t, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = P + col * (cw + 40), y = 340 + row * (ch + gap);
      ctx.fillStyle = "#1e1e1e"; rr(x, y, cw, ch, 24); ctx.fill();
      ctx.strokeStyle = "#2a2a2a"; ctx.lineWidth = 2; rr(x, y, cw, ch, 24); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "bold 26px Arial"; ctx.fillText(t[0], x + 34, y + 62);
      ctx.fillStyle = t[2]; ctx.font = "bold 70px Arial"; ctx.fillText(t[1], x + 34, y + 145);
    });

    // footer
    ctx.textAlign = "center"; ctx.fillStyle = "#00b894"; ctx.font = "bold 30px Arial";
    ctx.fillText("TURF TIME", W / 2, H - 46);

    cv.toBlob(async (blob) => {
      if (!blob) return;
      try {
        await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]);
        setShared("copied");
      } catch {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${(viewUser?.name || "card").replace(/\s+/g, "-")}-${mr.key}.png`;
        a.click(); URL.revokeObjectURL(a.href);
        setShared("downloaded");
      }
      setTimeout(() => setShared(""), 2200);
    }, "image/png");
  }

  if (loading) return <div className="text-white/30 text-sm py-16 text-center" style={{ background: "#1a1a1a", minHeight: "100%" }}>Loading…</div>;

  const lastLabel = momentum.daysSince == null ? "No sales yet"
    : momentum.daysSince === 0 ? "Today" : momentum.daysSince === 1 ? "Yesterday" : `${momentum.daysSince} days ago`;

  return (
    <div style={{ background: "#1a1a1a", color: "#fff", minHeight: "100%" }} className="pb-8">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-full flex items-center justify-center text-[15px] font-bold text-dark flex-shrink-0"
            style={{ background: "linear-gradient(135deg,#2dd4bf,#00b894)" }}>{initials}</div>
          <div className="min-w-0">
            <h1 className="text-lg md:text-xl font-bold text-white truncate">
              {viewUser?.name}{viewingOther && <span className="text-[11px] font-semibold text-amber-300 ml-2">· viewing</span>}
            </h1>
            <p className="text-[12px] text-white/40 capitalize">{viewUser?.role} · {mr.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          {isAdmin && (
            <select value={viewId || ""} onChange={e => setViewId(e.target.value || null)}
              className="text-[12px] px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white max-w-[160px]"
              title="View another person's card">
              <option value="" style={{ background: "#2a2a2a" }}>My card</option>
              {users.filter(SELLER).slice().sort((a, b) => a.name.localeCompare(b.name)).map(u => (
                <option key={u.id} value={u.id} style={{ background: "#2a2a2a" }}>{u.name}{u.ghost ? " (ghost)" : ""}</option>
              ))}
            </select>
          )}
          <button onClick={shareCard}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold transition-colors"
            style={{ background: shared ? "#00b89420" : "#1e1e1e", border: `1px solid ${shared ? "#00b89455" : "#2a2a2a"}`, color: shared ? "#00b894" : "rgba(255,255,255,0.6)" }}
            title="Copy a shareable card image">
            {shared ? <Check size={14} /> : <Share2 size={14} />}
            {shared === "copied" ? "Copied" : shared === "downloaded" ? "Saved" : "Share"}
          </button>
          <select value={selected} onChange={e => setSelected(Number(e.target.value))}
            className="text-[12px] px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white">
            {months.map((m, i) => <option key={i} value={i} style={{ background: "#2a2a2a" }}>{m.label}</option>)}
          </select>
        </div>
      </div>

      {/* Rank hero */}
      <div className="rounded-2xl p-4 md:p-5 mb-3 relative overflow-hidden"
        style={{ background: "linear-gradient(135deg,#0e3b35,#143d52)", border: "1px solid #1c5a50" }}>
        {isBest && (
          <div className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full"
            style={{ background: "#fb923c22", color: "#fdba74", border: "1px solid #fb923c55" }}>🔥 Personal best</div>
        )}
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

      {/* Momentum strip */}
      <div className="grid grid-cols-2 gap-2 md:gap-3 mb-3">
        <div className="rounded-xl p-3 md:p-4 flex items-center gap-3" style={{ background: "#1e1e1e", border: "1px solid #2a2a2a" }}>
          <Flame size={20} className="flex-shrink-0" style={{ color: momentum.streak > 0 ? "#fb923c" : "#4b5563" }} />
          <div className="min-w-0">
            <p className="text-[17px] md:text-[20px] font-bold leading-none text-white">{momentum.streak} <span className="text-[12px] font-semibold text-white/40">{momentum.streak === 1 ? "week" : "weeks"}</span></p>
            <p className="text-[10px] text-white/30 mt-1">win streak</p>
          </div>
        </div>
        <div className="rounded-xl p-3 md:p-4 flex items-center gap-3" style={{ background: "#1e1e1e", border: "1px solid #2a2a2a" }}>
          <Clock size={20} className="text-teal flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-[15px] md:text-[18px] font-bold leading-none text-white truncate">{lastLabel}</p>
            <p className="text-[10px] text-white/30 mt-1">last sale</p>
          </div>
        </div>
      </div>

      {/* Self-gen stats */}
      <p className="text-[10px] uppercase tracking-widest text-white/30 font-semibold mb-2">Self-gen</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-3">
        <StatTile icon={DollarSign}    label="Revenue"    value={money(stats.sgRevenue)} sub="baseline you set · tap" onClick={() => toggleDrill("sgRevenue")} />
        <StatTile icon={Layers}        label="Closes"     value={stats.sgCloses} sub="deals you set · tap" color="#fff" onClick={() => toggleDrill("sgCloses")} />
        <StatTile icon={ClipboardList} label="Estimates"  value={stats.sgEst} sub="self-gen · tap" color="#74b9ff" onClick={() => toggleDrill("sgEst")} />
        <StatTile icon={Percent}       label="Closing %"  value={stats.sgRate == null ? "—" : `${stats.sgRate.toFixed(0)}%`} color={rateColor(stats.sgRate)} onClick={() => toggleDrill("sgCloses")}
          trend={closeDelta == null ? null : (
            <span className="text-[10px] font-semibold" style={{ color: closeDelta >= 0 ? "#4ade80" : "#f87171" }}>
              {closeDelta >= 0 ? "▲" : "▼"} {Math.abs(closeDelta).toFixed(0)} pts vs last mo
            </span>
          )} />
      </div>

      {/* Leads stats — only when the rep has run leads */}
      {stats.hasLeads && (<>
        <p className="text-[10px] uppercase tracking-widest text-white/30 font-semibold mb-2">Leads</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-3">
          <StatTile icon={DollarSign}    label="Lead Rev"   value={money(stats.ldRevenue)} sub="closed for setters · tap" color="#a78bfa" onClick={() => toggleDrill("ldRevenue")} />
          <StatTile icon={Layers}        label="Leads Closed" value={stats.ldCloses} sub="you closed · tap" color="#fff" onClick={() => toggleDrill("ldCloses")} />
          <StatTile icon={ClipboardList} label="Lead Est"   value={stats.ldEst} sub="leads ran · tap" color="#74b9ff" onClick={() => toggleDrill("ldEst")} />
          <StatTile icon={Percent}       label="Closing %"  value={stats.ldRate == null ? "—" : `${stats.ldRate.toFixed(0)}%`} color={rateColor(stats.ldRate)} onClick={() => toggleDrill("ldCloses")} />
        </div>
      </>)}

      {/* Combined earnings */}
      <div className="grid grid-cols-2 gap-2 md:gap-3 mb-3">
        <StatTile icon={Wallet}     label="Commission" value={money(stats.commission)} sub="your total earnings · tap" color="#34d399" onClick={() => toggleDrill("commission")} />
        <StatTile icon={TrendingUp} label="Avg Deal"   value={money(stats.avgDeal)} sub="per self-gen deal · tap" color="#fff" onClick={() => toggleDrill("avgDeal")} />
      </div>

      {/* Stat drill-down — inline, subtle */}
      {drill && drillData && (
        <div className="rounded-xl mb-3 overflow-hidden" style={{ background: "#1e1e1e", border: "1px solid #2a2a2a" }}>
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5" style={{ background: "#171717" }}>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-white truncate">{drillData.title}</p>
              <p className="text-[10px] text-white/40">{mr.label} · {drillData.total}</p>
            </div>
            <button onClick={() => setDrill(null)} className="text-white/40 hover:text-white p-1 flex-shrink-0"><X size={15} /></button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {drillData.rows.length === 0 ? (
              <p className="px-4 py-6 text-center text-white/30 text-[12px]">Nothing here for {mr.label}.</p>
            ) : drillData.rows.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2 border-b border-white/5 last:border-0">
                <div className="min-w-0">
                  <p className="text-[12px] text-white/80 truncate">{r.name}</p>
                  {r.sub && <p className="text-[10px] text-white/35">{r.sub}</p>}
                </div>
                <span className="text-[12px] font-semibold text-teal whitespace-nowrap">{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Personal pace */}
      {pace && (
        <div className="rounded-xl p-4 mb-3" style={{ background: "#1e1e1e", border: "1px solid #2a2a2a" }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] uppercase tracking-widest text-white/30 font-semibold flex items-center gap-1.5">
              <Target size={12} className="text-teal" /> Monthly pace
            </p>
            <p className="text-[11px] text-white/40">
              <span className="font-bold text-white">{money(stats.sgRevenue)}</span> of {money(pace.goal)} target
            </p>
          </div>
          <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "#2a2a2a" }}>
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${pace.pct}%`, background: pace.pct >= 100 ? "#4ade80" : "#00b894" }} />
          </div>
          <p className="text-[10px] text-white/30 mt-1.5">
            Target = your trailing 3-month average +10%.{best ? ` · Best month: ${best.label} (${money(best.rev)})` : ""}
          </p>
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
              const denom = target > 0 ? target : (leader?.score || 0);
              const w = denom > 0 ? Math.min((mine.score / denom) * 100, 100) : 0;
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
                  <div className="h-1.5 rounded-full overflow-hidden mt-2" style={{ background: "#ffffff12" }}>
                    <div className="h-full rounded-full" style={{ width: `${w}%`, background: mine.earned ? "#00b894" : "#2dd4bf" }} />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
