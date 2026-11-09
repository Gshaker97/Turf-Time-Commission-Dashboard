// ============================================================
// splitDeal.js — turn a change alert into a SECOND deal.
//
// Per Keaton: "occasionally… this updated deal isnt actually a change order,
// its a secondary project sold for this job. The rep did it under the same
// project ID so the system thinks its a change order." Reps are supposed to
// raise a fresh ArcSite project for a second job; when they don't, the sheet
// row's figures change and the sync raises a change alert (031) that looks
// exactly like a re-sign.
//
// Apply and Dismiss are both wrong for that case — Apply overwrites the first
// job's money with the second job's, and Dismiss throws the second sale away.
// This is the third answer: keep the original exactly as it is and create the
// second job beside it.
//
// WHY A DERIVED PROJECT ID (Keaton's choice): migration 033 puts a UNIQUE
// index on `project_id`, so the two deals physically cannot share one. The
// ORIGINAL keeps the real ArcSite id and stays under the sync's control; the
// new deal takes `<id>-2`, which no sheet row can ever match, so the sync
// ignores it completely and it is managed by hand. That is the honest
// outcome: because one project id covers two jobs, the Schedule tab can only
// ever feed install/pay dates to one of them. The alternative — leaving the
// new deal with no project id — risks the sync's name fallback adopting it
// later for an unrelated job.
//
// Pure: no React, no db. The page does the two writes.
// ============================================================

// 'yyyy-MM-dd' in the viewer's LOCAL timezone — never `.slice(0, 10)` on a
// timestamptz, which lands on tomorrow for anything after 5pm Arizona.
const localDay = (ts) => {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// "Mike Siudzinski" → "Mike Siudzinski 2", and again → "… 3". Follows the
// convention already in the data (`Todd Vietzen 2`) and the one schDiagnose
// tells you to use. `taken` keeps a third split from colliding with a second.
export function nextSplitName(name, taken = new Set()) {
  const base = String(name || 'Deal').trim()
  // Strip a trailing counter so splitting "X 2" gives "X 3", not "X 2 2".
  // ONE DIGIT ONLY, and never a 0 or 1: a deal name's last token is often a
  // house number ("Smith 1420"), and treating that as a counter produced
  // "Smith 1421" — a name that reads as a different address. House numbers in
  // this data are 2-4 digits (and usually lead the street: "9 Birchwood Ct"),
  // so one digit is safe to read as a counter, which "Todd Vietzen 2" needs.
  const m = /^(.*?)\s+([2-9])$/.exec(base)
  const stem = m ? m[1] : base
  const from = m ? Number(m[2]) + 1 : 2
  const lower = new Set([...taken].map((t) => String(t).trim().toLowerCase()))
  for (let n = from; n < from + 50; n++) {
    const candidate = `${stem} ${n}`
    if (!lower.has(candidate.toLowerCase())) return candidate
  }
  return `${stem} ${Date.now()}`
}

// "282300044660754" → "282300044660754-2". Non-numeric by construction, so it
// can never collide with a real ArcSite id, and it records which project the
// deal was split out of.
export function nextSplitProjectId(projectId, taken = new Set()) {
  const base = String(projectId || '').trim()
  if (!base) return null
  // A SINGLE digit only, and never 0 or 1 — the same trap as the name counter,
  // and worse here. Real ids already contain dashes and numbers ("TT-1003"),
  // so reading `-1003` as a counter produced "TT-1004" — a DIFFERENT job's id,
  // which is exactly the collision the derived id exists to avoid. The `taken`
  // set is no defence: it only knows the deals currently loaded on the page.
  const m = /^(.*?)-([2-9])$/.exec(base)
  const stem = m ? m[1] : base
  const from = m ? Number(m[2]) + 1 : 2
  for (let n = from; n < from + 50; n++) {
    const candidate = `${stem}-${n}`
    if (!taken.has(candidate)) return candidate
  }
  return `${stem}-${Date.now()}`
}

// Fields the new deal must NOT inherit: they describe the FIRST job's money,
// its payout, or a sign-off that was never given for this one.
const NOT_INHERITED = {
  install_date: null, pay_date: null,
  commission_verified: false, change_alert: null,
  setter_amount: null, closer_amount: null,
  manager_amount: null, director_amount: null, vp_amount: null,
  deduction_amount: null, deduction_note: null,
  deduction_paid_by: null, deduction_split_pct: null,
  financed_amount: null, dealer_fee_pct: null,
  bonus_company: null, bonus_manager: null, bonus_director: null, bonus_vp: null,
  bonus_recipient: null, bonus_split_pct: null,
  override_exclusions: null, notes: null,
  comp_excluded: false, comp_excluded_at: null, comp_excluded_by: null, comp_excluded_note: null,
  hidden: false, hidden_at: null, hidden_by: null, hidden_note: null,
}

// What the split would do. Returns null when there is no alert to split.
//   { newDeal, originalPatch, summary }
// `summary` is what the confirm dialog prints, so the dialog and the write can
// never describe different things.
export function planSplit(deal, { names = [], projectIds = [], todayISO = null } = {}) {
  const ca = deal?.change_alert
  if (!ca) return null

  const num = (v) => (v == null || v === '' ? null : Number(v))
  const baseline = num(ca.baseline)
  const jobPrice = num(ca.job_price)

  // The sheet's approved date for the NEW agreement when the sync recorded it
  // (added alongside this feature), else the day the sync spotted the change,
  // else today. Sale date drives the rate era, team attribution and the pay
  // run, so it is worth getting from the sheet rather than defaulting to now.
  const saleDate = ca.sale_date || localDay(ca.at) || todayISO || localDay(Date.now())

  const newDeal = {
    deal_name: nextSplitName(deal.deal_name, new Set(names)),
    project_id: nextSplitProjectId(deal.project_id, new Set(projectIds)),
    sale_date: saleDate,
    baseline_revenue: baseline,
    job_price: jobPrice,
    status: 'Deal Review',
    // The people and the terms carry over — it is the same crew on the same
    // site; only the money and the dates are the second job's.
    setter_id: deal.setter_id ?? null,
    closer_id: deal.closer_id ?? null,
    setter_split_pct: deal.setter_split_pct ?? null,
    manager_id: deal.manager_id ?? null,
    director_id: deal.director_id ?? null,
    vp_id: deal.vp_id ?? null,
    manager_override_pct: deal.manager_override_pct ?? null,
    director_override_pct: deal.director_override_pct ?? null,
    vp_override_pct: deal.vp_override_pct ?? null,
    office: deal.office ?? null,
    payment_method: deal.payment_method ?? null,
    // Nothing on the sheet points at this deal, but stamping the snapshot
    // keeps it consistent with every other row.
    synced_baseline: baseline,
    synced_job_price: jobPrice,
    ...NOT_INHERITED,
  }

  // The original keeps ITS money, its status and its gold check — none of its
  // numbers changed, so a sign-off on them is still valid (unlike Apply,
  // which has to clear it). Advancing the snapshot is what stops the same
  // alert firing again on the next run. Both columns are allowed through a
  // LOCKED pay run by migration 039, so this needs no override.
  const originalPatch = {
    change_alert: null,
    synced_baseline: baseline,
    synced_job_price: jobPrice,
  }

  return {
    newDeal,
    originalPatch,
    summary: {
      name: newDeal.deal_name,
      projectId: newDeal.project_id,
      saleDate,
      baseline,
      jobPrice,
      keptName: deal.deal_name,
      keptBaseline: num(deal.baseline_revenue),
      keptJobPrice: num(deal.job_price),
    },
  }
}
