# Turf Time Dashboard

Internal sales pipeline and commission tracker for Turf Time. Tracks deals from sale through install through pay, calculates rep splits and override commissions, and shows weekly/monthly performance against goal.

## Stack

- **Frontend:** Vite + React + Tailwind, React Router, Recharts
- **Backend:** Supabase (Postgres + GoTrue auth + PostgREST + Storage), self-hosted
- **Hosting:** Everything on Railway

## Deploying

See [SETUP.md](./SETUP.md) for the full Railway deployment walkthrough.

## Local development (optional)

```bash
cp .env.example .env
# Fill in your VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Then open http://localhost:5173

## Roles

- **Rep** — sees own deals, own commissions
- **Manager** — sees their downline's deals, plus their override $
- **Director / VP** — sees everything in their org, plus their override $
- **Admin** — full access including user management

## Commission logic

See the bottom of [SETUP.md](./SETUP.md) for the full reference. Stored override percentages are decimals (`0.04` = 4%).
