## Allow tag deletion from the Tags filter popover

GitHub issue #19: Users need a way to remove a tag from every task (and from the system) directly from the "Tags" button in the filter control.

### UX

In `FilterBar`'s tags popover, each tag chip gets a small `x` button on the right side. Clicking the `x` (not the chip body):

1. Opens a confirmation `AlertDialog`: "Remove tag '{tag}' from all tasks? This will delete the tag from every active and archived task and cannot be undone."
2. On confirm: the tag is stripped from every todo (active + archived) of the current user, removed from `selected_tags` if present, and the popover updates. Toast on success/failure (localized).
3. Clicking the chip body keeps current behavior (toggle as filter).

### Backend

**New action `delete_tag` in `supabase/functions/todos-api/index.ts`:**
- Params: `{ tag: string }` (validated: non-empty string, ≤ `LIMITS.tagLen`).
- Fetches all todos for `userId` (active + archived) where `tags @> ARRAY[tag]` using `.contains('tags', [tag])`.
- For each matching row, updates `tags` to the array with the tag filtered out. Done in a single batched loop (chunks of 500) using individual updates — Postgres array remove via `array_remove` isn't reachable through PostgREST `.update()`, so we read+write the filtered array per row. Acceptable given typical tag cardinality.
- Returns `{ success: true, affected: <count> }`.
- Registered in the `handlers` map.

No DB migration needed — RLS already scopes by `user_id` and we use the service client filtered by `userId` like other handlers.

### Frontend

**`src/hooks/useTodos.ts`:**
- Add a `deleteTag` mutation invoking `todos-api` with `{ action: 'delete_tag', tag }`.
- `onSuccess`: invalidate the todos and archived queries so all chips/cards refresh. Localized error toast via existing `todos.error.*` pattern (add a new key).

**`src/hooks/useFilters.ts`:**
- Add a helper `removeTagFromSelection(tag)` that, if the deleted tag was selected, persists `selected_tags` without it (reuses existing `upsertFilters`).

**`src/components/FilterBar.tsx`:**
- Add new prop `onDeleteTag: (tag: string) => void`.
- In the tags popover, render each tag as a button with an inner `x` icon (`lucide-react` `X`). The outer container handles filter toggle; the inner `x` calls a handler that `stopPropagation`s and opens an `AlertDialog` (shadcn) with confirm/cancel.
- Hide the `x` while a deletion for that tag is pending (use `deletingTag` state) and show a small spinner.
- Localized labels: confirm title, body, confirm/cancel buttons, screen-reader label for the `x` button.

**`src/pages/Index.tsx`:**
- Wire `onDeleteTag={(tag) => deleteTag.mutate(tag, { onSuccess: () => { removeTagFromSelection(tag); toast(...); }})}`.
- Pass `deleteTag` from `useTodos`.

**`src/i18n/translations.ts`:**
- Add for all 4 locales:
  - `filter.deleteTag` (sr-only label "Delete tag {tag}")
  - `filter.deleteTagConfirmTitle`
  - `filter.deleteTagConfirmBody` (with `{tag}` placeholder)
  - `common.delete`, `common.cancel` (reuse if present, otherwise add)
  - `filter.tagDeleted` toast, `todos.error.deleteTag`

### Out of scope

- No bulk multi-tag delete UI.
- No "rename tag" feature.
- No new table — tags remain derived from `todos.tags`, so removing the tag from every todo automatically removes it from the popover (the `allTags` memo in `Index.tsx` recomputes after invalidation).

### Verification

- Manual: create a tag, attach to 2 active + 1 archived todo, delete via popover `x`, confirm dialog, verify chip disappears, all todos no longer show it, and a selected filter for it is cleared.
- Tests: extend `supabase/functions/todos-api/index.test.ts` with a `delete_tag` case (active + archived, untouched-other-tag, invalid tag input → 400).
- Run `bunx vitest run`.
