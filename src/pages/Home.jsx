import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { format as dfFormat } from "date-fns";
import { Trophy, Award, Target, Flame, Share2, Check, X } from "lucide-react";
import { fetchDeals, fetchCompetitions, fetchUsers, fetchWeeklyStats, fetchLeads, fetchTeamChanges,
  fetchPersonalGoals, upsertPersonalGoal } from "../lib/db";
import { headIdSet, teamKeyFor, buildChangesByProfile, saleOwnerId, teamLabel } from "../utils/team";
import { onClickUnlessSelecting } from "../utils/selection";
import { getUserCommission, countsInTotals, fmt } from "../utils/commission";
import { personalBests } from "../utils/records";
// THE SAME ENGINE THE LEADS BY-REP BOARD USES. My Card is one person's row of
// exactly those numbers, so set / ran / closed / leads can never disagree
// between the two pages (per Keaton's spec: Appts Set, Appts Ran, Run %,
// Closed, Closing %, Revenue — then Leads Ran, Leads Closed, Closing %, Lead
// Revenue).
import { repActivity } from "../utils/repActivity";
import { currentPeriods, resolveGoal, repProduction, periodElapsed, metricProgress } from "../utils/goals";
import { useSettings } from "../contexts/SettingsContext";
import { useAuth } from "../contexts/AuthContext";
import { toast } from "../lib/toast";
import { competitionStandings, competitionStatus, fmtScore } from "../utils/competition";

const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
const SELLER = (u) => ["rep", "manager", "director", "vp"].includes(u.role);
// A rate over 100% measures the gap between two systems (appointments come
// from RepCard, deals from the site), not performance — so it reads blank.
// repActivity already applies that rule; this only formats what it returns.
const pct = (r) => (r == null ? "—" : `${r.toFixed(0)}%`);
// `capitalize` renders the vp role as "Vp". Spell the acronym out.
const ROLE_LABEL = { rep: "Rep", manager: "Manager", director: "Director", vp: "VP", admin: "Admin" };

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

// One figure inside a group card. Clickable ones drill to the deals behind them.
// A COUNT IS NEVER COLOURED BY ITS RATE. `Closed` used to render the count
// itself in rateColor(closeRate), so a rep with a 10% close rate got an
// ORANGE "1" — the number read as an error when it is just a count, and the
// verdict belongs to the rate underneath it (Keaton: "why is the deals #
// orange?"). The rate line carries the colour now; the count stays plain.
function Stat({ value, label, sub, subColor, color = "#ededed", onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick ? onClickUnlessSelecting(onClick) : undefined}
      className={`flex-1 min-w-0 text-left ${onClick ? "cursor-pointer" : ""}`}>
      <p className="text-[18px] md:text-[20px] font-bold leading-none truncate" style={{ color }}>{value}</p>
      <p className="text-[10px] text-white/45 mt-1 truncate">{label}</p>
      {sub && <p className="text-[10px] truncate" style={{ color: subColor || "rgba(255,255,255,0.3)" }}>{sub}</p>}
    </Tag>
  );
}

// THE SEAM. Left of it the figures are APPOINTMENTS from RepCard; right of it
// they are SIGNED DEALS from the site. Two systems in one row with nothing
// marking the join is what let "10 Ran" be read as ten sales (Keaton did it
// on his own card within minutes of the page going live). Same hairline the
// Leads by-rep board already uses, so the two pages show the split alike.
const Seam = () => <div className="w-px self-stretch my-0.5 mx-1 md:mx-2 flex-shrink-0" style={{ background: "#ffffff1f" }} />;

function GroupCard({ title, tone, children }) {
  return (
    <div className="rounded-xl p-3.5 md:p-4 mb-3" style={{ background: "#1e1e1e", border: "1px solid #2a2a2a" }}>
      <p className="text-[10px] uppercase tracking-widest font-bold mb-3" style={{ color: tone }}>{title}</p>
      {children}
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
  const [shared, setShared] = useState("");
  const [viewId, setViewId] = useState(null);   // admins can view another rep's card

  const mr = months[selected];
  const me = viewId || profile?.id;
  const { dataStartDate, estimatesFrom } = useSettings();
  const [leads, setLeads] = useState([]);
  const todayISO = dfFormat(new Date(), "yyyy-MM-dd");

  // Personal bests (owner-credited, completed periods) — the all-time marks.
  const bests = useMemo(() => {
    if (!me || !allDeals.length) return null;
    return personalBests(allDeals, me, { dataStartDate, todayISO });
  }, [allDeals, me, dataStartDate, todayISO]);
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

  // DOOR KNOCKS ARE NOT SHOWN HERE (per Keaton: "we can drop them for now").
  // My Card was the last surface rendering them, and it read them from a THIRD
  // source — RepCard's own /api/repcard/leaderboard, matched to reps BY NAME —
  // while the Dashboard shows none and the rest of the site reads
  // `field_activity`. The ingest, the table and the rollup trigger are all
  // untouched, so nothing is lost and bringing doors back is re-adding a fetch.
  // Do NOT reintroduce the name-matched leaderboard call: it was a third path
  // to the same fact and could disagree with both of the others.

  // Personal goals — the REAL commitments from `personal_goals`, the same rows
  // the Goals page writes, so the targets on this card are the targets the rep
  // set. This REPLACES Home's old auto-target ("trailing 3-month average
  // +10%"), which was a second, invisible definition of a goal that the Goals
  // page knew nothing about.
  const [goalRows, setGoalRows] = useState([]);
  const reloadGoals = () => fetchPersonalGoals().then(({ data }) => setGoalRows(data || []));
  useEffect(() => { reloadGoals(); }, []);

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

  // ONE ROW of the by-rep board, for the viewed rep and the viewed month.
  // set/ran come from the APPOINTMENT feed, closed/revenue from SIGNED DEALS —
  // the same two-source split, and the same >100% blank rule, as that board.
  // `Appts set` and `Run %` did not exist on this page before: it only had
  // self-gen ESTIMATES (set AND ran by the same person), never the set → ran
  // funnel.
  const actFor = (key) => {
    const { rows } = repActivity(leads, allDeals, {
      users, from: `${key}-01`, to: `${key}-31`, onlyIds: me ? [me] : [],
    });
    return rows.find((r) => r.id === me) || null;
  };
  const EMPTY_ACT = { set: 0, ran: 0, closed: 0, leadsRan: 0, leadsClosed: 0, revenue: 0, leadRevenue: 0,
    ranRate: null, closeRate: null, leadsCloseRate: null };
  const act = useMemo(() => actFor(mr.key) || EMPTY_ACT, [leads, allDeals, users, mr.key, me]);
  // REVENUE SOLD = everything they sold, owner-credited revenue plus the
  // baseline of the leads they closed for someone else. A PER-PERSON figure:
  // never sum it across people, since a deal whose setter and closer are both
  // on the team would count twice (same rule as the Dashboard leaderboard's
  // Total Revenue column).
  const sold = act.revenue + act.leadRevenue;
  const prevSold = useMemo(() => {
    const pm = months[selected + 1];
    if (!pm) return null;
    const a = actFor(pm.key);
    return a ? a.revenue + a.leadRevenue : 0;
  }, [leads, allDeals, users, months, selected, me]);

  const commission = useMemo(() => getUserCommission(monthDeals, me), [monthDeals, me]);

  // Owner-credited revenue for a month — the SAME credit rule as `act.revenue`
  // and the Dashboard leaderboard. It used to be `setter_id === me`, which
  // silently disagreed with both whenever a deal had no setter recorded.
  const ownerRevForMonth = (key) => allDeals
    .filter(d => d.sale_date?.startsWith(key) && saleOwnerId(d) === me)
    .reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0);

  // TWO RANKS, EACH NAMING ITS OWN UNIT (per Keaton: "can we have a rank for
  // self-gen rev + total rev?"). One rank under a "Revenue sold" headline was
  // ambiguous: ranked on owner revenue, the "$X to pass <name>" line sat
  // directly beneath a figure that meant something else — two definitions in
  // one box, the fault this whole rework exists to remove. Naming both is the
  // fix: each row carries its own rank AND its own gap, in its own unit.
  //   • Revenue sold = owner-credited revenue + the baseline of deals they
  //     CLOSED for another setter (the hero figure, and the Dashboard
  //     leaderboard's `Total Revenue`).
  //   • Self-gen    = owner-credited revenue alone (the site's one definition
  //     of "revenue" everywhere else, and that leaderboard's `Revenue`).
  // A deal counts ONCE per person on either board, so neither double-counts a
  // self-gen; `Revenue sold` is a PER-PERSON figure and is never summed here.
  const ranks = useMemo(() => {
    const own = {}, lead = {};
    for (const d of monthDeals) {
      const v = parseFloat(d.baseline_revenue) || 0;
      const owner = saleOwnerId(d);
      if (owner) own[owner] = (own[owner] || 0) + v;
      if (d.closer_id && d.closer_id !== owner) lead[d.closer_id] = (lead[d.closer_id] || 0) + v;
    }
    const board = (value) => {
      const rows = users
        .filter(u => SELLER(u) && (isAdmin || !u.ghost))
        .map(u => ({ id: u.id, name: u.name, revenue: value(u.id) }))
        .filter(r => r.revenue > 0)
        .sort((a, b) => b.revenue - a.revenue);
      const idx = rows.findIndex(r => r.id === me);
      if (idx === -1) return { ranked: false, total: rows.length };
      const ahead = idx > 0 ? rows[idx - 1] : null;
      const behind = rows[idx + 1] || null;
      return {
        ranked: true, rank: idx + 1, total: rows.length, myRev: rows[idx].revenue,
        ahead, gapAhead: ahead ? ahead.revenue - rows[idx].revenue : 0,
        behind, leadBehind: behind ? rows[idx].revenue - behind.revenue : 0,
      };
    };
    return {
      sold:    board(id => (own[id] || 0) + (lead[id] || 0)),
      selfgen: board(id => own[id] || 0),
    };
  }, [monthDeals, users, me, isAdmin]);
  // The share image prints one rank; it is the one the headline describes.
  const rank = ranks.sold;

  // Personal best month across the last 12, on the same owner-credited rule.
  const best = useMemo(() => {
    let bk = null, bl = null, br = 0;
    for (const m of months) { const r = ownerRevForMonth(m.key); if (r > br) { br = r; bk = m.key; bl = m.label; } }
    return br > 0 ? { key: bk, label: bl, rev: br } : null;
  }, [allDeals, me, months]);
  const isBest = best && best.key === mr.key && act.revenue > 0;

  // ── Goals ────────────────────────────────────────────────────────────────
  // The rep's own commitments, resolved for the CURRENT week and month (a
  // period with no row of its own inherits the latest earlier one — the
  // "carried" rule the Goals page already uses). Editing a target here writes
  // the same `personal_goals` row that page writes.
  //
  // THESE ALWAYS TRACK THE CURRENT PERIOD, not the month picker above —
  // a goal is a live commitment, and measuring August's production against
  // this month's target would be two periods in one card. The row labels say
  // which period they mean, and a note appears when you're looking at an
  // older month.
  const periods = useMemo(() => currentPeriods(todayISO), [todayISO]);
  const myGoals = useMemo(() => ({
    week:  resolveGoal(goalRows, me, "week",  periods.week.start),
    month: resolveGoal(goalRows, me, "month", periods.month.start),
  }), [goalRows, me, periods]);
  const prod = useMemo(() => ({
    week:  repProduction(allDeals, weekly, me, periods.week,  { leads, estimatesFrom }),
    month: repProduction(allDeals, weekly, me, periods.month, { leads, estimatesFrom }),
  }), [allDeals, weekly, me, periods, leads, estimatesFrom]);

  const goalLines = useMemo(() => {
    const line = (period, field, label, target, value, format) => ({
      key: `${period}:${field}`, period, field, label, target, value, format,
      prog: metricProgress(value, target, periodElapsed(periods[period], todayISO)),
    });
    return [
      line("month", "revenue", "Revenue this month", myGoals.month?.revenue_target, prod.month.revenue, money),
      line("month", "deals",   "Deals this month",   myGoals.month?.deals_target,   prod.month.deals,   String),
      line("week",  "est",     "Estimates this week", myGoals.week?.est_target,     prod.week.sgEst,    String),
    ];
  }, [myGoals, prod, periods, todayISO]);

  // Admins set anyone's goals; a rep sets their own (the Goals-page rule).
  const canEditGoals = !viewingOther || isAdmin;
  const [editGoal, setEditGoal] = useState(null);   // "month:revenue"
  const [editVal, setEditVal] = useState("");
  const [savingGoal, setSavingGoal] = useState(null);
  // Escape unmounts the input, which can fire its own blur — without this the
  // cancel would save the very value it was cancelling.
  const goalCancelled = useRef(false);

  // Saving one target keeps the other two on that row — upsert writes the whole
  // row, so sending only the edited field would blank the rest.
  async function saveTarget(period, field, value) {
    const raw = String(value).replace(/[$,\s]/g, "");
    const n = raw === "" ? null : Number(raw);
    if (n != null && !Number.isFinite(n)) { toast.error("That target isn't a number."); return; }
    const base = myGoals[period] || {};
    setSavingGoal(`${period}:${field}`);
    const res = await upsertPersonalGoal({
      rep_id: me,
      period,
      period_start: periods[period].start,
      est_target:     field === "est"     ? n : (base.est_target     ?? null),
      deals_target:   field === "deals"   ? n : (base.deals_target   ?? null),
      revenue_target: field === "revenue" ? n : (base.revenue_target ?? null),
    }, profile?.id);
    setSavingGoal(null);
    setEditGoal(null);
    if (res?.error) { toast.error("Could not save that target: " + (res.error.message || "unknown error")); return; }
    reloadGoals();
  }

  // Active competitions the rep is entered in.
  const myComps = useMemo(() => {
    const hiddenIds = isAdmin ? null : ghostIds;
    // Team Average rows match by the viewer's RESOLVED team key (same grouping
    // the engine scores by); a rep left out of the contest isn't in it.
    const myTeamKey = viewUser ? teamKeyFor(viewUser, teamCtx.heads) : null;
    return comps
      .filter(c => competitionStatus(c, todayISO) === "active")
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
  }, [comps, allDeals, users, me, viewUser, isAdmin, ghostIds, teamCtx, todayISO]);

  // Tap-to-view breakdown for a stat.
  const [drill, setDrill] = useState(null);
  const toggleDrill = (k) => setDrill(d => d === k ? null : k);
  const drillData = useMemo(() => {
    if (!drill) return null;
    const fmtD = (d) => d ? dfFormat(new Date(d + "T12:00:00"), "MMM d") : "—";
    const byDate = (arr) => arr.slice().sort((a, b) => (b.sale_date || "").localeCompare(a.sale_date || ""));
    // OWNER-credited, the same rule `act` counts by — listing `setter_id === me`
    // here would make the drill-down disagree with the figure it explains.
    const ownDeals  = byDate(monthDeals.filter(d => saleOwnerId(d) === me));
    const leadDeals = byDate(monthDeals.filter(d => d.closer_id === me && saleOwnerId(d) !== me));
    const dealRows = (arr) => arr.map(d => ({ id: d.id, name: d.deal_name, sub: `${fmtD(d.sale_date)} · ${d.status}`, value: money(parseFloat(d.baseline_revenue) || 0) }));

    if (drill === "self")
      return { title: "Self gens — the deals you own", total: `${act.closed} deals · ${money(act.revenue)}`, rows: dealRows(ownDeals) };
    if (drill === "leads")
      return { title: "Leads — deals you closed for another setter", total: `${act.leadsClosed} deals · ${money(act.leadRevenue)}`, rows: dealRows(leadDeals) };
    if (drill === "commission") {
      const rows = monthDeals.map(d => ({ d, amt: getUserCommission([d], me) })).filter(x => x.amt > 0)
        .sort((a, b) => b.amt - a.amt)
        .map(({ d, amt }) => {
          const roles = [];
          if (saleOwnerId(d) === me) roles.push("Self-gen");
          if (d.closer_id === me && d.closer_id !== d.setter_id) roles.push("Closer");
          if (d.manager_id === me || d.director_id === me || d.vp_id === me) roles.push("Override");
          return { id: d.id, name: d.deal_name, sub: `${fmtD(d.sale_date)} · ${[...new Set(roles)].join(", ") || "—"}`, value: money(amt) };
        });
      return { title: "Commission — your earnings", total: `${money(commission)} total`, rows };
    }
    return null;
  }, [drill, monthDeals, me, act, commission]);

  const firstName = (viewUser?.name || "").split(" ")[0] || "there";
  const initials = (viewUser?.name || "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const myTeam = useMemo(() => {
    const headId = viewUser ? teamKeyFor(viewUser, teamCtx.heads) : null;
    const head = headId ? users.find(u => u.id === headId) : null;
    return head ? teamLabel(head) : null;
  }, [viewUser, users, teamCtx]);

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

    // stat cards — the same six figures the card shows on screen
    const hasLeads = act.leadsRan > 0 || act.leadsClosed > 0;
    const tiles = [
      ["REVENUE SOLD", money(sold), "#2dd4bf"],
      ["COMMISSION", money(commission), "#34d399"],
      ["APPTS SET", String(act.set), "#74b9ff"],
      ["RUN %", pct(act.ranRate), rateColor(act.ranRate)],
      ["CLOSED", String(act.closed), "#fff"],
      [hasLeads ? "LEADS CLOSED" : "CLOSING %", hasLeads ? String(act.leadsClosed) : pct(act.closeRate), "#fbbf24"],
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

  const soldDelta = prevSold == null ? null : sold - prevSold;
  // THE LEADS GROUP IS GONE ENTIRELY when the rep has run none (per Keaton:
  // "so it doesn't take up space") — not a row of dashes.
  const hasLeads = act.leadsRan > 0 || act.leadsClosed > 0;

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
            <p className="text-[12px] text-white/40 truncate">{myTeam || ROLE_LABEL[viewUser?.role] || viewUser?.role}</p>
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
          <select value={selected} onChange={e => setSelected(Number(e.target.value))}
            className="text-[12px] px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white"
            title="Which month this card shows">
            {months.map((m, i) => <option key={i} value={i} style={{ background: "#2a2a2a" }}>{m.label}</option>)}
          </select>
        </div>
      </div>

      {/* Hero — what they sold, where they rank, what they earned */}
      <div className="rounded-2xl p-4 md:p-5 mb-3 overflow-hidden"
        style={{ background: "linear-gradient(135deg,#0e3b35,#143d52)", border: "1px solid #1c5a50" }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-white/45 font-bold flex items-center gap-2 flex-wrap">
              Revenue sold
              {isBest && (
                <span className="text-[9.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap"
                  style={{ background: "#fb923c22", color: "#fdba74", border: "1px solid #fb923c55" }}>🔥 Personal best</span>
              )}
            </p>
            <p className="text-[30px] md:text-[40px] font-extrabold leading-none text-white mt-1">{money(sold)}</p>
            {soldDelta != null && soldDelta !== 0 && (
              <p className="text-[12px] font-semibold mt-1.5" style={{ color: soldDelta > 0 ? "#6ee7c8" : "#f87171" }}>
                {soldDelta > 0 ? "▲" : "▼"} {money(Math.abs(soldDelta))} on last month
              </p>
            )}
          </div>
          <button onClick={onClickUnlessSelecting(() => toggleDrill("commission"))}
            className="flex-shrink-0 text-right" title="Tap for the deals behind it">
            <p className="text-[10px] uppercase tracking-widest text-white/45 font-bold">Your commission</p>
            <p className="text-[24px] md:text-[30px] font-extrabold leading-none mt-1" style={{ color: "#6ee7c8" }}>{money(commission)}</p>
          </button>
        </div>

        {/* Two ranks. Each row names the figure it ranks on and carries its own
            gap in that same unit — the headline's gap can never be read as the
            other board's. */}
        <div className="mt-3.5 pt-3 border-t" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
          <p className="text-[10px] uppercase tracking-widest text-white/45 font-bold flex items-center gap-1.5 mb-1.5">
            <Award size={12} className="text-amber-300" /> Company rank
          </p>
          {!ranks.sold.ranked && !ranks.selfgen.ranked ? (
            <p className="text-[12px] text-white/70">Log a sale this month to hit the board, {firstName}.</p>
          ) : [
            { key: "sold", label: "Revenue sold", r: ranks.sold },
            { key: "selfgen", label: "Self-gen", r: ranks.selfgen },
          ].map(({ key, label, r }) => (
            <div key={key} className="flex items-baseline gap-2 flex-wrap py-0.5">
              <span className="text-[19px] md:text-[22px] font-extrabold leading-none text-white flex-shrink-0">
                {r.ranked ? <>#{r.rank}<span className="text-[12px] md:text-[13px] font-bold text-white/40"> / {r.total}</span></> : <span className="text-[13px] font-bold text-white/40">—</span>}
              </span>
              <span className="text-[11.5px] text-white/50 flex-shrink-0">{label}</span>
              <span className="text-[11.5px] text-white/70 min-w-0">
                {!r.ranked
                  ? "not on this board yet"
                  : r.ahead
                    ? <><span className="font-bold text-amber-300">{money(r.gapAhead)}</span> to pass {r.ahead.name}</>
                    : <>🏆 #1{r.behind ? <> by <span className="font-bold text-amber-300">{money(r.leadBehind)}</span></> : ""}</>}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Self gens — the appointments they booked and what became of them */}
      <GroupCard title="Self Gens" tone="#00b894">
        <div className="flex items-stretch gap-2 md:gap-3">
          <Stat value={act.set} label="Appts set" />
          {/* "Appts ran" = of the ones they BOOKED, how many have happened —
              including any another rep sat. Bare "Ran" never said either. */}
          <Stat value={act.ran} label="Appts ran" sub={pct(act.ranRate)} subColor={rateColor(act.ranRate)} />
          <Seam />
          <Stat value={act.closed} label="Deals closed" sub={pct(act.closeRate)} subColor={rateColor(act.closeRate)}
            onClick={() => toggleDrill("self")} />
          <Stat value={money(act.revenue)} label="Revenue" color="#00b894" onClick={() => toggleDrill("self")} />
        </div>
      </GroupCard>

      {/* Leads — only when they actually ran one */}
      {hasLeads && (
        <GroupCard title="Leads" tone="#c084fc">
          <div className="flex items-stretch gap-2 md:gap-3">
            <Stat value={act.leadsRan} label="Appts ran" />
            <Seam />
            <Stat value={act.leadsClosed} label="Deals closed" sub={pct(act.leadsCloseRate)} subColor={rateColor(act.leadsCloseRate)}
              onClick={() => toggleDrill("leads")} />
            <Stat value={money(act.leadRevenue)} label="Revenue" color="#00b894" onClick={() => toggleDrill("leads")} />
            <div className="flex-1" />
          </div>
        </GroupCard>
      )}

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

      {/* Goals — targets edited in place, no modal, no Change button */}
      <div className="rounded-xl p-3.5 md:p-4 mb-3" style={{ background: "#1e1e1e", border: "1px solid #2a2a2a" }}>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <p className="text-[10px] uppercase tracking-widest text-white/35 font-bold flex items-center gap-1.5">
            <Target size={12} className="text-teal" /> Your goals
          </p>
          {canEditGoals
            ? <span className="text-[10.5px] text-white/25">tap a target to change it</span>
            : <Link to="/goals" className="text-[11px] text-teal hover:underline">Goals →</Link>}
        </div>

        {goalLines.map(g => {
          const editing = editGoal === g.key;
          const tone = !g.prog ? "#4b5563"
            : g.prog.status === "done" ? "#4ade80"
            : g.prog.status === "ahead" ? "#00b894" : "#f59e0b";
          return (
            <div key={g.key} className="mb-3 last:mb-0">
              <div className="flex items-baseline justify-between gap-2 text-[11.5px] mb-1.5">
                <span className="text-white/70 min-w-0 truncate">{g.label}</span>
                <span className="flex-shrink-0 text-white/45">
                  {g.format(g.value)} of{" "}
                  {editing ? (
                    <input autoFocus type="text" inputMode="numeric" value={editVal}
                      onChange={e => setEditVal(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") saveTarget(g.period, g.field, editVal);
                        if (e.key === "Escape") { goalCancelled.current = true; setEditGoal(null); }
                      }}
                      onBlur={() => {
                        if (goalCancelled.current) { goalCancelled.current = false; return; }
                        saveTarget(g.period, g.field, editVal);
                      }}
                      aria-label={`${g.label} target`}
                      className="w-20 px-1.5 py-0.5 rounded text-[11.5px] font-semibold text-white"
                      style={{ background: "#141414", border: "1px solid #00b894" }} />
                  ) : canEditGoals ? (
                    <button
                      onClick={() => { setEditGoal(g.key); setEditVal(g.target == null ? "" : String(g.target)); }}
                      className="font-semibold text-white"
                      style={{ borderBottom: "1px dashed rgba(255,255,255,0.3)" }}
                      title="Tap to change this target">
                      {g.target == null ? "set one" : g.format(g.target)}
                    </button>
                  ) : (
                    <span className="font-semibold text-white">{g.target == null ? "—" : g.format(g.target)}</span>
                  )}
                  {savingGoal === g.key && <span className="text-white/30 ml-1">…</span>}
                </span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#2a2a2a" }}>
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${g.prog ? g.prog.frac * 100 : 0}%`, background: tone }} />
              </div>
            </div>
          );
        })}

        {selected !== 0 && (
          <p className="text-[10px] text-white/25 mt-3">
            Goals always track the current week and month — not {mr.label}.
          </p>
        )}
      </div>

      {/* Active competitions */}
      <div className="rounded-xl p-3.5 md:p-4 mb-3" style={{ background: "#1e1e1e", border: "1px solid #2a2a2a" }}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] uppercase tracking-widest text-white/35 font-bold flex items-center gap-1.5">
            <Trophy size={13} className="text-amber-300" /> Contests you're in
          </p>
          <Link to="/competitions" className="text-[11px] text-teal hover:underline">View all</Link>
        </div>
        {myComps.length === 0 ? (
          <p className="text-[12px] text-white/30 py-1">You're not in any active competitions right now.</p>
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
                    {comp.type === "team_avg" ? "Your team: " : "You: "}<span className="text-white/70 font-semibold">{fmtScore(mine.score, comp.metric, comp.type === "team_avg")}</span>
                    {target > 0
                      ? <> · target {fmtScore(target, comp.metric, comp.type === "team_avg")}</>
                      : ahead
                        ? <> · <span className="text-amber-300">{fmtScore(gap, comp.metric, comp.type === "team_avg")}</span> to pass {ahead.name}</>
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

      {/* Best ever — all-time, owner-credited, completed periods only */}
      {bests && (bests.bestMonth.best || bests.biggestDeal) && (
        <div className="rounded-xl p-3.5 md:p-4 mb-3" style={{ background: "#1e1e1e", border: "1px solid #2a2a2a" }}>
          <p className="text-[10px] uppercase tracking-widest text-white/35 font-bold mb-3">Your best ever</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Best month", v: bests.bestMonth.best ? fmt(bests.bestMonth.best.value) : "—", sub: bests.bestMonth.best?.label },
              { label: "Best week", v: bests.bestWeek.best ? fmt(bests.bestWeek.best.value) : "—", sub: bests.bestWeek.best?.label },
              { label: "Most deals / mo", v: bests.mostDealsMonth.best ? String(bests.mostDealsMonth.best.value) : "—", sub: bests.mostDealsMonth.best?.label },
              { label: "Biggest deal", v: bests.biggestDeal ? fmt(bests.biggestDeal.value) : "—", sub: bests.biggestDeal?.when },
            ].map(t => (
              <div key={t.label} className="min-w-0">
                <p className="text-[15px] md:text-[17px] font-bold truncate" style={{ color: "#fbbf24" }}>{t.v}</p>
                <p className="text-[10px] text-white/45 truncate">{t.label}{t.sub ? ` · ${t.sub}` : ""}</p>
              </div>
            ))}
          </div>
          {(() => {
            const bm = bests.bestMonth;
            if (!bm.best || !bm.current || bm.current.value <= 0) return null;
            const gap = bm.best.value - bm.current.value;
            if (gap <= 0) return (
              <p className="flex items-center gap-2 text-[11.5px] mt-3" style={{ color: "#6ee7c8" }}>
                <Flame size={13} /> <span><b>{fmt(bm.current.value)} this month</b> — a new personal best, and the month isn't over.</span>
              </p>
            );
            if (bm.current.value >= bm.best.value * 0.8) return (
              <p className="flex items-center gap-2 text-[11.5px] mt-3" style={{ color: "#6ee7c8" }}>
                <Flame size={13} /> <span><b>{fmt(bm.current.value)} this month</b> — {fmt(gap)} from your best month ever.</span>
              </p>
            );
            return null;
          })()}
        </div>
      )}

      <button onClick={shareCard}
        className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-[12.5px] font-semibold transition-colors"
        style={{ background: shared ? "#00b89420" : "#1e1e1e", border: `1px solid ${shared ? "#00b89455" : "#2a2a2a"}`, color: shared ? "#00b894" : "rgba(255,255,255,0.55)" }}
        title="Copy a shareable card image">
        {shared ? <Check size={14} /> : <Share2 size={14} />}
        {shared === "copied" ? "Copied to clipboard" : shared === "downloaded" ? "Saved" : "Share my card"}
      </button>
    </div>
  );
}
