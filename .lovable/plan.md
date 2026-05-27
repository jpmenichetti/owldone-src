## Expand todos-api Tests — Edge Cases

Add edge-case tests to `supabase/functions/todos-api/index.test.ts` covering the validation and resource-limit logic added in the recent security pass. No production code changes.

### New tests

**`addTodo` / `validateTodoFields`**
- Rejects missing/empty/whitespace-only `text` with status 400.
- Rejects `text` longer than 2000 chars.
- Rejects unknown `category` (e.g. `"someday"`) with 400.
- Rejects `notes` longer than 50000 chars.
- Rejects `tags` array longer than 50 items, and any tag string > 100 chars.
- Rejects `urls` array longer than 20 items, and any url string > 2000 chars.
- Rejects invalid `recurrence` (e.g. `"yearly"`); accepts `null`.

**`updateTodo`**
- Throws 400 when `id` is missing.
- Throws 400 when no whitelisted fields are present.
- Silently drops non-whitelisted keys (e.g. `user_id`, `id` in body, arbitrary `foo`) — DB update only receives allowed fields.
- Runs validation on supplied fields (e.g. invalid category in update is rejected).

**`bulkInsert`**
- Rejects non-array `todos` with 400.
- Rejects > 2000 todos with 400.
- Validates each item (one bad item fails the whole call).
- Whitelist drops injection attempts: `id`, `created_at`, `updated_at`, `next_recurrence_at`, `recurring_source_id` never reach the DB row.
- `user_id` from the request body is always overridden by the auth userId.

**`deletePermanent` / `archiveCompleted`**
- Reject non-array `ids` with 400.
- Reject > 1000 ids with 400.

**`autoTransitions`**
- Rejects > 1000 ids in either array with 400.
- For > 500 ids, splits into batched `.in('id', batch)` updates (no per-id round trips).
- Skips the category-move branch when `idsToMoveToThisWeek` is undefined.

### Out of scope

- Auth/JWT flow (covered by integration; handlers receive `userId` directly).
- CSV / landing-token tests (frontend/edge functions outside todos-api).

### Verification

Run `supabase--test_edge_functions` on `todos-api` and confirm all new + existing tests pass.