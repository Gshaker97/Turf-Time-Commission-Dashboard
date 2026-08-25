// ============================================================
// Is the CRM lead feed actually delivering?
//
// "Last ran" on the sync heartbeat says nothing about leads — that's the
// spreadsheet sync. The lead feed is push-based, so its health is measured by
// WHEN WE LAST HEARD FROM IT (`app_settings.lead_last_payload.at`, stamped on
// every ingest) plus how much has arrived recently.
//
// Quiet is not automatically broken: nobody books appointments at 3am, and a
// Sunday can legitimately be empty. So staleness is judged against a generous
// window and phrased as "quiet", not "failed" — the hard-failure signal is
// never having received anything at all.
// ============================================================

const HOUR = 3600000
export const feedAgo = (iso) => {
  if (!iso) return null
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 48) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// leads: rows from the leads table (any subset — counts use created_at).
// lastPayloadAt: settings.lead_last_payload?.at
export function leadFeedHealth(leads = [], lastPayloadAt = null, now = Date.now()) {
  const since = (ms) => new Date(now - ms).toISOString()
  const day = since(24 * HOUR), week = since(7 * 24 * HOUR)
  const created = (l) => l.created_at || l.updated_at || null
  const today = leads.filter(l => created(l) && created(l) >= day).length
  const last7 = leads.filter(l => created(l) && created(l) >= week).length

  // Newest signal we have: an actual delivery, else the newest row we hold.
  const newestRow = leads.reduce((max, l) => {
    const t = l.updated_at || l.created_at
    return t && (!max || t > max) ? t : max
  }, null)
  const lastAt = [lastPayloadAt, newestRow].filter(Boolean).sort().pop() || null

  if (!lastAt) {
    return {
      level: 'none', color: '#ef4444',
      text: 'No appointments have ever arrived — check the webhook URL and secret in RepCard.',
      short: 'not connected', lastAt: null, today, last7,
    }
  }
  const hrs = (now - new Date(lastAt).getTime()) / HOUR
  if (hrs > 48) {
    return {
      level: 'stale', color: '#ef4444',
      text: `Nothing received in ${Math.floor(hrs / 24)} days — the feed may be broken. Check RepCard's Webhook History for failures.`,
      short: `quiet ${feedAgo(lastAt)}`, lastAt, today, last7,
    }
  }
  if (hrs > 18) {
    return {
      level: 'quiet', color: '#f59e0b',
      text: `Last appointment received ${feedAgo(lastAt)} — normal overnight, worth a look if it stays quiet.`,
      short: `last ${feedAgo(lastAt)}`, lastAt, today, last7,
    }
  }
  return {
    level: 'ok', color: '#00b894',
    text: `Receiving — last appointment ${feedAgo(lastAt)}, ${today} in the last 24h.`,
    short: `last ${feedAgo(lastAt)}`, lastAt, today, last7,
  }
}
