## Goal

Keep a single `todos-api` edge function (no changes to frontend callers, deployment, or latency-log labels), but refactor its internals so each operation lives in its own dedicated handler function instead of a giant `switch` block.

## Current state

`supabase/functions/todos-api/index.ts` is a ~300-line file with one `Deno.serve` containing a 12-case `switch` (`list`, `list_archived`, `count_archived`, `add`, `update`, `toggle_complete`, `remove`, `restore`, `delete_permanent`, `delete_all`, `bulk_insert`, `archive_completed`, `auto_transitions`). Auth, latency logging, and error handling are inlined around the switch.

## New internal structure (single file)

The file stays at `supabase/functions/todos-api/index.ts`. Reorganize it top-to-bottom into clear sections:

```text
1. Constants + CORS
2. Helpers: json(), authenticate(), logLatency()
3. Handler type:
     type Ctx = { db: SupabaseClient; userId: string; params: any };
     type Handler = (ctx: Ctx) => Promise<Response>;
4. One handler function per operation:
     async function listTodos(ctx)            { ... }
     async function listArchived(ctx)         { ... }
     async function countArchived(ctx)        { ... }
     async function addTodo(ctx)              { ... }
     async function updateTodo(ctx)           { ... }
     async function toggleComplete(ctx)       { ... }
     async function removeTodo(ctx)           { ... }
     async function restoreTodo(ctx)          { ... }
     async function deletePermanent(ctx)      { ... }
     async function deleteAll(ctx)            { ... }
     async function bulkInsert(ctx)           { ... }
     async function archiveCompleted(ctx)     { ... }
     async function autoTransitions(ctx)      { ... }
5. Action registry:
     const handlers: Record<string, Handler> = {
       list: listTodos,
       list_archived: listArchived,
       count_archived: countArchived,
       add: addTodo,
       update: updateTodo,
       toggle_complete: toggleComplete,
       remove: removeTodo,
       restore: restoreTodo,
       delete_permanent: deletePermanent,
       delete_all: deleteAll,
       bulk_insert: bulkInsert,
       archive_completed: archiveCompleted,
       auto_transitions: autoTransitions,
     };
6. Deno.serve dispatcher:
     - OPTIONS → CORS
     - authenticate(req) → { userId, db }
     - parse body, read action
     - lookup handlers[action]; 400 if unknown
     - await handler({ db, userId, params: body })
     - wrap in try/catch; logLatency in finally
```

## Behavior preserved

- Single deployed function name: `todos-api` (no edge function deletes/creates).
- Frontend call sites in `src/hooks/useTodos.ts` (15 sites), `src/components/Navbar.tsx` (4 sites), and the Admin chart color map remain untouched.
- All action names, request/response shapes, status codes, error envelope `{ error: message }`, batch sizes (500), CORS headers, and the 0.2 latency sampling rate are unchanged.
- `api_latency_logs` rows continue to be written with `function_name = "todos-api"` and the existing `action` field, so the Admin dashboard and latency stats are unaffected.

## Benefits

- Each operation is independently readable and testable as a named function.
- Adding a new operation = write one handler + add one entry to the registry, no `switch` editing.
- Cross-cutting concerns (auth, timing, error capture, latency logging) live in exactly one place — the dispatcher — instead of being repeated inside every `case`.
- No frontend or infra changes; zero deploy risk beyond the single function redeploy.

## Out of scope

- Splitting into multiple edge functions (rejected per this plan).
- Changing action names, payload shapes, or auth model.
- Touching other functions (`user-api`, `admin-api`, `images-api`, etc.).
