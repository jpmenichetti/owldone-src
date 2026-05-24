## GitHub Issue #10 — Persist view state in the URL

### Problem
Opening a todo for editing is local component state only. Refreshing the page (or sharing the URL, or hitting back) loses the open detail panel and drops the user back to the plain list. The issue author calls this out specifically for the "edit a todo" view.

### Scope
Persist the **selected todo** in the URL via a query parameter. On load, if the parameter is present, open the detail panel for that todo automatically. Closing the panel removes the parameter. Filters and other UI state are out of scope for this change (filters are already persisted server-side per the existing persistent-filtering feature).

### Approach
Use React Router's `useSearchParams` in `src/pages/Index.tsx` to drive `selectedTodo` from a `?todo=<id>` query string.

```text
/                   → no panel open
/?todo=abc-123      → detail panel open for todo abc-123 (edit mode)
/?todo=abc-123&ro=1 → detail panel open in read-only mode (archived items)
```

### Changes — `src/pages/Index.tsx`

1. Replace the `selectedTodo` / `dialogReadOnly` `useState` with values derived from `useSearchParams`:
   - `todoId = searchParams.get("todo")`
   - `dialogReadOnly = searchParams.get("ro") === "1"`
2. Compute `liveTodo` by looking up `todoId` in `[...todos, ...archived]` (same as today, just keyed off the URL id).
3. Update `openTodo(todo, readOnly)` to call `setSearchParams` with `{ todo: todo.id, ...(readOnly ? { ro: "1" } : {}) }` using `replace: false` so back/forward works.
4. `onClose` for the dialog deletes both `todo` and `ro` params via `setSearchParams`.
5. Keep the existing temp→real ID swap effect, but instead of `setSelectedTodo(match)` it calls `setSearchParams` with the real id (`replace: true`, so the optimistic temp id is not left in browser history).
6. Open the panel only once todos have loaded and the id resolves — if `todoId` is set but no matching todo exists after loading completes, silently clear the param (handles deleted/invalid ids).

### Out of scope
- Persisting filters, search text, archive expansion, or scroll position. Filters already persist via the user's saved settings; URL-syncing them can be a follow-up.
- Deep-linking to a specific tab inside the detail dialog.
- Changing route shape (e.g. `/todo/:id`) — query param keeps the change minimal and avoids new routes.

### Verification
1. Open a task → URL becomes `/?todo=<id>`. Refresh → same task reopens automatically.
2. Open an archived task from the archive list → URL is `/?todo=<id>&ro=1`. Refresh → reopens in read-only mode.
3. Close the dialog → params removed, URL is `/`.
4. Browser back after opening a task closes the dialog; forward reopens it.
5. Open a task, edit text, close → no `todo` param remains and the new text is persisted.
6. Manually visit `/?todo=does-not-exist` → after todos load, panel does not open and the param is cleared.
7. Optimistic add → open immediately → temp id is replaced in the URL by the real id once the server responds, without adding a history entry.
