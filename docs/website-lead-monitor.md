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
