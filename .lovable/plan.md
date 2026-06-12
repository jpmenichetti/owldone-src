## Goal

Replace the client-side auto-archive/transition logic with a backend cron job that evaluates lifecycle rules globally (every workspace, every user) on a fixed schedule, using UTC day/week boundaries.

## Backend

1. **New edge function** `supabase/functions/process-lifecycle-transitions/index.ts`
   - Auth: same pattern as `process-recurring-tasks` (`x-cron-secret` via `verify_cron_secret`, or service-role bearer).
   - Loads all non-archived todos in batches (`removed = false`), using service role to bypass RLS.
   - Applies the same rules currently in `src/lib/lifecycle.ts`, but in UTC:
     - completed `today` → archive once UTC date > completed UTC date
     - completed `this_week` / `next_week` → archive after Sunday 23:59:59 UTC of the completed week
     - uncompleted `next_week` → move to `this_week` after Sunday 23:59:59 UTC of created week
     - `others` and uncompleted today/this_week → untouched
   - Batches updates (chunked `UPDATE ... WHERE id IN (...)`) for `removed=true, removed_at=now()` and `category='this_week'`.
   - Returns `{ archived, moved }` counts.

2. **Shared rule helpers** ported into the function file (kept self-contained per edge-function convention; no cross-function imports). Pure functions kept identical in shape to `computeTransitions` so the existing unit tests still describe the logic.

3. **Cron schedule** via `supabase--insert` running `cron.schedule(...)` to call the function hourly with `x-cron-secret`. Follows the exact pattern documented for scheduled functions (anon key + project URL embedded so it isn't a portable migration).

4. **Tests** `supabase/functions/process-lifecycle-transitions/index.test.ts`
   - Unauthorized request → 401.
   - With cron secret + seeded todos in multiple workspaces → correct ids archived/moved, others untouched.
   - UTC boundary cases: Sunday rollover, same-day completion not archived.

## Frontend

1. **`src/hooks/useTodos.ts`**
   - Remove `autoArchiveMutation` and the `useEffect` that calls it (lines ~53–81).
   - Drop the `computeTransitions` / `endOfWeek` / `isAfterDay` imports where only used for real-time transitions.
   - Keep `endOfWeek` / `isAfterDay` usage that powers the **simulated-time virtual views** (Time Travel) and `isOverdue` — those remain client-side and unchanged.

2. **`todos-api` edge function**
   - Keep the `auto_transitions` action for now (used by simulated mode reconciliation if any). If unused after frontend change, remove it in the same pass. Will verify via `rg` during build.

3. **`src/lib/lifecycle.ts`** stays — still used for simulated views, overdue detection, and as the spec the backend test mirrors.

## Out of scope

- Per-user timezone support (explicitly deferred; UTC is acceptable per user decision).
- Changing simulated-time / Time Travel behavior.
- Touching recurrence cron.

## Technical notes

- Cron registration uses `supabase--insert` (not migration) because it embeds project-specific URL/anon key.
- Service-role client is required so the function can write across all users without RLS friction.
- Process in pages of e.g. 1000 todos to keep memory bounded; current row counts make a single pass fine, but pagination keeps it safe as data grows.
- Memory file `mem://features/lifecycle-automation` will need a follow-up note that transitions are server-driven hourly in UTC (done after implementation).
