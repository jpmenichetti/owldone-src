## Goal

Fix `addtodo_no_server_limits`: validate text, notes, tags, urls, category, and recurrence server-side in `supabase/functions/todos-api/index.ts`.

## Changes (single file)

Add a `validateTodoFields(fields, { requireText, requireCategory })` helper near the top of `supabase/functions/todos-api/index.ts`, then call it from `addTodo`, `updateTodo`, and `bulkInsert`.

### Limits

- `text`: required for addTodo, non-empty trimmed string, max **2000** chars
- `notes`: optional string, max **50000** chars
- `category`: must be one of `today | this_week | next_week | others`
- `tags`: array, max **50** items, each a string ≤ **100** chars
- `urls`: array, max **20** items, each a string ≤ **2000** chars
- `recurrence`: if present, must be one of `daily | weekly | monthly` (or null)
- `text` (on update): if present, same rules as add

On failure: `throw { status: 400, message: "<reason>" }` (handled by existing error path).

### Handler updates

- `addTodo`: validate `{ text, category }` with `requireText: true, requireCategory: true`.
- `updateTodo`: after building `updates`, run validation on whichever subset of fields is present.
- `bulkInsert`: validate each row (text + category required); also keep existing flow. Field whitelist hardening for `bulkInsert` is **out of scope** (separate finding `bulk_insert_field_inject`).

### Out of scope

- Array size cap for bulk operations (`unbounded_ids_arrays` finding)
- bulkInsert field whitelist (`bulk_insert_field_inject` finding)
- Client-side validation changes

## Verification

Deploy `todos-api` and confirm:
- Creating a todo with empty text → 400
- Creating with `category: "invalid"` → 400
- Updating with `notes` of 60000 chars → 400
- Normal create/update still works
