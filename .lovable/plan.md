## Goal

Let users reassign an existing task to a different workspace from the task detail panel.

## UX

In `TodoDetailDialog`, add a new "Workspace" section (below the header, near Tags) — only shown when:
- The `workspaces` feature is enabled AND the user has more than one workspace.
- The task is not read-only (archived tasks stay put).

Rendered as a compact `Select` dropdown labeled "Workspace" showing all workspaces of the user, with the current one preselected. Changing the selection immediately moves the task and shows a toast: "Moved to {workspace name}". The detail panel closes after a successful move (the task no longer belongs to the active workspace list).

## Frontend changes

- `src/components/TodoDetailDialog.tsx`
  - New prop `workspaces: Workspace[]` and `onMoveWorkspace: (id: string, workspaceId: string) => Promise<void>`.
  - Render the `Select` section as described. Show a small spinner while the mutation is pending.
- `src/hooks/useTodos.ts`
  - New `moveToWorkspace` mutation invoking `todos-api` action `move_workspace` with `{ id, workspace_id }`.
  - Optimistic update: remove the task from the current workspace's cached `todos` list.
  - On settle: invalidate `todos`, `archived-todos`, `workspace-overdue-counts`.
- `src/pages/Index.tsx` (or wherever `TodoDetailDialog` is rendered)
  - Pass `workspaces` from `useWorkspaces()` and wire `onMoveWorkspace` to the new mutation.
- Add translation keys `detail.workspace`, `detail.movedTo`, `detail.moveFailed` in `src/i18n/translations.ts` for all supported languages.

## Backend changes

- `supabase/functions/todos-api/index.ts`
  - New action `move_workspace` handler:
    1. Validate `id` and `workspace_id` (UUID).
    2. Confirm the target workspace belongs to the user (reuse `resolveWorkspaceId`).
    3. Confirm the todo belongs to the user; reject if already in that workspace.
    4. `UPDATE todos SET workspace_id = $target, updated_at = now() WHERE id = $id AND user_id = $user`.
  - Register handler in the action map.

## Tests

- `supabase/functions/todos-api/index.test.ts`: add cases for `move_workspace` — happy path, invalid target workspace (403), missing id (400), foreign todo (no row updated).
- Optional light unit test for the new mutation in the frontend is not required unless there's an existing pattern.

## Out of scope

- Moving archived tasks (kept read-only).
- Bulk move from list view.
- Recurrence chain reassignment (recurring source stays where it is; new instances continue to be created in the source's workspace — noted but not changed here).
