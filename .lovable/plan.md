## Fix: Authenticate `process-recurring-tasks` edge function

The `process-recurring-tasks` function runs with service-role credentials and mutates every user's todos, but accepts unauthenticated requests. I'll mirror the proven pattern already used in `generate-weekly-report`: accept either a valid `x-cron-secret` (validated against the `CRON_SECRET` vault entry via `verify_cron_secret`) or a service-role bearer token, and reject everything else with 401.

### Changes

**1. `supabase/functions/process-recurring-tasks/index.ts`**
- At the top of the handler (after CORS preflight), read `Authorization` and `x-cron-secret` headers.
- Compute `serviceRoleOk = bearer === SUPABASE_SERVICE_ROLE_KEY`.
- If `x-cron-secret` is provided, call `verify_cron_secret` RPC with a service-role client to validate it against the vault.
- If neither check passes, return `401 { error: "Unauthorized" }` with CORS headers.
- Leave the rest of the recurring-task processing logic unchanged.

**2. `supabase/config.toml`**
- No change needed. The function already deploys with `verify_jwt = false` by default, which is correct because we authenticate via cron secret / service-role bearer rather than user JWT (the scheduler is not a logged-in user).

### Why this approach

- Matches the existing, reviewed pattern in `generate-weekly-report` — same secret, same validation function, same failure mode.
- The cron job (pg_cron → pg_net) can keep calling the function by sending either the service-role key as bearer or the `x-cron-secret` header; whichever the existing scheduler uses will continue to work after I check which header the cron entry sends.
- No DB migration required: `CRON_SECRET` and `verify_cron_secret` already exist.

### Verification

- After implementing, call the function via `curl_edge_functions` with no auth → expect 401.
- Call with the service-role bearer → expect normal `{ processed: N }` response.
- Confirm the scheduled `pg_cron` job entry includes either the service-role key in `Authorization` or `x-cron-secret`; if it doesn't, update the cron job SQL to add the header so the schedule keeps working.
