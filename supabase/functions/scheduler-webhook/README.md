# scheduler-webhook

Receives Outside Sales jobs from the install scheduler (Apps Script) and upserts
them into `deals`. Implements the scheduler spec: `POST` JSON, optional
`Authorization: Bearer <secret>`, upsert on `proposalId`, returns 200.

## URL
```
POST {SUPABASE_URL}/functions/v1/scheduler-webhook
e.g. https://kong-production-8249.up.railway.app/functions/v1/scheduler-webhook
```

## Secrets to set on the function
- `SCHEDULER_WEBHOOK_SECRET` — a random string; the scheduler sends it as
  `Authorization: Bearer <secret>`. (Optional but recommended.)
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically by
  Supabase to Edge Functions.

## Field mapping
| webhook field   | deal column        |
|-----------------|--------------------|
| proposalId      | project_id (upsert key) |
| dealName        | deal_name          |
| office          | office             |
| paymentMethod   | payment_method (`Self Pay`→`Self-Pay`) |
| setter / closer | setter_id / closer_id (matched by name) |
| saleDate        | sale_date          |
| installDate     | install_date (+ pay_date computed) |
| baselinePrice   | baseline_revenue   |
| totalJobPrice   | job_price          |
| (new deals)     | status = "Deal Review" |

On a repeat send (reschedule / change order) only the scheduler-owned facts are
updated; status, setter/closer, splits, overrides, notes, and checklist set in
the dashboard are preserved.

## Deploy (hosted Supabase / CLI)
```
supabase functions deploy scheduler-webhook --no-verify-jwt
supabase secrets set SCHEDULER_WEBHOOK_SECRET=<random-string>
```
`--no-verify-jwt` is required because the scheduler authenticates with our own
shared secret, not a Supabase user JWT.

## Self-hosted (Railway) note
Requires the Supabase **edge-runtime** (functions) service to be running and
routed at `/functions/v1/*` by Kong. If your stack doesn't have it, either add
it, or use the no-endpoint fallback (scheduler POSTs straight to the REST
upsert) — see the chat/handoff notes.
