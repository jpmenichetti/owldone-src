## Goal

Show a small numeric badge next to each workspace tab indicating the count of overdue tasks in that workspace, so users can spot overdue work in workspaces they aren't currently viewing.

## Definition of "overdue" (server side, UTC)

Matches `isOverdue` in `src/hooks/useTodos.ts` but evaluated in UTC (consistent with the new server lifecycle):
- not completed AND not removed
- category `today`: created on an earlier UTC day than now
- category `this_week`: now > Sunday 23:59:59 UTC of the created week
- `next_week` / `others`: never overdue

## Backend

**`supabase/functions/user-api/index.ts`** — add new action `list_workspace_overdue_counts`:
- Auth: existing user JWT.
- Single query: `select workspace_id, category, created_at from todos where user_id = $user and removed = false and completed = false and category in ('today','this_week')`.
- Group/reduce in TS using inlined UTC `endOfWeek` / `isAfterDay` helpers.
- Return `{ counts: Record<string, number> }` keyed by workspace_id.

Add Deno tests asserting:
- Overdue today (yesterday UTC) counted.
- Same-day today not counted.
- Overdue this_week (last week UTC) counted.
- `next_week` and completed items ignored.

## Frontend

1. **New hook** `src/hooks/useWorkspaceOverdueCounts.ts`
   - `useQuery(["workspace-overdue-counts", userId], …)` calling `user-api` action `list_workspace_overdue_counts`.
   - Refetch on window focus and every 5 min.
   - Invalidated by todo mutations: add `queryClient.invalidateQueries({ queryKey: ["workspace-overdue-counts"] })` inside the existing `invalidateAll()` in `useTodos.ts`.

2. **`src/components/WorkspaceTabs.tsx`**
   - Consume the hook.
   - For each workspace tab, if `count > 0` render a small numeric `Badge` (destructive variant, compact: `text-[10px] px-1 py-0 min-w-[1.25rem] h-4 leading-none`) inside the existing button, after the name. **Number only — no "overdue" word.** Hidden when count is 0.
   - Accessible label: append ` (N overdue)` to the tab's aria-label so screen readers still convey meaning even though the visible badge is just a number.

3. **i18n** — add a single key `workspace.overdueAria` = "{count} overdue" used only for the aria-label (not displayed).

## Out of scope

- Per-user timezone (UTC consistent with backend lifecycle decision).
- Overdue badge on the workspace dropdown menu items or on the "+" button.
- Caching across sessions / push updates — react-query refetch is sufficient.

## Technical notes

- One round-trip on app load, cheap query (indexed on user_id).
- Encapsulated in the existing `user-api` edge function per the project's "backend logic exclusively via Edge Functions" rule.
- Helpers (`endOfWeekUTC`, `isAfterDayUTC`) already exist in `process-lifecycle-transitions`; duplicate the few lines inside `user-api` rather than cross-import (per edge-function self-containment convention).
