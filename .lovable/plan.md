## Fix: Suppress raw error messages in `log-landing-visit`

Replace the two error-leak paths in `supabase/functions/log-landing-visit/index.ts` with a generic `"Internal server error"` response, and log the actual error server-side via `console.error` for debugging.

### Changes

**`supabase/functions/log-landing-visit/index.ts`**
- DB insert failure (~line 143): log `error` with `console.error`, return `{ error: "Internal server error" }` with status 500.
- Outer `catch` block (~line 154): log `e` with `console.error`, return `{ error: "Internal server error" }` with status 500.

**`supabase/functions/log-landing-visit/index.test.ts`**
- Update the "returns 500 when DB insert fails" test to assert the response body is `{ error: "Internal server error" }` instead of containing the raw DB message.

### Verification
- Run `supabase--test_edge_functions` on `log-landing-visit`.
- Mark finding `landing_visit_err_msg` as fixed.
