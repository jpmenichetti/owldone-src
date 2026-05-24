## Fix: Stop leaking raw database errors from edge functions

All edge function catch blocks currently return `e.message` to the client, which exposes Postgres error text (table names, column names, constraint names). The fix is to log the full error server-side and return a safe, generic message to the client — preserving explicit, intentional 4xx messages thrown by our own handlers (e.g. `{ status: 401, message: "Unauthorized" }`).

### Approach

Introduce a small helper used in every catch block:

```ts
const status = e?.status && Number.isInteger(e.status) ? e.status : 500;
const isClientError = status >= 400 && status < 500;
const safeMessage = isClientError
  ? (e?.message || "Bad request")
  : "Internal server error";
console.error(`[${FUNCTION_NAME}] error`, { action, status, error: e });
return json({ error: safeMessage }, status);
```

Rationale:
- Our handlers throw `{ status, message }` with intentional, safe messages (e.g. `"Unauthorized"`, `"Todo not found"`, `"File too large"`). Those remain visible to the client.
- Any other thrown error (Postgres errors from `throw error`, unexpected exceptions) becomes a generic `"Internal server error"` with HTTP 500. Full details still logged via `console.error` so they remain debuggable in edge function logs.

### Files to change

1. **`supabase/functions/todos-api/index.ts`** — replace the catch in `handleRequest` (line ~347).
2. **`supabase/functions/user-api/index.ts`** — replace the catch (line ~210).
3. **`supabase/functions/images-api/index.ts`** — replace the catch (line ~176).
4. **`supabase/functions/admin-api/index.ts`** — replace the catch (line ~227).
5. **`supabase/functions/process-recurring-tasks/index.ts`** — replace the catch (line ~141). This function has no user-facing client; always return generic `"Internal server error"` on 500.
6. **`supabase/functions/compute-stats/index.ts`** — replace the catch (line ~64). Same generic 500.
7. **`supabase/functions/generate-weekly-report/index.ts`** — replace the catch (line ~217). Same generic 500.

No changes to handler logic, no DB migrations, no config changes.

### Verification

- Deploy the 7 functions.
- `curl_edge_functions` to `todos-api` with no Authorization → expect `401 { error: "Unauthorized" }` (intentional message preserved).
- `curl_edge_functions` to `todos-api` with a malformed body that triggers a Postgres error → expect `500 { error: "Internal server error" }` (no schema leak); confirm details are present in edge function logs.
- Mark `raw_errors_to_client` finding as fixed.
