## Security Update Plan

This plan addresses all current security findings: DEFINER function exposure, bulk insert field injection, CSV formula injection, unbounded bulk operations, weak landing-visit rate limiting, a latent bug in `has_role`, and missing landing_visits INSERT policy.

---

### Phase 1: Database Migration — Lock Down SECURITY DEFINER Functions

**Goal:** Prevent authenticated/anon users from directly executing admin-only or trigger-only SECURITY DEFINER functions via PostgREST.

**Actions:**
- Revoke `EXECUTE` from `PUBLIC`, `anon`, `authenticated` on all server-only functions.
- Grant `EXECUTE` to `service_role` only for functions called exclusively by edge functions.
- For `has_role`, keep `EXECUTE` for `authenticated` (required by RLS policies) but remove the redundant `_user_id = auth.uid()` guard that silently breaks server-side delegation checks.
- For `update_updated_at_column` (trigger-only), revoke from all direct callers.
- Add explicit INSERT deny policies on `landing_visits` for `anon` and `authenticated` to codify the intent that only the service-role edge function writes to this table.

**Affected functions:** `count_archived_todos`, `search_archived_todos`, `get_latency_stats`, `get_latency_timeseries`, `get_latency_overall_timeseries`, `purge_old_latency_logs`, `purge_old_landing_visits`, `compute_admin_stats`, `verify_cron_secret`, `get_landing_visit_stats`, `update_updated_at_column`, `has_role`.

---

### Phase 2: todos-api Edge Function — Input Validation & Resource Limits

**Goal:** Fix bulk insert field injection and unbounded ID array exhaustion.

**Actions:**
- **bulkInsert:** Replace `...t` spread with an explicit whitelist of user-writable fields: `text`, `category`, `tags`, `notes`, `urls`, `completed`, `completed_at`, `removed`, `removed_at`, `recurrence`. Reject any payload containing disallowed keys.
- **autoTransitions:** Add a `MAX_IDS = 1000` guard at the top. Replace per-ID sequential `UPDATE` loops with batched `.in('id', batch)` updates.
- **archiveCompleted & deletePermanent:** Add the same `MAX_IDS = 1000` guard before batching.

---

### Phase 3: Client-Side — CSV Formula Injection Fix

**Goal:** Neutralize spreadsheet formula injection in exported CSVs.

**Actions:**
- In `src/lib/exportCsv.ts`, prepend a tab character to any value starting with formula trigger characters (`=`, `+`, `-`, `@`, tab, carriage return) before applying CSV escaping.

---

### Phase 4: log-landing-visit Edge Function — Rate-Limit Hardening

**Goal:** Prevent distributed/cold-start bypass of the in-memory rate limiter.

**Actions:**
- Add a lightweight shared-secret header check (`X-Landing-Token`). The landing-page hook already runs client-side; it will be updated to pass a low-entropy HMAC derived from a static secret plus a daily salt. The edge function rejects requests missing the valid token.
- Keep the in-memory Map as a defense-in-depth layer.

---

### Phase 5: Security Memory Update

**Goal:** Document what was fixed and which risks are accepted.

**Actions:**
- Update the security memory to record that landing_visits is edge-function-only, that admin RPCs are now service-role-only, and that the client-side admin navigation guard is acceptable because RLS is the actual security boundary.

---

### Verification

After all changes:
1. Re-run the Supabase linter to confirm `0028` and `0029` findings are cleared.
2. Re-run the agent security scan to confirm all `warn`-level findings are resolved.
3. Test normal todo CRUD, CSV export, and admin dashboard loading to ensure no regressions.

### Risks Accepted (info level only)
- `admin_client_check`: The Admin page uses a client-side redirect for UX. RLS policies on all admin tables enforce the real boundary, so a non-admin cannot read or mutate admin data even if they bypass the client guard.