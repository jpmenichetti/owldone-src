## Goal

Premium users can split their tasks across multiple workspaces (e.g. "Work" and "Personal"). Each workspace has its own todos, archive, and weekly reports. Tags remain shared across all workspaces. Filters apply only to the active workspace. Non-premium users see no workspace UI; their data lives in a single implicit workspace.

## Data model

New `workspaces` table:
- `id`, `user_id`, `name`, `is_default boolean`, `position int`, `created_at`, `updated_at`
- Unique `(user_id, name)`; partial unique to ensure one default per user
- RLS: owner-only CRUD; grants for authenticated + service_role

Add `workspace_id uuid` to `todos` and `weekly_reports`:
- Nullable initially, backfilled to each user's default workspace, then set `NOT NULL`
- Index on `(user_id, workspace_id)` for both tables

Backfill migration:
1. Create one default workspace per existing user named "My tasks"
2. Update all their `todos` and `weekly_reports` to reference it
3. Set columns `NOT NULL`

Tags stay on the `todos` table (no change) → naturally shared across workspaces for a user.

Filters (`user_filters`): keep table as-is but scope per workspace. Simplest: add nullable `workspace_id`, make uniqueness `(user_id, workspace_id)`. Non-premium uses `workspace_id = default`.

Feature flag: new `workspaces` entry in `user_features` (no schema change — uses existing flag system).

## Backend (edge functions)

`user-api`: add actions
- `list_workspaces`, `create_workspace` (enforces 5-workspace cap + checks `workspaces` feature flag), `rename_workspace`, `delete_workspace` (blocks deleting default / last one; cascades reports + archive cleanup decision: hard-delete its todos+reports), `set_default_workspace`
- Update `get_filters` / `upsert_filters` to accept optional `workspace_id`

`todos-api`: every handler that filters by `user_id` also accepts and filters by `workspace_id` (resolved server-side; falls back to user's default when omitted). New todos inherit the active workspace. `delete_tag` stays user-wide (tags are shared).

`generate-weekly-report`: scope to a workspace (`workspace_id` param required in manual mode, defaults to user's default). Store `workspace_id` on the report row. `get_weekly_reports` filters by workspace.

`images-api`: no change (joins through `todos.user_id`).

All workspace ownership checks done server-side using service role + explicit `user_id` match — never trust client.

## Frontend

New `useWorkspaces` hook + `WorkspaceContext` providing `workspaces`, `activeWorkspaceId`, `setActiveWorkspaceId` (persisted to localStorage), and CRUD mutations. Gated by `hasFeature("workspaces")`; when disabled, context returns a single implicit default workspace and hides UI.

`WorkspaceTabs` component rendered above the category grid in `Index.tsx`:
- Tabs for each workspace + "+" button to create (up to 5) + per-tab menu (rename, set default, delete)
- Only rendered when `hasFeature("workspaces")` and workspaces.length > 0
- Switching tabs updates context → all queries re-fetch (workspace id baked into query keys)

Wire `workspace_id` through:
- `useTodos` (all queries + mutations), `useWeeklyReports`, `useFilters` — all keyed on `activeWorkspaceId` and pass it to edge functions
- `addTodo` always uses active workspace
- Drag/drop, archive, restore, search, CSV import/export all stay within active workspace

Tag list (`allTags` in `Index.tsx`) keeps pulling from all todos/archive returned (which is now scoped) — to keep tags truly global, add a new lightweight `user-api` action `list_all_tags` returning distinct tags across all workspaces; `FilterBar` consumes that.

CSV import: imported rows go into the active workspace. CSV export already scopes by current view.

## Access control

- `workspaces` feature flag in `user_features`; admin can grant via existing Admin UI (already supports arbitrary feature names).
- Without the flag: only the implicit default workspace exists; backend `create_workspace` returns 403 when flag missing; UI hides tabs and never sends `workspace_id`.

## i18n

Add strings for: workspace tabs, create/rename/delete dialogs, "default workspace", confirmation copy, upsell-free hidden state.

## Out of scope

- Sharing workspaces with other users (project is personal productivity)
- Moving tasks between workspaces (can add later; for now, deletion of a workspace hard-deletes its contents after confirmation)
- Per-workspace colors/icons

## Verification

- New migration runs cleanly; existing data backfilled into "My tasks"
- Non-premium user: UI unchanged, all CRUD still works
- Premium user: can create up to 5 workspaces, switch tabs, todos/archive/reports isolate, tags shared
- Filters persist per workspace
- `bunx vitest run` for affected edge-function tests; add tests for workspace handlers + workspace scoping on todos/reports
