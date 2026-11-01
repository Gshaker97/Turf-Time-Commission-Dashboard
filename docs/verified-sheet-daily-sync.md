# Bounded daily Sheet → GHL synchronization

Deployment alone enables nothing. This mode requires explicit owner approval,
private authorization and persistent environment guards. It is separate from the
historical one-time batch and continuation approvals; those receipts and claims
are never removed, reset or repurposed.

## Boundaries

- Exactly the existing 228 reviewed Project → opportunity identities. No new jobs
  are discovered or admitted by this writer.
- Only opportunity value, Price, Baseline and applicable Commission. Exact values
  come from the matching approved AI Sheet row, not PDF calculations. Commission
  is never added to the customer total.
- The existing complete signed-set/PDF identity checks, exact revision mapping,
  five-minute freshness limit, source/destination rechecks and field readbacks
  remain unchanged. A fresh generation is obtained for each individual job.
- Existing whole-job/field holds, negative Commission, missing values, ambiguous
  identity, canceled/out-of-scope scheduling, and unresolved add-on/replacement
  cases remain held. A new multi-contract signed set requires a newly reviewed
  resolution; this does not automatically decide add-on versus replacement.
- The four previously excluded one-cent Commission corrections must be explicit
  private field holds before authorization is bound. No private IDs go in GitHub.
- No Sheet, commission-site, payroll, contact, stage or installation-date writes.
  No independent PM write. Existing normal GHL → PM value sync remains separate.
- This is not “all GHL fields” or all future jobs. Markup, financing, personnel,
  dates, attachments and other fields are not part of this writer.

## Private activation configuration

`app_settings.verified_sheet_daily_authorization` must contain exactly:

```json
{
  "version": 1,
  "enabled": false,
  "policyVersion": "owner-reviewed-private-policy-version",
  "scopeHash": "SHA256 of canonical complete private scope including holds and resolutions",
  "allowedFields": ["value", "price", "baseline", "commission"]
}
```

`scopeHash` is computed by `dailyScopeHash(policy)`. A changed identity, hold or
replacement resolution invalidates authorization until explicitly reviewed and
rebound. The policy's original `approvedPlanHashes` remains unchanged. Daily
mode authorizes only the freshly verified exact plan for one scoped job; it does
not append arbitrary new hashes to the old batch list.

Required persistent environment values: `ARC_VERIFIED_SHEET_AUTO=1`,
`ARC_VERIFIED_SHEET_WRITES=1`, `ARC_VERIFIED_SHEET_SINGLE_WRITER=1`,
`ARC_VERIFIED_SHEET_BATCH=0`; timers must not be disabled. Default scheduling is
06:00 America/Phoenix, using the existing `ARC_AUDIT_HOUR` override and five-minute
polling. No new external cron service is created. A deployment/restart picks up
activation. Webhook hints do not start a separate financial write path.

## Durable replay protection

A singleton worker is acquired with a compare-and-set record in private
`app_settings`. It has no automatic expiration or takeover. Each intended job
write also acquires a project-state gate, then appends an immutable intent before
any financial request. A verified final receipt is appended before the project
can accept a different future plan. The same completed plan is not replayed.

A crash, interrupted claim, failed receipt or uncertain field result leaves a
closed durable gate. An owner must inspect current fields and receipts before
any new authorization; a timer or restart cannot reset that gate. No HTTP endpoint
accepts plans, scope, hashes, configuration or a gate reset.

The separate daily receipt says whether all scoped jobs were accounted for.
`complete: true` does **not** mean all held jobs were corrected. Ordinary dry-run
reports cannot suppress a daily sweep. GET
`/api/arcsite/verified-sheet-reconcile/daily` is Jarvis-authorized and read-only.
It reports actual process guards, timer/hour configuration, worker and day receipt.

## Activation verification

1. Review exact final PR, CI and this bounded capability; merge only on approval.
2. Compare the live private policy with the reviewed base, add only the four
   explicit cent holds, and verify all other scope/holds/resolutions preserved.
3. Bind private authorization to that exact scope; stage disabled first.
4. Check no unresolved original execution or daily worker exists, healthy single
   replica, and normal PM sync timing. Do not clear historical claims.
5. Only with explicit activation approval enable the private authorization and
   three persistent daily guards; keep batch guard off.
6. Verify deployed commit, persisted values, owner-only status and next due hour.
   Monitor the first scheduled sweep to terminal receipts/readbacks. Do not claim
   successful syncing merely because environment variables were saved.
