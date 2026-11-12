// After an opportunity UPDATE on the sale path, read the opportunity back and
// re-apply only what GoHighLevel dropped. Pure: every network call is injected.
//
// Why: when a sale ADOPTS an opportunity that already existed (a hand-made one
// or a website lead — matched by contact, not by Project ID), the single PUT
// that renames it, moves its stage and writes its custom fields has been seen
// to land only partially (Robert Durward #2 on 2026-11-06: fields written,
// Project ID missing; Tyler Sibold on 2026-11-12: value written, Project ID
// and stage missing). The CREATE path already re-applies custom fields for the
// same class of quirk; the UPDATE path did not.
//
// Safety rules (so no other scenario is disturbed):
//   • Nothing is written unless the read-back shows it missing or wrong.
//   • Custom fields are re-applied as the SAME set the sale already planned —
//     idempotent for an opportunity that already carries them.
//   • The stage is corrected ONLY for an adopted opportunity (not matched by
//     Project ID). A same-project update keeps today's behaviour exactly.
//   • If a write fails or the second read-back still disagrees, the result says
//     ok:false so the caller marks fields_ok=false and the existing enrich queue
//     and value sweep keep reconciling (they already do that on fields_ok=false).
export const fieldValueOf = (opp, fieldId) => {
  for (const c of (opp && opp.customFields) || []) {
    if (c.id !== fieldId) continue
    const v = c.fieldValueString ?? c.fieldValueNumber ?? c.fieldValueArray ?? c.fieldValue ?? c.value ?? null
    return v
  }
  return null
}

const present = v => !(v == null || v === '' || (Array.isArray(v) && v.length === 0))
const sameScalar = (want, got) => {
  if (Array.isArray(want)) return present(got)
  if (typeof want === 'number') return Number(got) === want
  return String(got ?? '').trim() === String(want).trim()
}

/** Which planned fields the opportunity does not carry (or carries wrongly, for exact-match ids). */
export function missingFields(opp, customFields, { exactIds = [] } = {}) {
  const out = []
  for (const f of customFields || []) {
    const got = fieldValueOf(opp, f.id)
    if (exactIds.includes(f.id) ? !sameScalar(f.field_value, got) : !present(got)) out.push(f.id)
  }
  return out
}

/**
 * @param {object} p
 * @param {string} p.oppId
 * @param {Array<{id:string, field_value:any}>} p.customFields  the fields the sale planned (same set the PUT carried)
 * @param {string[]} p.exactIds           field ids that must match exactly (the Project ID)
 * @param {boolean} p.adopted             true when the opportunity was NOT matched by Project ID
 * @param {string|null} p.targetStageId   the stage the PUT asked for
 * @param {(id:string)=>Promise<any>} p.get   GET /opportunities/:id → opportunity (any shape)
 * @param {(id:string, body:object)=>Promise<any>} p.put  PUT /opportunities/:id
 * @returns {{ ok:boolean, checked:boolean, reapplied_fields:string[], stage_fixed:boolean, still_missing:string[], stage_wrong:boolean, error?:string }}
 */
export async function readBackAndRepair({ oppId, customFields = [], exactIds = [], adopted = false, targetStageId = null, get, put }) {
  const out = { ok: true, checked: false, reapplied_fields: [], stage_fixed: false, still_missing: [], stage_wrong: false }
  const read = async () => { const r = await get(oppId); return (r && r.opportunity) || r || null }
  let opp
  try { opp = await read() } catch (e) { return { ...out, ok: false, error: `read-back failed: ${e.message || e}` } }
  if (!opp) return { ...out, ok: false, error: 'read-back returned no opportunity' }
  out.checked = true
  const missing = missingFields(opp, customFields, { exactIds })
  const stageWrong = adopted && targetStageId && opp.pipelineStageId && opp.pipelineStageId !== targetStageId
  if (!missing.length && !stageWrong) return out
  try {
    if (missing.length) { await put(oppId, { customFields }); out.reapplied_fields = missing }
    if (stageWrong) { await put(oppId, { pipelineStageId: targetStageId }); out.stage_fixed = true }
  } catch (e) { return { ...out, ok: false, error: `re-apply failed: ${e.message || e}` } }
  try { opp = await read() } catch (e) { return { ...out, ok: false, error: `second read-back failed: ${e.message || e}` } }
  out.still_missing = missingFields(opp, customFields, { exactIds })
  out.stage_wrong = Boolean(adopted && targetStageId && opp && opp.pipelineStageId && opp.pipelineStageId !== targetStageId)
  out.ok = !out.still_missing.length && !out.stage_wrong
  return out
}
