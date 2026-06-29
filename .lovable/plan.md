## Problem
The per-workspace overdue badge in `WorkspaceTabs` doesn't refresh after task changes (toggle complete, edit category). The `workspace-overdue-counts` query only refetches on a 5-minute interval, on window focus, or full page reload. `toggleComplete` and `updateTodo` in `src/hooks/useTodos.ts` invalidate `["todos"]` but never touch `["workspace-overdue-counts"]`.

Note: new todos cannot be overdue upon creation, so `addTodo` does not need this update.

## Constraint
Invalidation/refresh must only touch the workspace whose tasks actually changed — not the counts for unrelated workspaces.

## Fix
The counts query stores a single `Record<workspaceId, number>` under key `["workspace-overdue-counts", userId]`. Instead of invalidating the whole entry (which refetches every workspace), patch only the affected workspace's slot in the cache.

In `src/hooks/useTodos.ts`, after `toggleComplete` and `updateTodo` settle:

1. Read the current todos list cache for `activeWorkspaceId` (these mutations always act on the active workspace).
2. Recompute the overdue count locally using the existing `isOverdue` helper (`completed === false`, category `today`/`this_week`, evaluated in UTC, matching the backend logic).
3. `queryClient.setQueryData(["workspace-overdue-counts", user?.id], (prev) => ({ ...(prev ?? {}), [activeWorkspaceId]: newCount }))`.

This updates only the affected workspace's badge, leaves every other workspace's cached count untouched, and avoids a network round-trip.

Add a small helper `recomputeActiveOverdueCount()` inside the hook so both mutations share the logic. The existing 5-minute background `refetchInterval` and window-focus refetch in `useWorkspaceOverdueCounts` continue to reconcile any drift across workspaces.

## Out of scope
No backend or UI changes. The overdue computation in `user-api` and the badge rendering in `WorkspaceTabs` are correct — only client-side cache maintenance is missing.