// ============================================================
// scheduler-webhook — receives Outside Sales jobs from the install scheduler
// (Google Apps Script) and upserts them into the deals table.
//
// Deploy as a Supabase Edge Function. It is reached at:
//   POST {SUPABASE_URL}/functions/v1/scheduler-webhook
//
// Env (function secrets):
//   SUPABASE_URL                 (auto-provided by Supabase)
//   SUPABASE_SERVICE_ROLE_KEY    (auto-provided by Supabase)
//   SCHEDULER_WEBHOOK_SECRET     (optional shared secret; if set, callers must
//                                 send Authorization: Bearer <secret>)
//
// Behavior:
//   • Upserts on proposalId (stored in deals.project_id) — no duplicates.
//   • NEW deal → status "Deal Review", reps resolved by name, splits set.
//   • EXISTING deal → updates only scheduler-owned facts (name, office,
//     payment, dates, prices, pay_date) and PRESERVES status, setter/closer,
//     splits, overrides, notes, checklist (whatever was set in the dashboard).
//   • Always returns 200 on success.
// ============================================================

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SECRET       = Deno.env.get('SCHEDULER_WEBHOOK_SECRET') ?? ''

function sb(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,\s]/g, ''))
  return Number.isNaN(n) ? null : n
}
// Pay the Friday following the (Monday-anchored) install week = Monday + 11 days.
function payDateFromInstall(iso?: string | null): string | null {
  if (!iso) return null
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  const dow = d.getUTCDay()                 // 0=Sun..6=Sat
  const offset = (dow === 0 ? 7 : dow) - 1  // days since Monday
  const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - offset)
  const pay = new Date(monday); pay.setUTCDate(monday.getUTCDate() + 11)
  return pay.toISOString().slice(0, 10)
}
const normPay = (m?: string): string | null => {
  const s = (m ?? '').trim()
  if (!s) return null
  return s.replace(/self pay/ig, 'Self-Pay')
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  if (SECRET) {
    if ((req.headers.get('Authorization') || '') !== `Bearer ${SECRET}`) {
      return new Response('Unauthorized', { status: 401 })
    }
  }

  let body: Record<string, any>
  try { body = await req.json() } catch { return new Response('Bad JSON', { status: 400 }) }

  const proposalId = String(body.proposalId ?? '').trim()
  if (!proposalId) return new Response('Missing proposalId', { status: 400 })

  try {
    // Resolve setter/closer names → profile ids (best effort; null if no match).
    const profiles = await (await sb('profiles?select=id,name')).json()
    const byName: Record<string, string> = {}
    for (const p of profiles) if (p?.name) byName[String(p.name).trim().toLowerCase()] = p.id
    const findId = (n?: string) => { const k = (n ?? '').trim().toLowerCase(); return k ? (byName[k] ?? null) : null }
    const setterId = findId(body.setter)
    const closerId = findId(body.closer) ?? setterId

    const installDate = body.installDate || null
    // Fields the scheduler owns (safe to overwrite on every send).
    const facts = {
      deal_name:        body.dealName ?? null,
      office:           body.office ?? null,
      payment_method:   normPay(body.paymentMethod),
      sale_date:        body.saleDate || null,
      install_date:     installDate,
      pay_date:         payDateFromInstall(installDate),
      baseline_revenue: num(body.baselinePrice),
      job_price:        num(body.totalJobPrice),
    }

    const existing = await (await sb(`deals?project_id=eq.${encodeURIComponent(proposalId)}&select=id`)).json()

    if (Array.isArray(existing) && existing.length > 0) {
      // Update facts only — preserve dashboard-owned fields.
      await sb(`deals?id=eq.${existing[0].id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(facts),
      })
      console.log(`updated ${proposalId} (${facts.deal_name})`)
    } else {
      const insert = {
        ...facts,
        project_id: proposalId,
        status: 'Deal Review',
        setter_id: setterId,
        closer_id: closerId,
        setter_split_pct: setterId && closerId ? (setterId === closerId ? 1 : 0.5) : null,
      }
      await sb('deals', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(insert) })
      console.log(`created ${proposalId} (${facts.deal_name})`)
    }
    return new Response('ok', { status: 200 })
  } catch (e) {
    console.error('scheduler-webhook error', e)
    return new Response('error', { status: 500 })
  }
})
