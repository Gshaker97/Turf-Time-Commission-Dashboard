# Reviewed one-shot field batch

This is an explicit manual trigger, not a daily schedule. Deployment alone does
not enable writes. The existing dry-run POST remains unchanged.

## Preconditions

- The owner has approved the exact private manifest and its plan hashes.
- Set only those hashes in the existing owner-private reviewed policy; preserve
  every scope entry, replacement resolution and hold. Never put records in Git.
- Verify a single live writer instance. Keep `ARC_VERIFIED_SHEET_AUTO` OFF.
- The existing `ARC_VERIFIED_SHEET_WRITES` and
  `ARC_VERIFIED_SHEET_SINGLE_WRITER` guards plus new
  `ARC_VERIFIED_SHEET_BATCH` must be exactly `1` for the one-shot request.
- Use the existing Jarvis analyst authentication. No new credentials are needed.

POST `/api/arcsite/verified-sheet-reconcile/batch` with an empty JSON object and
no query parameters. HTTP cannot supply values, scope, or approval hashes.
A successful 202 includes a batch-specific statusPath. Poll it with the same
existing authentication. Do not use the generic last report as proof this batch
ran. The current runtime re-plans from fresh evidence and writes only exact
approved hashes, with fresh checks and read-backs before/after each field.

## Replay and uncertainty

An atomic, insert-only private database claim covers the sorted approval set and
all individual plan hashes. A conflict rejects the entire claim. Claims are
never automatically deleted, expired, or reset, including after errors. This
prevents retries after timeouts/restarts or regrouping previously claimed hashes
into a different batch. A rejected/uncertain claim means no execution is started
by that request. A prior execution may still be running: inspect its receipt and
live field read-backs before deciding what happened. No automatic retry is safe.

A `finished` receipt means the runtime returned, not that every field matched or
was written. Inspect its report.results and report.plans for drift, held,
unapproved, already-matched, verified, partial, and uncertain outcomes. An
`uncertain` or still-`claimed` receipt requires investigation, not replay.
If final receipt storage fails the original claim remains and prevents replay.

## Cleanup

The process-local BATCH, WRITES and SINGLE_WRITER guards are reset to `0` in
finally on every claimed attempt, including failures. This does **not** change
persisted Railway configuration. The operator must remove/disable those three
persisted variables and verify the resulting deployment is healthy with AUTO
still OFF. Durable claims prevent the same approval from replaying after a
restart even before external cleanup. No claim cleanup API is provided.

This route never changes stages, contacts, calendar dates, the Sheet,
commission-site records, payroll, or the daily scheduler. It only invokes the
existing opportunity-field allowlist and exact-plan runtime.
