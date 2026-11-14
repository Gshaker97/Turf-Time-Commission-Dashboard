import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { startOfWeek, endOfWeek, addDays, format as dfFormat } from "date-fns";
import { Trophy, TrendingUp, Award, Target, ClipboardList, Percent, DollarSign, Wallet, Layers, Flame, Clock, Share2, Check, X, DoorOpen, CalendarCheck } from "lucide-react";
import { fetchDeals, fetchCompetitions, fetchUsers, fetchWeeklyStats, fetchLeads, fetchTeamChanges, fetchRepcardLeaderboard } from "../lib/db";
import { headIdSet, teamKeyFor, buildChangesByProfile } from "../utils/team";
import { estimatesFor } from "../utils/estimates";
import { onClickUnlessSelecting } from "../utils/selection";
import { getUserCommission, countsInTotals, fmt } from "../utils/commission";
import { personalBests } from "../utils/records";
import { useSettings } from "../contexts/SettingsContext";
import { useAuth } from "../contexts/AuthContext";
import { competitionStandings, competitionStatus, fmtScore } from "../utils/competition";
import { SURFACE, Card, Eyebrow, SecondaryButton, LoadingBlock, EmptyBlock } from "../components/ui";

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

// Closing-rate tone on the tokens: strong = sage, middling = amber, weak = rose.
// Returned as CSS values for the page and as hex for the canvas card.
const RATE_HEX = { pos: "#a9c4b2", warn: "#d2a074", neg: "#d98c80", mu: "#a19e97" };
function rateKey(r) { if (r == null) return "mu"; if (r >= 40) return "pos"; if (r >= 25) return "warn"; return "neg"; }
const rateColor = (r) => `var(--${rateKey(r)})`;
const rateHex   = (r) => RATE_HEX[rateKey(r)];

// A compact derived-average cell for the RepCard metrics row.
function Avg({ label, value, sub }) {
  return (
    <div className="text-center min-w-0">
      <p className="text-[13px] uppercase tracking-wide text-bank-fa font-semibold truncate">{label}</p>
      <p className="text-[20px] md:text-[22px] font-bold text-bank-tx mt-0.5 tabular-nums">{value}</p>
      <p className="text-[13px] text-bank-mu truncate">{sub}</p>
    </div>
  );
}

// One stat tile. `color` is only ever the page's single gold number
// (var(--gold-tx)) or a closing-rate tone; everything else is ivory.
function StatTile({ icon: Icon, label, value, sub, color, trend, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick ? onClickUnlessSelecting(onClick) : undefined}
      className={`rounded-2xl p-3.5 md:p-4 min-w-0 min-h-[44px] text-left w-full ${onClick ? "cursor-pointer hover:bg-bank-raise transition-colors" : ""}`}
      style={SURFACE.card}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon size={13} className="text-bank-fa flex-shrink-0" aria-hidden="true" />
        <p className="text-[13px] uppercase tracking-wide text-bank-fa font-semibold leading-tight truncate">{label}</p>
      </div>
      <p className="text-[20px] md:text-[24px] font-bold leading-none truncate tabular-nums" style={{ color: color || "var(--tx)" }}>{value}</p>
      {trend ? <div className="mt-1.5">{trend}</div> : sub && <p className="text-[13px] text-bank-mu mt-1.5 truncate">{sub}</p>}
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
  const { dataStartDate, estimatesFrom } = useSettings();
  const [leads, setLeads] = useState([]);

  // Personal bests (owner-credited, completed periods) + how close the
  // current month is to the rep's best — the "beat yourself" nudge.
  const bests = useMemo(() => {
    if (!me || !allDeals.length) return null;
    return personalBests(allDeals, me, { dataStartDate, todayISO: dfFormat(new Date(), "yyyy-MM-dd") });
  }, [allDeals, me, dataStartDate]);
  const viewUser = useMemo(() => users.find(u => u.id === me) || profile, [users, me, profile]);
  const viewingOther = !!viewId && viewId !== profile?.id;

  const [teamChanges, setTeamChanges] = useState([]);
  useEffect(() => {
    Promise.all([fetchDeals(), fetchCompetitions(), fetchUsers(), fetchWeeklyStats(), fetchLeads(), fetchTeamChanges()])
      .then(([{ data: d }, { data: c }, { data: u }, { data: w }, { data: ld }, { data: tc }]) => {
        setAllDeals((d ?? []).filter(countsInTotals));
        setComps(c || []); setUsers(u || []); setWeekly(w || []);
        setLeads(ld || []);
        setTeamChanges(tc || []);
        setLoading(false);
      });
  }, []);

  // RepCard D2D leaderboard — the ONLY source whose door numbers reconcile with
  // what reps see in RepCard (the webhook/customers feeds only capture pins
  // attached to a saved contact and undercount badly). The Field-activity
  // section lets the rep pick ONE date window; the board is fetched for that
  // window and the card picks its rep's row by name. configured:null = loading.
  const faIso = (d) => dfFormat(d, "yyyy-MM-dd");
  const [faPreset, setFaPreset] = useState("week");   // week|month|lastMonth|90d|custom
  const [faFrom, setFaFrom] = useState(() => faIso(startOfWeek(new Date(), { weekStartsOn: 1 })));
  const [faTo, setFaTo] = useState(() => faIso(endOfWeek(new Date(), { weekStartsOn: 1 })));
  const faRange = useMemo(() => {
    const today = new Date(), y = today.getFullYear(), m = today.getMonth();
    if (faPreset === "month") return { from: faIso(new Date(y, m, 1)), to: faIso(new Date(y, m + 1, 0)), label: "This month" };
    if (faPreset === "lastMonth") return { from: faIso(new Date(y, m - 1, 1)), to: faIso(new Date(y, m, 0)), label: "Last month" };
    if (faPreset === "90d") return { from: faIso(addDays(today, -90)), to: faIso(today), label: "Last 90 days" };
    if (faPreset === "custom") return { from: faFrom, to: faTo, label: `${faFrom} – ${faTo}` };
    return { from: faIso(startOfWeek(today, { weekStartsOn: 1 })), to: faIso(endOfWeek(today, { weekStartsOn: 1 })), label: "This week" };   // RepCard weeks run Mon–Sun
  }, [faPreset, faFrom, faTo]);

  const [repcard, setRepcard] = useState({ configured: null, rows: [] });
  useEffect(() => {
    if (!faRange.from || !faRange.to) return;
    let cancelled = false;
    fetchRepcardLeaderboard(faRange.from, faRange.to)
      .then((res) => { if (!cancelled) setRepcard({ configured: !!res?.configured, rows: res?.rows || [] }); })
      .catch(() => { if (!cancelled) setRepcard({ configured: false, rows: [] }); });
    return () => { cancelled = true; };
  }, [faRange.from, faRange.to]);

  const ghostIds = useMemo(() => new Set(users.filter(u => u.ghost).map(u => u.id)), [users]);
  // Same date-effective team context the Competitions page scores with, so
  // the "Your competitions" card can never show a different rank than the
  // leaderboard it links to.
  const teamCtx = useMemo(() => ({
    usersById: Object.fromEntries(users.map(u => [u.id, u])),
    heads: headIdSet(users),
    changesByProfile: buildChangesByProfile(teamChanges),
  }), [users, teamChanges]);
  const monthDeals = useMemo(() => allDeals.filter(d => d.sale_date?.startsWith(mr.key)), [allDeals, mr.key]);

  // RepCard field metrics for the shown rep, read straight off RepCard's D2D
  // leaderboard so the numbers equal what the rep sees in RepCard. Doors +
  // appointments come from the board (this week / last month / a trailing
  // 90-day span); CLOSES stay our own deals (per Keaton — go off actual sales,
  // not the CRM's "sold"). Rows are matched to the rep BY NAME, the same
  // fallback the leads feed uses. Returns configured=false → the card hides its
  // door tiles; null → still loading.
  const repCard = useMemo(() => {
    if (repcard.configured === null) return { configured: null };
    if (!repcard.configured) return { configured: false };
    const myName = (users.find((u) => u.id === me)?.name || viewUser?.name || "").trim().toLowerCase();
    const row = repcard.rows.find((r) => r.name.toLowerCase() === myName) || null;

    const doors = row?.doors || 0, appts = row?.appts || 0, knockDays = row?.knockDays || 0;
    // CLOSES stay our own deals (per Keaton — go off actual sales, not the CRM's
    // "sold"), counted in the SAME window the doors/appts come from.
    const closes = allDeals.filter((d) => d.setter_id === me && d.sale_date
      && d.sale_date >= faRange.from && d.sale_date <= faRange.to).length;
    return {
      configured: true,
      doors, appts, closes,
      avgDoorsPerDay: knockDays > 0 ? doors / knockDays : null,
      doorsPerAppt: appts > 0 ? doors / appts : null,
      apptsPerClose: closes > 0 ? appts / closes : null,
    };
  }, [repcard, users, me, viewUser, allDeals, faRange.from, faRange.to]);

  const setterRevForMonth = (key) => allDeals
    .filter(d => d.setter_id === me && d.sale_date?.startsWith(key))
    .reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0);
  // Estimates come from the leads feed on/after the cutover, manual before —
  // one shared rule so Home, Goals and Performance never disagree.
  const monthEstimates = (key) => estimatesFor({
    leads, weeklyStats: weekly, repId: me,
    start: `${key}-01`, end: `${key}-31`, from: estimatesFrom,
  });
  const sgEstForMonth = (key) => monthEstimates(key).sgEst;
  const ldEstForMonth = (key) => monthEstimates(key).leadEst;
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
      const ws = dfFormat(p, "yyyy-MM-dd"), we = dfFormat(endOfWeek(p, { weekStartsOn: 0 }), "yyyy-MM-dd");
      return mine.some(d => d >= ws && d <= we);
    };
    let streak = 0, ptr = startOfWeek(now, { weekStartsOn: 0 });
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
    const today = dfFormat(new Date(), "yyyy-MM-dd");   // local, not UTC
    const hiddenIds = isAdmin ? null : ghostIds;
    // Team Average rows match by the viewer's RESOLVED team key (same grouping
    // the engine scores by); a rep left out of the contest isn't in it.
    const myTeamKey = viewUser ? teamKeyFor(viewUser, teamCtx.heads) : null;
    return comps
      .filter(c => competitionStatus(c, today) === "active")
      .map(c => {
        const standings = competitionStandings(c, allDeals, users, { hiddenIds, teamCtx });
        const mine = standings.find(e => e.id === me
          || (c.type === "team" && e.id === viewUser?.manager_id)
          || (c.type === "team_avg" && e.id === myTeamKey && !(c.excluded_ids || []).includes(me)));
        if (!mine) return null;
        const ahead = mine.rank > 1 ? standings[mine.rank - 2] : null;
        return { comp: c, mine, count: standings.length, leader: standings[0], ahead, gap: ahead ? ahead.score - mine.score : 0 };
      })
      .filter(Boolean);
  }, [comps, allDeals, users, me, viewUser, isAdmin, ghostIds, teamCtx]);

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

    ctx.fillStyle = "#131416"; ctx.fillRect(0, 0, W, H);
    // header band
    const g = ctx.createLinearGradient(0, 0, W, 300); g.addColorStop(0, "#1c1e21"); g.addColorStop(1, "#23262a");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, 300);
    // avatar
    ctx.beginPath(); ctx.arc(P + 56, 150, 56, 0, Math.PI * 2); ctx.fillStyle = "#bfa46c"; ctx.fill();
    ctx.fillStyle = "#191509"; ctx.font = "bold 46px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(initials, P + 56, 152);
    // name + sub
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#ede7da"; ctx.font = "bold 52px Arial"; ctx.fillText(viewUser?.name || "", P + 130, 140);
    ctx.fillStyle = "#a19e97"; ctx.font = "28px Arial";
    ctx.fillText(`${(viewUser?.role || "").toUpperCase()} · ${mr.label}`, P + 132, 184);
    // rank (right)
    ctx.textAlign = "right";
    ctx.fillStyle = "#8c8a84"; ctx.font = "bold 22px Arial"; ctx.fillText("COMPANY RANK", W - P, 110);
    ctx.fillStyle = "#ede7da"; ctx.font = "bold 96px Arial";
    ctx.fillText(rank.ranked ? `#${rank.rank}` : "—", W - P, 200);
    if (rank.ranked) { ctx.fillStyle = "#a19e97"; ctx.font = "24px Arial"; ctx.fillText(`of ${rank.total}`, W - P, 240); }
    ctx.textAlign = "left";

    // gap / best ribbon
    ctx.fillStyle = "#ede7da"; ctx.font = "26px Arial";
    const ribbon = isBest ? "🔥 Personal best month"
      : rank.ranked ? (rank.ahead ? `${money(rank.gapAhead)} to pass ${rank.ahead.name}` : "🏆 #1 in the company")
      : "Make your first sale to hit the board";
    ctx.fillText(ribbon, P, 262);

    // stat cards
    const tiles = [
      ["REVENUE", money(stats.sgRevenue), "#ede7da"],
      ["COMMISSION", money(stats.commission), "#cdb684"],   // the one gold number
      ["DEALS", String(stats.sgCloses), "#ede7da"],
      ["CLOSING %", stats.sgRate == null ? "—" : `${stats.sgRate.toFixed(0)}%`, rateHex(stats.sgRate)],
      ["ESTIMATES", String(stats.sgEst), "#ede7da"],
      [stats.hasLeads ? "LEADS CLOSED" : "WIN STREAK", stats.hasLeads ? String(stats.ldCloses) : `${momentum.streak} wk`, "#ede7da"],
    ];
    const cw = (W - P * 2 - 40) / 2, ch = 190, gap = 40;
    tiles.forEach((t, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = P + col * (cw + 40), y = 340 + row * (ch + gap);
      ctx.fillStyle = "#1c1e21"; rr(x, y, cw, ch, 24); ctx.fill();
      ctx.strokeStyle = "#2c2f33"; ctx.lineWidth = 2; rr(x, y, cw, ch, 24); ctx.stroke();
      ctx.fillStyle = "#a19e97"; ctx.font = "bold 26px Arial"; ctx.fillText(t[0], x + 34, y + 62);
      ctx.fillStyle = t[2]; ctx.font = "bold 70px Arial"; ctx.fillText(t[1], x + 34, y + 145);
    });

    // footer
    ctx.textAlign = "center"; ctx.fillStyle = "#bfa46c"; ctx.font = "bold 30px Arial";
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

  if (loading) return <LoadingBlock text="Loading your card…" />;

  const lastLabel = momentum.daysSince == null ? "No sales yet"
    : momentum.daysSince === 0 ? "Today" : momentum.daysSince === 1 ? "Yesterday" : `${momentum.daysSince} days ago`;

  const selectCls = "text-[13px] px-3 py-2 min-h-[44px] md:min-h-0 rounded-lg text-bank-tx focus:outline-none";

  return (
    <div style={{ color: "var(--tx)", minHeight: "100%" }} className="pb-8 max-w-[1200px] mx-auto">

      {/* ── 1. Who I am ── */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-full flex items-center justify-center text-[15px] font-bold flex-shrink-0 text-bank-tx"
            style={SURFACE.raise}>{initials}</div>
          <div className="min-w-0">
            <h1 className="text-lg md:text-xl font-bold text-bank-tx truncate">
              {viewUser?.name}{viewingOther && <span className="text-[13px] font-semibold ml-2" style={{ color: "var(--warn)" }}>· viewing</span>}
            </h1>
            <p className="text-[13px] text-bank-mu capitalize">{viewUser?.role} · {mr.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          {isAdmin && (
            <select value={viewId || ""} onChange={e => setViewId(e.target.value || null)}
              className={`${selectCls} max-w-[160px]`} style={SURFACE.raise}
              title="View another person's card" aria-label="View another person's card">
              <option value="">My card</option>
              {users.filter(SELLER).slice().sort((a, b) => a.name.localeCompare(b.name)).map(u => (
                <option key={u.id} value={u.id}>{u.name}{u.ghost ? " (ghost)" : ""}</option>
              ))}
            </select>
          )}
          <SecondaryButton onClick={shareCard} active={!!shared} title="Copy a shareable card image">
            {shared ? <Check size={14} /> : <Share2 size={14} />}
            {shared === "copied" ? "Copied" : shared === "downloaded" ? "Saved" : "Share"}
          </SecondaryButton>
          <select value={selected} onChange={e => setSelected(Number(e.target.value))}
            className={selectCls} style={SURFACE.raise} aria-label="Month">
            {months.map((m, i) => <option key={i} value={i}>{m.label}</option>)}
          </select>
        </div>
      </div>

      {/* Rank hero */}
      <Card className="mb-3 relative overflow-hidden">
        {isBest && (
          <div className="absolute top-3 right-3 text-[13px] font-bold uppercase tracking-wide px-2 py-1 rounded-full"
            style={{ background: "rgba(210,160,116,0.14)", color: "var(--warn)", border: "1px solid rgba(210,160,116,0.4)" }}>🔥 Personal best</div>
        )}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[13px] uppercase tracking-widest text-bank-fa font-semibold mb-1 flex items-center gap-1.5">
              <Award size={13} className="text-bank-mu" aria-hidden="true" /> Company Rank
            </p>
            {rank.ranked ? (
              <>
                <p className="text-[34px] md:text-[44px] font-extrabold leading-none text-bank-tx tabular-nums">
                  #{rank.rank}<span className="text-[16px] md:text-[20px] font-bold text-bank-fa"> / {rank.total}</span>
                </p>
                <p className="text-[13px] mt-2 text-bank-mu">
                  {rank.ahead
                    ? <><span className="font-bold text-bank-tx">{money(rank.gapAhead)}</span> to pass <span className="font-semibold text-bank-tx">{rank.ahead.name}</span></>
                    : <>🏆 You're #1{rank.behind ? <> — leading {rank.behind.name} by <span className="font-bold text-bank-tx">{money(rank.leadBehind)}</span></> : ""}</>}
                </p>
              </>
            ) : (
              <>
                <p className="text-[22px] md:text-[26px] font-extrabold leading-tight text-bank-tx">Not ranked yet</p>
                <p className="text-[13px] mt-1.5 text-bank-mu">Log a sale this month to hit the board, {firstName}.</p>
              </>
            )}
          </div>
          <Trophy size={54} className="flex-shrink-0 text-bank-line" aria-hidden="true" />
        </div>
      </Card>

      {/* Momentum strip */}
      <div className="grid grid-cols-2 gap-2 md:gap-3 mb-4">
        <div className="rounded-2xl p-3.5 md:p-4 flex items-center gap-3" style={SURFACE.card}>
          <Flame size={20} className="flex-shrink-0" style={{ color: momentum.streak > 0 ? "var(--warn)" : "var(--fa)" }} aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[18px] md:text-[20px] font-bold leading-none text-bank-tx">{momentum.streak} <span className="text-[13px] font-semibold text-bank-mu">{momentum.streak === 1 ? "week" : "weeks"}</span></p>
            <p className="text-[13px] text-bank-mu mt-1">win streak</p>
          </div>
        </div>
        <div className="rounded-2xl p-3.5 md:p-4 flex items-center gap-3" style={SURFACE.card}>
          <Clock size={20} className="text-bank-mu flex-shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[16px] md:text-[18px] font-bold leading-none text-bank-tx truncate">{lastLabel}</p>
            <p className="text-[13px] text-bank-mu mt-1">last sale</p>
          </div>
        </div>
      </div>

      {/* ── 2. My numbers for {mr.label} ── */}
      <Eyebrow className="mb-2">Self-gen</Eyebrow>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-3">
        <StatTile icon={DollarSign}    label="Revenue"    value={money(stats.sgRevenue)} sub="baseline you set · tap" onClick={() => toggleDrill("sgRevenue")} />
        <StatTile icon={Layers}        label="Closes"     value={stats.sgCloses} sub="deals you set · tap" onClick={() => toggleDrill("sgCloses")} />
        <StatTile icon={ClipboardList} label="Estimates"  value={stats.sgEst} sub="self-gen · tap" onClick={() => toggleDrill("sgEst")} />
        <StatTile icon={Percent}       label="Closing %"  value={stats.sgRate == null ? "—" : `${stats.sgRate.toFixed(0)}%`} color={rateColor(stats.sgRate)} onClick={() => toggleDrill("sgCloses")}
          trend={closeDelta == null ? null : (
            <span className="text-[13px] font-semibold" style={{ color: closeDelta >= 0 ? "var(--pos)" : "var(--neg)" }}>
              {closeDelta >= 0 ? "▲" : "▼"} {Math.abs(closeDelta).toFixed(0)} pts vs last mo
            </span>
          )} />
      </div>

      {/* Leads stats — only when the rep has run leads */}
      {stats.hasLeads && (<>
        <Eyebrow className="mb-2">Leads</Eyebrow>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-3">
          <StatTile icon={DollarSign}    label="Lead Rev"   value={money(stats.ldRevenue)} sub="closed for setters · tap" onClick={() => toggleDrill("ldRevenue")} />
          <StatTile icon={Layers}        label="Leads Closed" value={stats.ldCloses} sub="you closed · tap" onClick={() => toggleDrill("ldCloses")} />
          <StatTile icon={ClipboardList} label="Lead Est"   value={stats.ldEst} sub="leads ran · tap" onClick={() => toggleDrill("ldEst")} />
          <StatTile icon={Percent}       label="Closing %"  value={stats.ldRate == null ? "—" : `${stats.ldRate.toFixed(0)}%`} color={rateColor(stats.ldRate)} onClick={() => toggleDrill("ldCloses")} />
        </div>
      </>)}

      {/* Combined earnings — Commission is the one gold number on this page */}
      <div className="grid grid-cols-2 gap-2 md:gap-3 mb-3">
        <StatTile icon={Wallet}     label="Commission" value={money(stats.commission)} sub="your total earnings · tap" color="var(--gold-tx)" onClick={() => toggleDrill("commission")} />
        <StatTile icon={TrendingUp} label="Avg Deal"   value={money(stats.avgDeal)} sub="per self-gen deal · tap" onClick={() => toggleDrill("avgDeal")} />
      </div>

      {/* Stat drill-down — inline, directly under the tiles it explains */}
      {drill && drillData && (
        <Card padded={false} className="mb-3">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-bank-line" style={{ background: "var(--bg)" }}>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-bank-tx truncate">{drillData.title}</p>
              <p className="text-[13px] text-bank-mu">{mr.label} · {drillData.total}</p>
            </div>
            <button onClick={() => setDrill(null)} aria-label="Close"
              className="text-bank-mu hover:text-bank-tx p-2 -m-2 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center flex-shrink-0"><X size={15} /></button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {drillData.rows.length === 0 ? (
              <EmptyBlock className="py-6">Nothing here for {mr.label}.</EmptyBlock>
            ) : drillData.rows.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-bank-line last:border-0">
                <div className="min-w-0">
                  <p className="text-[13px] text-bank-tx truncate">{r.name}</p>
                  {r.sub && <p className="text-[13px] text-bank-mu">{r.sub}</p>}
                </div>
                <span className="text-[13px] font-semibold text-bank-tx whitespace-nowrap tabular-nums">{r.value}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Personal pace — part of this month's numbers */}
      {pace && (
        <Card className="mb-4">
          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
            <Eyebrow className="flex items-center gap-1.5"><Target size={13} className="text-bank-mu" aria-hidden="true" /> Monthly pace</Eyebrow>
            <p className="text-[13px] text-bank-mu">
              <span className="font-bold text-bank-tx tabular-nums">{money(stats.sgRevenue)}</span> of {money(pace.goal)} target
            </p>
          </div>
          <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "var(--raise)" }}>
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${pace.pct}%`, background: pace.pct >= 100 ? "var(--pos)" : "var(--tx)" }} />
          </div>
          <p className="text-[13px] text-bank-mu mt-1.5">
            Target = your trailing 3-month average +10%.{best ? ` · Best month: ${best.label} (${money(best.rev)})` : ""}
          </p>
        </Card>
      )}

      {/* ── 3. Field activity · RepCard — doors + appointments straight off
          RepCard's D2D leaderboard, so they match what the rep sees in RepCard.
          Hidden entirely when RepCard isn't connected (no API token). ── */}
      {repCard.configured !== false && (<>
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
          <Eyebrow>Field activity · RepCard</Eyebrow>
          <div className="inline-flex flex-wrap gap-1 p-1 rounded-xl max-w-full" style={SURFACE.well} role="group" aria-label="Field activity range">
            {[["week", "This week"], ["month", "This month"], ["lastMonth", "Last month"], ["90d", "90 days"], ["custom", "Custom"]].map(([k, lbl]) => (
              <button key={k} onClick={() => setFaPreset(k)} aria-pressed={faPreset === k}
                className={`px-3 py-2 min-h-[44px] md:min-h-0 md:py-1 rounded-lg text-[13px] font-semibold transition-colors ${faPreset === k ? "text-bank-gold-tx" : "text-bank-mu hover:text-bank-tx hover:bg-bank-raise"}`}
                style={faPreset === k ? SURFACE.raise : undefined}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
        {faPreset === "custom" && (
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <input type="date" value={faFrom} max={faTo || undefined} onChange={(e) => setFaFrom(e.target.value)} aria-label="From date"
              className="text-[13px] px-2 py-1.5 min-h-[44px] md:min-h-0 rounded-lg text-bank-tx focus:outline-none" style={SURFACE.raise} />
            <span className="text-[13px] text-bank-fa">to</span>
            <input type="date" value={faTo} min={faFrom || undefined} onChange={(e) => setFaTo(e.target.value)} aria-label="To date"
              className="text-[13px] px-2 py-1.5 min-h-[44px] md:min-h-0 rounded-lg text-bank-tx focus:outline-none" style={SURFACE.raise} />
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 md:gap-3 mb-2">
          <StatTile icon={DoorOpen}      label="Doors"     value={repCard.doors == null ? "—" : repCard.doors.toLocaleString("en-US")} sub={faRange.label} />
          <StatTile icon={CalendarCheck} label="Appts set" value={repCard.appts == null ? "—" : repCard.appts.toLocaleString("en-US")} sub={faRange.label} />
          <StatTile icon={Layers}        label="Closes"    value={repCard.closes == null ? "—" : repCard.closes.toLocaleString("en-US")} sub="your sales" />
        </div>
        <Eyebrow className="mb-2">Averages · {faRange.label}</Eyebrow>
        <div className="rounded-2xl px-4 py-3 mb-4 grid grid-cols-3 gap-3" style={SURFACE.card}>
          <Avg label="Avg doors / day" sub="per day knocked" value={repCard.avgDoorsPerDay == null ? "—" : repCard.avgDoorsPerDay.toFixed(1)} />
          <Avg label="Doors / appt"    sub="to set one"      value={repCard.doorsPerAppt == null ? "—" : repCard.doorsPerAppt.toFixed(1)} />
          <Avg label="Appts / close"   sub="to close one"    value={repCard.apptsPerClose == null ? "—" : repCard.apptsPerClose.toFixed(1)} />
        </div>
      </>)}

      {/* ── 4. Personal bests — all-time, owner-credited, completed periods only ── */}
      {bests && (bests.bestMonth.best || bests.biggestDeal) && (<>
        <Eyebrow className="mb-2">Personal bests</Eyebrow>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-2">
          {[
            { label: "Best Month", v: bests.bestMonth.best ? fmt(bests.bestMonth.best.value) : "—", sub: bests.bestMonth.best?.label },
            { label: "Best Week", v: bests.bestWeek.best ? fmt(bests.bestWeek.best.value) : "—", sub: bests.bestWeek.best?.label },
            { label: "Most Deals / Mo", v: bests.mostDealsMonth.best ? String(bests.mostDealsMonth.best.value) : "—", sub: bests.mostDealsMonth.best?.label },
            { label: "Biggest Deal", v: bests.biggestDeal ? fmt(bests.biggestDeal.value) : "—", sub: bests.biggestDeal?.when },
          ].map(t => (
            <div key={t.label} className="rounded-2xl p-3.5" style={SURFACE.card}>
              <p className="text-[13px] uppercase tracking-wide text-bank-fa font-semibold">{t.label}</p>
              <p className="text-[18px] md:text-[20px] font-bold mt-1 text-bank-tx tabular-nums">{t.v}</p>
              {t.sub && <p className="text-[13px] text-bank-mu mt-0.5">{t.sub}</p>}
            </div>
          ))}
        </div>
        {(() => {
          const bm = bests.bestMonth;
          if (!bm.best || !bm.current || bm.current.value <= 0) return null;
          const gap = bm.best.value - bm.current.value;
          const banner = { background: "rgba(210,160,116,0.10)", border: "1px solid rgba(210,160,116,0.4)", color: "var(--warn)" };
          if (gap <= 0) return (
            <div className="flex items-center gap-2 rounded-2xl px-3.5 py-2.5 mb-4 text-[13px]" style={banner}>
              <Flame size={14} aria-hidden="true" /> <span><b>{fmt(bm.current.value)} this month</b> — a new personal best, and the month isn't over.</span>
            </div>
          );
          if (bm.current.value >= bm.best.value * 0.8) return (
            <div className="flex items-center gap-2 rounded-2xl px-3.5 py-2.5 mb-4 text-[13px]" style={banner}>
              <Flame size={14} aria-hidden="true" /> <span><b>{fmt(bm.current.value)} this month</b> — {fmt(gap)} away from your best month ever.</span>
            </div>
          );
          return null;
        })()}
      </>)}

      {/* ── 5. Competitions ── */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <Eyebrow className="flex items-center gap-1.5"><Trophy size={13} className="text-bank-mu" aria-hidden="true" /> Your competitions</Eyebrow>
          <Link to="/competitions" className="text-[13px] text-bank-gold-tx hover:underline min-h-[44px] md:min-h-0 inline-flex items-center">View all</Link>
        </div>
        {myComps.length === 0 ? (
          <p className="text-[13px] text-bank-mu py-2">You're not in any active competitions right now.</p>
        ) : (
          <div className="space-y-2">
            {myComps.map(({ comp, mine, count, leader, ahead, gap }) => {
              const target = mine.target > 0 ? mine.target : 0;
              const denom = target > 0 ? target : (leader?.score || 0);
              const w = denom > 0 ? Math.min((mine.score / denom) * 100, 100) : 0;
              return (
                <Link key={comp.id} to="/competitions"
                  className="block rounded-xl px-3.5 py-3 min-h-[44px] hover:bg-bank-raise transition-colors"
                  style={SURFACE.well}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-bank-tx truncate">{comp.name}</span>
                    <span className="text-[13px] font-bold whitespace-nowrap" style={{ color: mine.rank === 1 ? "var(--pos)" : "var(--tx)" }}>
                      {mine.earned ? "🎉 Earned" : `#${mine.rank} of ${count}`}
                    </span>
                  </div>
                  <div className="text-[13px] text-bank-mu mt-1">
                    {comp.type === "team_avg" ? "Your team: " : "You: "}<span className="text-bank-tx font-semibold">{fmtScore(mine.score, comp.metric, comp.type === "team_avg")}</span>
                    {target > 0
                      ? <> · target {fmtScore(target, comp.metric, comp.type === "team_avg")}</>
                      : ahead
                        ? <> · <span style={{ color: "var(--warn)" }}>{fmtScore(gap, comp.metric, comp.type === "team_avg")}</span> to pass {ahead.name}</>
                        : <> · 🏆 leading</>}
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden mt-2" style={{ background: "var(--raise)" }}>
                    <div className="h-full rounded-full" style={{ width: `${w}%`, background: mine.earned ? "var(--pos)" : "var(--tx)" }} />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
