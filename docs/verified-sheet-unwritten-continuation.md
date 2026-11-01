# Explicit continuation of proven unwritten stale jobs

This is not a general retry or automatic recovery facility. It requires a new,
owner-reviewed private permit. Original batch receipts and consumed-plan claims
remain intact. Successful, attempted, partial or uncertain jobs are ineligible.

The private app_settings key `verified_sheet_retry_permit` contains only:
`version:1`, `approved:false` for preview (true only after explicit approval),
`parentBatchId`, `parentReceiptHash`, and `entries`. Each entry binds the exact
original project, opportunity, plan hash, source hash and ordered changes
(field/wasCents/wantCents). No source policy version or scope change is needed.
Never put this private data in Git. The HTTP endpoints accept no parameters.

Validation binds the canonical hash of the terminal parent receipt, a sole stale
hold with zero changes and no result/attempt for each job, the original consumed
plan claim, current original approval hashes, and preserved scope/field holds.
Only Price, Baseline and informational Commission are supported. No revenue,
stage, contact, install-date, Sheet, commission-site, payroll or PM writes.

POST `/api/arcsite/verified-sheet-reconcile/retry-preview` with `{}` using existing
Jarvis analyst authentication. Poll its returned private request-specific status
path. Preview stores findings only: it creates no execution claims and cannot
write business fields. Each job gets its own fresh runtime generation. A missing
preview receipt means pending/unavailable, never success. Every candidate must
still produce its ORIGINAL approved hash; differences stay held.

After separately reviewing preview and approving the permit and temporary guard
operation, POST `/api/arcsite/verified-sheet-reconcile/retry` with `{}`. AUTO must
stay OFF; BATCH, WRITES and SINGLE_WRITER must be explicitly enabled. Shared locking
excludes other verified runs. A durable insert-only continuation receipt prevents
replay; each unchanged job then receives its own permanent retry-consumed claim
before any execution. Claim keys bind original plan hashes across all permits.
No claims are deleted, expired or reset. Uncertain claims/execution stop without
retry. A new configuration cannot replay an already consumed plan retry.

Each job is previewed again from a fresh generation and then executes through
existing `onlyProject`, exact-hash approval, five-minute freshness, per-field live
source/destination checks and read-back. There is no full-scope scan, TTL extension,
relabelled timestamp, invented hash or silent approval. Jobs that drift stay held.

Poll the returned continuation-specific receipt; `finished` is not a blanket
success assertion. Inspect every job/field result. Finally verify the THREE
persisted Railway guards are OFF and the deployment healthy; process-local cleanup
alone is not persisted cleanup. Daily AUTO remains OFF throughout.
