# Private website lead status monitor

`GET /api/analyst/website-lead-status` accepts no parameters and requires the
existing Jarvis analyst credential via existing analyst authentication. It rejects
dashboard-only keys and anonymous callers. No credential values belong in source,
tests, logs or schedule prompts. It reads retained GHL contacts and original
`Website estimate request` notes with the current read token, plus the existing
estimator export for six months back and 120 days ahead. No business writes or
messages occur. Scope starts at the October 30 launch; deleted notes/contacts and
pre-launch previews cannot be reconstructed. Every contact page is scanned,
including older contacts reused by the website.

Responses: `202 building` with `Retry-After: 10` means poll the same GET;
`200 complete` contains `leads`, `notificationCandidates`, freshness and coverage;
`503 source_incomplete` means no alerts; `401`, `405`, `400` reject unauthorized
callers, methods or parameters. Reads are single-flight and bounded to 120 seconds,
200 contact pages, 500 candidate contacts and 8 MiB per upstream response. The
five-minute result cache cannot be refreshed by caller parameters.

Rows include original address/time/contact details, request, source/contact links,
age/overdue seconds, stable `noticeKey`, matching evidence and classification.
Repeated same-project requests retain the first clock and identity aliases.
Conflicting projects, historical bookings, follow-up dispositions and canceled or
rescheduled-only matches require review. A current replacement can resolve a
canceled booking. Stable GHL IDs are preferred when exported; coverage reports
whether the upstream exposes them. Partial/stale/invalid sources never yield
missing-booking conclusions. The three leads reported November 3 are marked as
previously notified and excluded from notificationCandidates. Consumers must keep
additional delivered keys durably; this server does not create a notice ledger.

## Paired Jarvis proxy and independent cloud verification

Jarvis `GET /api/website-lead-status` accepts no parameters. It uses only the
existing stored analyst key and existing owner-private Sites dispatch service
boundary. Sites consumes its service-access token; the proxy never impersonates a
visitor. Do not move this route onto a shared/public Site. All unrelated owner
checks and the current audience must be preserved.

Before scheduling, a fresh cloud task must obtain supported service access using
native Sites tooling, confirm owner-only access, and call the private proxy with
that token only in the supported header toward that Site. Never copy, log or save
secrets. Poll 202 every ten seconds for at most two minutes. Require 200 complete,
coverage.complete, no errors, full contact-page totals, estimator summary/returned
equality, fresh timestamps and the required future window. Independently verify
anonymous access is rejected by Sites dispatch, commission rejects anonymous and
dashboard-only callers, and baseline leads are ineligible. Partial/stale/failed or
ambiguous states suppress notifications. Scheduling/delivery is separate work.

## Deployed rolling-window coverage repair

A rolling six-month export must not be required to reach the fixed launch date
forever. Commit `a2c1715e1cbe381e23e8deafe9a3d25bcc3fdfb0` was deployed
successfully on November 4, 2026 (verified at 19:20 UTC). The change validates
the current export window globally, then
checks each grouped request separately. Only requests whose earliest submission
is within that window can yield an absence conclusion; older requests return
`source_incomplete / submission_precedes_calendar_window`. They do not suppress
covered new leads. Existing future-window, summary-count, freshness and failure
checks remain unchanged. Overall `complete` means the current source/window reads
are complete; `calendarRangeCovered` separately records each request’s coverage.

Separate unresolved semantics: a later same-property request after a completed
visit/job currently remains grouped with the earliest request and may be marked
scheduled by the earlier visit. A completed estimator appointment alone is not
proof that the installation/project ended. Do not infer new episodes from elapsed
time or reset the grace clock automatically. A policy decision is needed about
what explicit event or evidence starts a new same-property request episode.

## Deployed durable delivery ledger and consumer contract

The reader proxy was introduced in private Jarvis v50. The delivery ledger and
its schema-only migration are deployed in **Jarvis v51**, source commit
`720f40a9240489642a55443522493022dc8a5d5e`, deployment
`appgdep_6aeb89fa63108191886c901be327148d`, saved version
`appgprj_6ae223c12d6081919d8fb7114fc003b3~appgver_f2b2bac09abc8191a6365418b18eb1d9`.
Publication succeeded November 4, 2026 at 19:39:47 UTC. Owner-only access and the
existing DB binding are unchanged. Tests: 156 passed, including 13 ledger tests
with separate SQLite worker concurrency; independent review and build passed.

Production metadata-only verification returned 200 ready, readOnly true,
sendGranted false and automaticReclaim false. Anonymous access returned 401,
query parameters 400, and DELETE 405. No real eligible notice was claimed, begun,
finalized or sent. Independent cloud readiness verification completed at **2026-11-04T19:42:53Z**:
ledger ready/readOnly true/sendGranted false; the reader covered all **2,232
contacts**, **13 candidate-note reads** and **750 appointments**. No notice was
claimed and no message was sent. No automation was created by this implementation.

This guide contains no access token. The ledger uses the existing Site DB and
stores internal delivery coordination, never customer leads/bookings/messages.

### Existing access and safe checks

A cloud run may call native Sites `get_site` for project
`appgprj_6ae223c12d6081919d8fb7114fc003b3`, verify its owner-only access policy,
and use its already existing `siwc_bypass_bearer_token` only as
`OAI-Sites-Authorization: Bearer <token>` toward
`https://jarvis-weekly-hq.gshaker97.chatgpt.site`. Keep the value in memory or
protected stdin; never log/save it, put it in command arguments or task prompts,
follow a redirect with it, generate another token, or impersonate visitor identity.
This service token is distinct from a short-lived Git source-write credential;
source-write access is not required by a scheduled consumer. A changed/private
access boundary must halt execution, not prompt a sharing/permission change.

Safe production verification is `GET /api/website-lead-delivery` with no
parameters. It returns schemaVersion 1, status ready, readOnly true,
automaticReclaim false and sendGranted false. It reads only schema availability
and does not reserve, finalize or send anything. Anonymous and nonowner callers
must remain denied. Never reserve or mark a real lead accepted merely for a test.

### Ledger API

`POST /api/website-lead-delivery`, Content-Type application/json, no URL parameters,
maximum 4096 body bytes. All responses carry scope `website-lead-delivery-v1`,
`Cache-Control: private, no-store`, and `sendGranted: false` unless a first atomic
`begin` transition succeeds. No SQL, owner identifier, message body, recipient,
phone, email, address or arbitrary customer payload is accepted.

Common request:

```json
{
  "op": "claim",
  "selector": {
    "noticeKey": "website-estimate-v1:<64 lowercase hex characters>",
    "contactId": "<original contactId from feed>",
    "noteId": "<original noteId from feed>"
  },
  "attemptId": "website-lead-v1-<lowercase SHA256(contactId + | + noteId)>"
}
```

For the supported scheduled consumer, compute the exact same attempt ID on every
run: `website-lead-v1-` plus the lowercase hexadecimal SHA-256 digest of the exact
UTF-8 string `contactId + "|" + noteId`. This is 79 characters. Do not trim or change
case, and never include execution time, run ID or parser-dependent noticeKey.
The immutable original identifiers make ownership recoverable without relying on
transient execution context. Use only fields from the authoritative
`GET /api/website-lead-status` response. `claim` and `begin` independently re-read
that current complete feed and require exactly
one matching eligible row, non-baseline, covered calendar range, matching
notificationCandidates and source age at most five minutes. Partial/stale,
pending or failed sources cannot produce send permission.

Operations use the common selector/attempt fields:

- `claim`: atomic original-contact/note reservation. First acquisition returns
  201, acquired true, state reserved, sendGranted false. Concurrent requests and
  retries return acquired false and existing reservation state. A changed parser
  noticeKey cannot bypass the retained original contact/note identity. The original
  submitted time and noticeKey remain stored. A different owner attempt is blocked.
- `begin`: atomic reserved -> sending, after fresh eligibility validation. Exactly
  one successful call returns 200 and sendGranted true. Only that response permits
  ONE owner-directed phone send. All replays/concurrent calls return 409 and false.
  Do not send customer contacts messages; recipient resolution/delivery to the
  requesting owner is the consumer's separate authorized responsibility.
- `status`: returns only this original reservation's state, original identifiers,
  stored noticeKey, ownership, send-start timestamp and accepted receipt if present.
  No fresh eligibility is required, allowing reconciliation after a lead is booked.
- `finalize`: requires an additional receipt object
  `{"provider":"messages","messageId":"<actual accepted provider ID>","acceptedAt":"<ISO timestamp>"}`.
  Only sending/uncertain can become accepted. Receipt IDs are unique. An identical
  receipt replay succeeds idempotently; a different receipt conflicts. Store only
  the positive receipt actually returned by the Messages send or recovered from
  actual message history. The ledger records provider acceptance, not delivery,
  and does not independently query/validate Messages history or destination.
- `mark_uncertain`: sending -> uncertain; never a fresh send permission. Use after
  an ambiguous phone-send outcome. An actual positive history receipt may later
  finalize it. Missing history alone is not proof of non-execution.
- `cancel_before_send`: reserved -> confirmed_not_sent only. The atomic reserved
  state proves no begin/send permission was issued. The same attempt cannot
  reacquire; a distinct attempt may claim again only if the current feed remains
  eligible. A racing begin either wins and blocks cancellation, or cancellation
  wins and blocks the old sender. Sending/uncertain/accepted cannot be released.

Status codes: 200 existing state/success; 201 first claim; 400 malformed or
unsupported body/query; 403 nonowner/partial visitor identity; 404 missing
reservation; 405 unsupported method; 409 ineligible/ownership/state/receipt
conflict; 503 unavailable source/storage or uncertain storage outcome. A 503,
transport timeout or lost response NEVER authorizes sending. Keep the same attempt
ID and inspect status; never blindly retry a phone send. Reader 202 may be polled
as documented above before claiming, but does not grant delivery permission.

### Supported scheduled recovery behavior

Use the deterministic original-submission attempt ID above on every status,
claim, begin and finalize request. Never automatically call cancel_before_send,
reclaim a reservation, or derive a replacement attempt generation.

- `reserved` with owned true: may call begin with the same deterministic ID.
  Only a response with sendGranted true permits one phone send. Concurrent or
  replayed begin calls cannot grant another permission.
- `sending` or `uncertain`: never resend. Inspect actual message history; only a
  positive accepted receipt can finalize. Missing/eventually consistent history
  is not proof of non-execution.
- `accepted`: suppress the notice.
- `confirmed_not_sent` or `blocked_other_attempt`: escalate for controlled
  reconciliation; do not cancel, reclaim, substitute another ID or send.
- Lost responses, storage/source errors or any unexpected state: no send
  permission. Retry status with the same ID and preserve uncertainty.

The generic API's optional cancel_before_send operation is retained for controlled
pre-send cancellation only; it is NOT part of the supported unattended consumer.
A new attempt after cancellation requires separate durable coordination and is
never selected automatically by the scheduled prompt.

### At-most-once tradeoff and reconciliation

D1 and phone delivery have no shared transaction. This design favors suppressing a
possible duplicate over retrying an uncertain send: lost begin responses or a
crash after permission may leave an alert unsent. Reservations never expire or
release on a timer. A delayed original sender must not race a replacement sender.
Only proven pre-begin cancellation can be automatically reused. Even a claimed
post-begin provider rejection cannot be released through this API; actual outcome
reconciliation is required. An eventually consistent history search showing no
message is insufficient. There is intentionally no automatic post-begin release
or arbitrary admin/SQL endpoint. If actual history establishes a positive receipt,
finalize; otherwise retain the block and escalate for controlled reconciliation.
