# Turf Time Dashboard — Railway-Only Deployment Guide

Everything in this app runs on **Railway**. No external services, no local installs required after initial setup. Railway hosts:

1. **Self-hosted Supabase stack** (Postgres, Auth/GoTrue, PostgREST, Storage, Studio, Kong API gateway)
2. **The Vite/React frontend** in this repo

By the end of this guide you'll have a public URL where your team logs in.

---

## What you need before starting

- A [Railway](https://railway.app) account (free tier works to start)
- This repo pushed to your own GitHub account (Railway deploys from GitHub)
- A password manager or secure notes app — you'll generate several secrets

That's it. No local Node, no terminal, no Supabase CLI.

---

## Step 1 — Deploy Supabase on Railway

1. Log in to [railway.app](https://railway.app)
2. Click **New Project** → **Deploy from Template**
3. Search **"Supabase"** and pick the official Supabase template (provisions Postgres, GoTrue auth, PostgREST, Storage, Studio, and Kong)
4. Set the template variables when prompted:
   - `POSTGRES_PASSWORD` — a strong password (save it)
   - `JWT_SECRET` — a long random string, 32+ characters (save it)
   - `ANON_KEY` and `SERVICE_ROLE_KEY` — generate from your `JWT_SECRET` using the [Supabase JWT key generator](https://supabase.com/docs/guides/self-hosting#api-keys) (save both)
   - `SITE_URL` — leave as default; we'll update it in Step 5
5. Click **Deploy**. Wait 3–5 minutes for all services to come online.

---

## Step 2 — Generate public URLs for Kong and Studio

Inside your Railway project:

1. Click the **Kong** service → **Settings** → **Networking** → **Generate Domain**
   - This public URL is your `VITE_SUPABASE_URL`. **Save it.**
2. Click the **Studio** service → **Settings** → **Networking** → **Generate Domain**
   - This is the Supabase admin UI you'll use in the next step.

---

## Step 3 — Run the database migrations in Studio

1. Open the **Studio** URL from Step 2
2. Go to **SQL Editor** (left sidebar) → **New query**
3. Run each migration file in order. For each one: open the file in your GitHub repo, copy all contents, paste into the SQL editor, click **Run**.

   - **Migration 1 — Schema:** `supabase/migrations/001_schema.sql`
   - **Migration 2 — Row Level Security:** `supabase/migrations/002_rls.sql`
   - **Migration 3 — Seed Data:** `supabase/migrations/003_seed.sql`

✅ This creates the Turf Time roster (Keaton, Garrison, 5 managers, reps under each) plus the May 2026 baseline goal.

---

## Step 4 — Create login accounts

The seed file populates the `profiles` table but doesn't create the `auth.users` records GoTrue needs for login. The schema includes a trigger that auto-links any new auth user to the matching profile by email — so all you need to do is create the auth users.

1. In Studio, go to **Authentication** → **Users** → **Add user** → **Create new user**
2. For each person in the roster, enter:
   - Their email (must match exactly what's in `003_seed.sql`)
   - A starting password (e.g. `TurfTime2026!` — they can change it later)
   - Check **Auto-confirm user**
3. The trigger automatically sets `auth_id` on the matching profile. No manual linking needed.

**Verify the link worked.** Run this in the SQL editor:

```sql
SELECT name, email, role, auth_id FROM profiles ORDER BY role, name;
```

Every row should have an `auth_id`. If any are null after creating their auth user, run the bulk-link as a fallback:

```sql
UPDATE profiles p
SET auth_id = a.id
FROM auth.users a
WHERE lower(a.email) = lower(p.email)
  AND p.auth_id IS NULL;
```

**Roster to create accounts for:**

| Email | Role |
|---|---|
| keaton@turftime.com | VP |
| garrison@turftime.com | Director |
| jared@turftime.com | Manager |
| danny@turftime.com | Manager |
| colt@turftime.com | Manager |
| jordan@turftime.com | Manager |
| conner@turftime.com | Manager |
| stephen@turftime.com, charlieh@turftime.com | Rep (Jared) |
| marc@turftime.com | Rep (Danny) |
| tylerm@turftime.com | Rep (Colt) |
| jeremy@, mattj@, codym@, johnk@, dayton@turftime.com | Rep (Jordan) |
| caleb@, jc@, ricky@, bryan@turftime.com | Rep (Conner) |
| casey@, seth@turftime.com | Rep (unmanaged) |
| admin@turftime.com | Admin |

---

## Step 5 — Deploy the frontend on Railway

1. In the **same Railway project** (the one running Supabase), click **+ New** → **GitHub Repo**
2. Select this repository and the branch you want to deploy (usually `main`)
3. Railway detects `railway.json` and runs:
   - **Build:** `npm ci && npm run build`
   - **Start:** `npm start` (which runs `serve -s dist -l $PORT`)
4. In the new service's **Variables** tab, add:
   - `VITE_SUPABASE_URL` → your Kong public URL from Step 2
   - `VITE_SUPABASE_ANON_KEY` → your `ANON_KEY` from Step 1
5. Go to **Settings** → **Networking** → **Generate Domain** to get a public frontend URL
6. Trigger a redeploy so the env vars get baked into the Vite build (Vite reads env vars at build time, not runtime)
7. Open the frontend URL and sign in with one of the accounts from Step 4 — you're live 🎉

---

## Step 6 — Tighten Supabase auth settings

Back in the Supabase Kong service variables on Railway:

- `SITE_URL` → your frontend Railway domain from Step 5
- `ADDITIONAL_REDIRECT_URLS` → same URL (needed if you ever add OAuth or magic links)

Redeploy Kong after saving.

---

## Commission logic reference

| Scenario | Setter gets | Closer gets |
|---|---|---|
| Setter = Closer | 100% of (Job Price − Baseline) | — |
| Setter ≠ Closer | 50% | 50% |

- **Manager Override $** = Baseline × Manager Override %
- **Director Override $** = Baseline × Director Override %
- **VP Override $** = Baseline × VP Override %
- **Commission %** = (Setter + Closer take) ÷ Baseline × 100
- **Outstanding $** = My Commission − Total Paid to Me

---

## Role permissions

| Page | Rep | Manager | Director | VP | Admin |
|---|---|---|---|---|---|
| Deals (own) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Deals (team) | ❌ | ✅ | ✅ | ✅ | ✅ |
| Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| Commissions | ✅ | ✅ | ✅ | ✅ | ✅ |
| Team | ❌ | ✅ | ✅ | ✅ | ✅ |
| Admin Panel | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## Troubleshooting

- **Frontend builds but env vars are empty in browser** — Vite bakes env vars at build time. After changing `VITE_*` variables in Railway, click **Deploy** → **Redeploy** to rebuild.
- **CORS errors when frontend calls Supabase** — Confirm Kong allows your frontend's Railway domain. Check the Kong service's CORS env vars.
- **"Invalid login credentials"** — The auth user exists but isn't linked to the `users` table row. Re-run the bulk-link query from Step 4B.
- **User logs in but the app shows a spinner forever** — Same root cause as above: `auth_id` is missing or doesn't match. Check the `users` table.
- **`npm ci` fails on Railway** — Make sure `package-lock.json` is committed to the repo alongside `package.json`.
- **Studio domain works but SQL editor fails** — Studio needs the `SERVICE_ROLE_KEY` env var set correctly. Re-check it in the Studio service variables.

---

## Adding new users later

When a new rep joins:

1. **Studio → Table Editor → `profiles` → Insert row** with their name, email, role, `manager_id`, `director_id`, `vp_id`
2. **Studio → Authentication → Users → Add user** with the same email and a temp password
3. The auto-link trigger connects them. Done.

(Order matters: profile first, then auth user. The trigger runs on auth-user insert and looks for a matching profile.)
