## Goal

Detect when someone lands on the OwlDone home page (`/`) from Google — either a Google Ads click (`?gclid=...`) or an organic Google search result (referrer `google.com`) — log the visit to the database, and show the data in a new panel inside the existing Admin dashboard.

## What gets built

### 1. New table: `landing_visits`

Stores one row per Google-originated landing event.

Columns (domain-specific):
- `source` — `'google_ads'` or `'google_organic'`
- `landing_path` — the URL path the user landed on (e.g. `/`)
- `gclid` — Google Ads click ID when present
- `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` — captured if present in the URL
- `referrer` — full document.referrer
- `user_agent`, `language`
- `country` — best-effort from `Accept-Language` / IP (optional, may be null)
- `user_id` — set if the visitor is already logged in, otherwise null

RLS:
- Anonymous + authenticated users **cannot** read this table
- Only admins (via `has_role`) can read
- Inserts happen exclusively through an edge function with the service role, so no public insert policy needed

Index on `created_at DESC` and on `source` for fast filtering.

### 2. Edge function: `log-landing-visit`

- Public (no JWT required) so anonymous visitors can log
- Validates body with Zod
- Basic rate limit: in-memory token bucket per IP to prevent log spam
- Inserts a row using the service role
- Returns `{ ok: true }` quickly; no PII beyond what was sent

### 3. Frontend trigger

A small hook `useTrackGoogleLanding` mounted once in `src/pages/Index.tsx`:
- On mount, parse `window.location.search` for `gclid` and `utm_*`
- Check `document.referrer` for `google.` host
- If either signal is present, fire the edge function **once per session** (guard with `sessionStorage` flag) so reloads don't double-count
- Fully fire-and-forget (no UI impact, no blocking)

### 4. Admin panel: "Google Traffic"

New section in `src/pages/Admin.tsx`:
- **Summary stat cards** (last 7 / 30 days): total Google visits, Ads clicks, Organic visits, unique campaigns
- **Time range filter**: 24h / 7d / 30d / custom
- **Source filter**: All / Google Ads / Organic
- **Visits table** (paginated, 50/page): timestamp, source badge, campaign, gclid (truncated), referrer, landing path
- Powered by a new edge function `admin-landing-visits` (or extend `admin-api`) that admin-checks then returns aggregates + paginated rows

## Privacy notes

- No IP address stored; only `Accept-Language`-derived country
- Data is admin-only via RLS
- Log entries auto-purge after 90 days via a scheduled cron (mirrors `purge_old_latency_logs`)

## Out of scope

- Google Analytics / Google Ads conversion tag (user chose in-app log)
- Tracking visits from non-Google sources
- Per-user attribution beyond the optional `user_id` snapshot at landing time

## Technical details

```text
visitor → / ?gclid=abc → useTrackGoogleLanding
                       → POST /functions/v1/log-landing-visit
                       → insert into landing_visits (service role)

admin   → /admin "Google Traffic" tab
        → GET admin-api?action=landing_visits&range=7d
        → admin check + aggregate + page query
        → render cards + table
```

Files touched:
- `supabase/migrations/*` — new table, RLS, index, purge function, cron
- `supabase/functions/log-landing-visit/index.ts` — new
- `supabase/functions/admin-api/index.ts` — add `landing_visits` action
- `src/hooks/useTrackGoogleLanding.ts` — new
- `src/pages/Index.tsx` — mount the hook
- `src/pages/Admin.tsx` — new "Google Traffic" section