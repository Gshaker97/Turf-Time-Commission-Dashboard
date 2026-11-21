// The job value a project is worth, from its SIGNED ArcSite proposals
// (per Garrison, Nov 19 2026: "add-ons should be summed into the job value").
//
// ArcSite has no notion of "revision" vs "add-on": every signing is just
// another proposal on the project. Until now the NEWEST signed total was taken
// as the whole job, which turned an $800 prep add-on (Ronald Cortez) or a
// $1,809 extra (Israel Castro) into the job's entire value. The rule here:
//
//   1. Proposals drawn on the SAME drawing are revisions of one document —
//      the newest signing wins, the older ones are superseded.
//   2. Across drawings, the newest signing of the LARGEST one anchors the job.
//      Another drawing whose total is at least `addonMaxShare` of the anchor
//      (default half) is a redraw of the same job — again the newest signing
//      wins (Teena Prentice: $8,426 redrawn at $7,891). One that is smaller
//      than that share is an ADD-ON and is summed in.
//
// Pure: no I/O. `signed` is oldest → newest (arcSignedContracts order); the
// proposal_id order is the only time signal ArcSite exposes.
const r2 = n => Math.round(Number(n) * 100) / 100

export function arcJobValue(signed, { addonMaxShare = 0.5 } = {}) {
  const list = (signed || []).filter(s => s && Number.isFinite(Number(s.total)))
  const empty = { total: null, main: null, addons: [], superseded: [], counted: [] }
  if (!list.length) return empty
  // 1. newest signing per drawing (a proposal without a drawing id is its own group)
  const groups = new Map()
  list.forEach((s, i) => { const k = s.drawing_id ? `d:${s.drawing_id}` : `p:${s.proposal_id || i}`; groups.set(k, { newest: s, order: i, older: [...((groups.get(k) || {}).older || []), ...(groups.has(k) ? [groups.get(k).newest] : [])] }) })
  const heads = [...groups.values()]
  // 2. the largest head anchors the job; big heads are redraws (newest wins), small heads are add-ons
  const anchor = heads.reduce((a, b) => (Number(b.newest.total) > Number(a.newest.total) ? b : a))
  const share = Math.max(0, Math.min(1, Number(addonMaxShare) || 0))
  const redraws = heads.filter(h => Number(h.newest.total) >= share * Number(anchor.newest.total))
  const mainHead = redraws.reduce((a, b) => (b.order > a.order ? b : a))
  const addons = heads.filter(h => !redraws.includes(h)).map(h => h.newest)
  const superseded = [...heads.flatMap(h => h.older), ...redraws.filter(h => h !== mainHead).map(h => h.newest)]
  const counted = [mainHead.newest, ...addons]
  return {
    total: r2(counted.reduce((n, s) => n + Number(s.total), 0)),
    main: mainHead.newest, addons, superseded, counted,
  }
}

/** The AI Sheet's figure for the same job: the sheet rows (one per signed
    proposal, keyed by Proposal ID) for exactly the proposals the value counts.
    null when any counted proposal has no row yet (the sheet lags a signing by
    seconds, so the caller treats null as "not final", never as $0). */
export function sheetTotalFor(value, rows) {
  if (!value || !value.counted || !value.counted.length) return null
  const byProp = new Map()
  for (const r of rows || []) { const k = String(r.proposalId || '').trim(); if (k && !byProp.has(k) && r.jobPrice != null) byProp.set(k, r) }
  let sum = 0
  for (const s of value.counted) {
    const row = byProp.get(String(s.proposal_id || '').trim())
    if (!row) return null
    sum += Number(row.jobPrice)
  }
  return r2(sum)
}

/** One line for logs and the daily audit: "$9,346.55 = $8,546.55 + add-on $800.00". */
export function describeJobValue(value, usd = n => '$' + Number(n).toFixed(2)) {
  if (!value || value.total == null) return 'no signed proposal'
  if (!value.addons.length) return usd(value.total)
  return `${usd(value.total)} = ${usd(value.main.total)}${value.addons.map(a => ` + add-on ${usd(a.total)} (proposal ${a.document_number || a.proposal_id})`).join('')}`
}

/** What the commission-site deal should hold after a change order: the Sheet's
    rows for exactly the proposals the value counts (the newest redraw plus any
    add-ons), summed — job price, baseline, commission — and the newest signing
    day among them. null when any counted proposal has no Sheet row yet.
    rows: raw Sheet rows ({'Proposal ID','Approved Total','Pre-Tax Sale','Baseline Cost','Commission','Approved Date'}). */
export function sheetRollupFor(countedIds, rows) {
  const ids = (countedIds || []).map(x => String(x || '').trim()).filter(Boolean)
  if (!ids.length) return null
  const money = v => { if (v == null || String(v).trim() === '') return null; const str = String(v).trim(); const n = Number(str.replace(/[^0-9.]/g, '')); return isNaN(n) ? null : (/^\(.*\)$|^-/.test(str) ? -n : n) }
  const byProp = new Map()
  for (const r of rows || []) { const k = String(r['Proposal ID'] || '').trim(); if (k && !byProp.has(k)) byProp.set(k, r) }
  let job = 0, base = 0, comm = 0, commOk = true, day = null
  for (const id of ids) {
    const r = byProp.get(id); if (!r) return null
    const j = money(r['Approved Total']) ?? money(r['Pre-Tax Sale']), b = money(r['Baseline Cost']), c = money(r['Commission'])
    if (j == null || b == null) return null
    job += j; base += b; if (c == null) commOk = false; else comm += c
    const d = String(r['Approved Date'] || '').slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (!day || d > day)) day = d
  }
  return { jobPrice: r2(job), baseline: r2(base), commission: commOk ? r2(comm) : null, changeOrder: day, proposals: ids }
}
