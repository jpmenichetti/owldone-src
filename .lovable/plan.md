## Fix: Whitelist allowed fields in `updateTodo`

**File:** `supabase/functions/todos-api/index.ts` (handler `updateTodo`, ~line 174)

### Problem
`updateTodo` spreads the entire request body into the SQL UPDATE via a service-role client. An attacker can include `user_id` (or any other column) in the payload to reassign their own todo to another user, injecting arbitrary content into the victim's list.

### Change
Replace the spread with an explicit whitelist of editable columns. Only pick known-safe fields, drop `undefined` values so partial updates still work, and reject the request if nothing valid remains.

```ts
const ALLOWED_UPDATE_FIELDS = [
  "text", "category", "tags", "notes", "urls",
  "completed", "completed_at",
  "removed", "removed_at",
  "recurrence", "next_recurrence_at",
] as const;

export async function updateTodo({ db, userId, params }: Ctx): Promise<Response> {
  const { id } = params;
  if (!id) throw { status: 400, message: "Missing id" };

  const updates: Record<string, unknown> = {};
  for (const key of ALLOWED_UPDATE_FIELDS) {
    if (params[key] !== undefined) updates[key] = params[key];
  }
  if (Object.keys(updates).length === 0) {
    throw { status: 400, message: "No valid fields to update" };
  }

  const { error } = await db
    .from("todos")
    .update(updates)
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  return json({ success: true });
}
```

This guarantees `user_id`, `id`, `created_at`, `updated_at`, `recurring_source_id`, etc. cannot be overwritten through this endpoint, even if a client sends them.

### Verification
1. Deploy `todos-api` edge function.
2. Existing todo edits from the UI (text, category, tags, notes, urls, complete, archive, recurrence) continue to work.
3. Manual curl with `{ id, action: "update", user_id: "<other-uuid>", text: "x" }` no longer reassigns ownership — `user_id` is silently ignored, only `text` is updated, and only if the row belongs to the caller.
4. Mark the `update_todo_field_inject` finding as fixed.

### Out of scope
The second finding (`process-recurring-tasks` missing auth) is not addressed here — handle it in a separate plan if desired.
