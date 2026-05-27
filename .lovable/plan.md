## Add URL Protocol Allowlist to todos-api

Harden `validateTodoFields` in `supabase/functions/todos-api/index.ts` so the server rejects non-http(s) URLs, matching the existing client UI and CSV importer guards.

### Change

In `validateTodoFields`, inside the existing `f.urls` loop, parse each URL and require `http:` or `https:`:

```ts
const ALLOWED_URL_PROTOCOLS = ["http:", "https:"];
for (const u of f.urls) {
  if (typeof u !== "string" || u.length > LIMITS.urlLen) bad("Invalid url value");
  let parsed: URL;
  try { parsed = new URL(u); } catch { bad("Invalid url value"); }
  if (!ALLOWED_URL_PROTOCOLS.includes(parsed.protocol)) bad("URL must use http or https");
}
```

This runs on every `add`, `update`, and `bulk_insert` path that goes through `validateTodoFields`, blocking `javascript:`, `data:`, `file:`, etc. before they reach the DB.

### Tests

Add cases to `supabase/functions/todos-api/index.test.ts`:
- `addTodo` rejects `javascript:alert(1)` in `urls` with 400.
- `addTodo` rejects `data:text/html,...` with 400.
- `addTodo` rejects malformed strings like `"not a url"` with 400.
- `updateTodo` rejects bad-protocol URL in `urls`.
- `bulkInsert` rejects when any item has a bad-protocol URL.
- Happy path: `http://example.com` and `https://example.com` still accepted.

### Verification

Run `supabase--test_edge_functions` on `todos-api` and confirm new + existing tests pass.

### Out of scope

- The two unrelated findings on this view (`todo_images.user_id` column, `user_roles` admin self-grant) — separate plans if you want them addressed.
