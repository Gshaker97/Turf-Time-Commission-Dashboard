# Verified AI Sheet → GHL reconciliation (draft; not activated)

## Authorized boundary
October/November 2026 active booked jobs from the reviewed 228-project population. Exact Project/opportunity IDs must be frozen in owner-private `app_settings.verified_sheet_reconcile_policy`; no name matching or automatic scope growth. This setting is NOT populated by the PR. No customer/project/opportunity identifiers are committed. `docs/verified-sheet-policy.example.json` is intentionally empty and fail-closed. Existing named exclusions and field holds remain. GHL **value, Price, Baseline and informational Commission** only. Commission-site financials, gold checks, finalized/paid payroll, adjustments, overrides and history are never written. No contact, markup, setter, closer, finance method, stage, install-date, contract attachment or direct PM writes. PM value follows the existing normal GHL sync only.

The new path does not reuse the legacy change-order endpoint, which can move stages and update contacts. Existing automation remains unchanged until separately reviewed. The old webhook now provides a nonblocking hint to the guarded field-aware reconciliation; the old total/document-count sweep also enqueues this check before its short circuit. This closes the secondary-field retry gap **when the new path is explicitly activated**, without granting old paths new write authority.

## Runtime
- Authenticated `POST /api/arcsite/verified-sheet-reconcile`: background **dry run only**. Request body cannot activate writes or change scope/holds.
- Authenticated GET at same path: stored private report.
- `ARC_VERIFIED_SHEET_AUTO` absent/default: no new timer or scheduler.
- `ARC_VERIFIED_SHEET_WRITES` absent/default: zero writes.
- `ARC_VERIFIED_SHEET_SINGLE_WRITER` absent/default: zero writes. Before enabling, verify deployment is single-instance or supply a reviewed durable lock; local serialization is not a multi-instance lease.
- The private policy initially does not exist and has **no approved plan hashes**. A plan can write only with both writer guards and its exact reviewed hash. Future changed plans require new review; this draft does not silently authorize all future money changes.
- Five-minute retry hints plus daily pass use the existing audit hour only when AUTO explicitly enabled. A source failure never marks a job settled.

## Evidence gate
ArcSite official pagination: [proposals](https://dev.arcsite.com/proposals/), [pagination](https://dev.arcsite.com/pagination/). Query exact project, pages starting at1, page size100, continue until short final page. Cap, duplicates, partial/error feeds hold. Details must be APPROVED/nonvoid and match exact proposal/project. Download the proposal-level PDF without credentials or redirects; parse actual PDF body for signature timestamp and total, hash its bytes. Default storage hostname `cdn-files-1.arcsite.com` was observed in all183 successful existing October PDF records. No wildcard Amazon/S3 hosts.

For multi-proposal projects, supply reviewed `replacementResolution` on that exact scope entry: `{kind:"replacement",proposalId,pdfSha256,proposalIds:[complete signed set]}`. This resolution binds the current signed set/hash, not all future revisions. Add-ons and unresolved scope are held, never summed. The selected exact APPROVED Sheet Project+Proposal row must be unique. No latest-row-by-order or total-only identity matching.

Sheet Approved Total and signed total must agree within the previously approved $1 source-consensus tolerance; signed total wins that rounding difference. Each destination comparison is exact cents. Baseline and Commission come from their own Sheet columns. Blank financial fields are not filled. Negative Commission is held. Markup/contacts are not guessed. Gold-checked commission-site differences do not block eligible **GHL** corrections, but remain untouched.

## Pre-write / read-back
Each field gets fresh source/revision and destination checks, including complete GHL identity refresh. Source hash, policy/hold state and expected old value must still match. Write only that GHL field, independently read it back; HTTP200 alone is not proof. Timeout-after-write gets read-back before any retry. Uncertain read-back stops the job. Successful fields are idempotent on subsequent runs. GHL lacks atomic compare-and-swap; a final external-writer race remains a deployment coordination risk and must be accepted/controlled before activation.

## Review / activation checklist — not completed
1. Review draft PR and focused test results. Confirm full repository lint/build and the actual PDF parser fixture pass in hosted CI for the exact head; dependency-free tests alone are insufficient.
2. Merge/deploy only after PR-specific approval. All new guards remain OFF, approvals empty.
3. Run production read-only dry run. Review all eligible exact-ID/revision/field changes and holds; resolve signed replacement evidence individually.
4. After explicit owner approval to populate the private configuration, add reviewed exact scope, all existing holds, plan hashes and resolutions to that private server setting—not GitHub. Verify host allowlist and single-writer deployment. No secret values belong in commits.
5. Explicitly activate the writer/schedule only after dry-run approval. No existing guards are changed by this PR.
6. Verify per-field GHL read-backs, then PM value after its normal six-hour sync; do not trigger PM sync or alter dates.
7. For continuously automatic future revisions, obtain a separate reviewed activation policy; the initial exact-hash gate deliberately does not authorize unseen plans.

## Local checks
`RUN_PDF_PARSE_INTEGRATION=1 node --test test/*.test.mjs` (after lockfile dependencies are installed)
`node --check server.js`

No production dry run, live write, record repair, deployment, or activation has been performed as part of this draft.
