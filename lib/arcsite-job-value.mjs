// The job value an OPPORTUNITY is worth, from the project's SIGNED ArcSite
// proposals. One opportunity = one job = ONE signed proposal (Garrison, Nov 23
// 2026). Add-ons are never summed into the original: a job done at a different
// time is a different opportunity with its own value, contract and install
// date. An add-on is drawn as a NEW ArcSite project; when one is signed inside
// the original project instead, it is reported (no opportunity of its own),
// never added to the original's value.
//
// ArcSite has no notion of "revision" vs "add-on": every signing is just
// another proposal on the project. The rule here:
//
//   1. Proposals drawn on the SAME drawing are revisions of one document —
//      the newest signing wins, the older ones are superseded.
//   2. Across drawings, the newest signing of the LARGEST one anchors the job.
//      Another drawing whose total is at least `addonMaxShare` of the anchor
//      (default half) is a redraw of the same job — again the newest signing
//      wins (Teena Prentice: $8,426 redrawn at $7,891). One that is smaller
//      than that share is an ADD-ON: a separate job, NOT counted here.
//   3. The opportunity OWNS exactly one of those heads: the one whose total
//      matches the opportunity's current value (Amanda Pogorzelski: the opp at
//      $1,802.60 owns the add-on; the $15,895.75 original is a different job),
//      else the proposal named by `ownProposalId` (the webhook's signing), else
//      the main head. `total` is that head's total — never a sum. `signed` is
//      the owned job's signings only (revisions and redraws; an add-on's opp carries
//      just the add-on) — what the opp's contracts are judged by.
//      `unowned` lists the other heads (original or add-ons) so the daily
//      audit can say "signed on this project, no opportunity of its own".
//
// Pure: no I/O. `signed` is oldest → newest (arcSignedContracts order); the
// proposal_id order is the only time signal ArcSite exposes.
const r2 = n => Math.round(Number(n) * 100) / 100
const same$ = (a, b) => a != null && b != null && Math.abs(Number(a) - Number(b)) <= 1

export function arcJobValue(signed, { addonMaxShare = 0.5, oppValue = null, ownProposalId = null } = {}) {
  const list = (signed || []).filter(s => s && Number.isFinite(Number(s.total)))
  const empty = { total: null, main: null, owned: null, owned_by: null, addons: [], unowned: [], superseded: [], counted: [], signed: [] }
  if (!list.length) return empty
  // 1. newest signing per drawing (a proposal without a drawing id is its own group)
  const groups = new Map()
  list.forEach((s, i) => { const k = s.drawing_id ? `d:${s.drawing_id}` : `p:${s.proposal_id || i}`; groups.set(k, { newest: s, order: i, older: [...((groups.get(k) || {}).older || []), ...(groups.has(k) ? [groups.get(k).newest] : [])] }) })
  const heads = [...groups.values()]
  // 2. the largest head anchors the job; big heads are redraws (newest wins), small heads are add-ons (separate jobs)
  const anchor = heads.reduce((a, b) => (Number(b.newest.total) > Number(a.newest.total) ? b : a))
  const share = Math.max(0, Math.min(1, Number(addonMaxShare) || 0))
  const redraws = heads.filter(h => Number(h.newest.total) >= share * Number(anchor.newest.total))
  const mainHead = redraws.reduce((a, b) => (b.order > a.order ? b : a))
  const addonHeads = heads.filter(h => !redraws.includes(h))
  // 3. the head this opportunity owns
  const candidates = [mainHead, ...addonHeads]
  const own = String(ownProposalId || '').trim()
  let ownedHead = null, ownedBy = null
  const v = oppValue != null && Number.isFinite(Number(oppValue)) && Number(oppValue) > 0 ? Number(oppValue) : null
  if (v != null) { ownedHead = candidates.find(h => same$(h.newest.total, v)) || null; if (ownedHead) ownedBy = 'opportunity value' }
  if (!ownedHead && own) { ownedHead = candidates.find(h => String(h.newest.proposal_id) === own || [...h.older].some(o => String(o.proposal_id) === own)) || null; if (ownedHead) ownedBy = 'signed proposal' }
  if (!ownedHead) { ownedHead = mainHead; ownedBy = 'main contract' }
  const kindOf = h => (h === mainHead ? 'original' : 'add-on')
  const unowned = candidates.filter(h => h !== ownedHead).map(h => ({ ...h.newest, kind: kindOf(h) }))
  const superseded = [...heads.flatMap(h => h.older), ...redraws.filter(h => h !== mainHead).map(h => h.newest)]
  // The opp's own contracts: the owned head's revisions — and, when it owns the
  // main contract, every redraw of that job too (a redraw is the same job
  // re-signed, not another job). An add-on's opp carries the add-on's only.
  const ownHeads = ownedHead === mainHead ? redraws : [ownedHead]
  const ownedSigned = list.filter(s => ownHeads.some(h => s === h.newest || h.older.includes(s)))
  return {
    total: r2(ownedHead.newest.total),
    main: mainHead.newest, owned: ownedHead.newest, owned_by: ownedBy, owned_kind: kindOf(ownedHead),
    addons: addonHeads.map(h => h.newest), unowned, superseded, counted: [ownedHead.newest], signed: ownedSigned,
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

/** One line for logs and the daily audit: "$1,802.60 (proposal 615315, this
    opportunity's own) — also signed on this project, not counted: original
    $15,895.75 (proposal 462238)". */
export function describeJobValue(value, usd = n => '$' + Number(n).toFixed(2)) {
  if (!value || value.total == null) return 'no signed proposal'
  const own = value.owned || value.main
  const head = `${usd(value.total)} (proposal ${own.document_number || own.proposal_id}${value.owned_by === 'opportunity value' ? ", this opportunity's own" : value.owned_kind === 'add-on' ? ', add-on' : ''})`
  if (!value.unowned || !value.unowned.length) return head
  return `${head} — also signed on this project, not counted: ${value.unowned.map(u => `${u.kind} ${usd(u.total)} (proposal ${u.document_number || u.proposal_id})`).join(', ')}`
}

/** What the commission-site deal should hold after a change order: the Sheet's
    rows for exactly the proposals the value counts (the one signed proposal
    this opportunity owns), summed — job price, baseline, commission — and the newest signing
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
