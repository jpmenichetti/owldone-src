## Allow edits on completed/archived tasks

GitHub issue #20: Completed tasks get auto-archived and the detail dialog opens them in fully read-only mode, so users can't add context after marking a task done. They want to edit title, notes (description), URLs, and images without restoring the task first.

### Approach

Today `TodoDetailDialog` has a single `readOnly` prop that locks every field. It's set to `true` whenever a todo is opened from `ArchiveSection` (URL `?ro=1`). The edge function (`todos-api`) already accepts updates regardless of `removed` state, so the backend needs no change.

Introduce a softer mode for archived items: allow content edits (text, notes, urls, images, tags) while keeping structural actions disabled (category change, completion toggle, recurrence config, archive/delete from inside the dialog — restore stays the path back to active).

### Changes

**`src/components/TodoDetailDialog.tsx`**
- Replace the boolean `readOnly` with two effective flags derived from a new prop:
  - `readOnly` → kept as the prop name for API stability, but reinterpreted as "archived-editable" when the todo is archived.
  - Internally compute `contentLocked = false` (always editable for text/notes/urls/images/tags) and `structureLocked = readOnly` (used for recurrence section, category controls, completion toggle).
- Unlock these sections when `readOnly` is true:
  - Title input (line ~335 ternary: render the editable input instead of static text).
  - Notes textarea (`readOnly={readOnly}` → drop).
  - Tag add/remove controls (block around line ~381).
  - URL add/remove controls (block around line ~496).
  - Image upload + delete (blocks around lines ~463 and ~488; `SignedImage` `readOnly` prop dropped).
- Keep gated under `readOnly`:
  - `RecurrenceSection` (already returns null when `readOnly`).
  - Any category-change shortcut buttons at the bottom of the panel (the "Category Move Shortcut" memory) — they should remain hidden so archived items aren't reshuffled into active categories without an explicit restore.
- Add a small inline notice at the top of the dialog when the todo is archived, e.g. "Archived task — restore to change category or recurrence." Uses existing `t()` i18n keys (add new keys `detail.archivedEditableNotice` to `src/i18n/translations.ts` for all supported languages).

**`src/components/ArchiveSection.tsx`** — no behavioral change needed; it still calls `onOpen(todo)` which sets `ro=1`. The dialog now interprets that as "archived but editable content".

**`src/i18n/translations.ts`**
- Add `detail.archivedEditableNotice` translation for every supported locale.

### Out of scope

- No DB migration. Server already allows partial updates on archived rows.
- No change to the toggle behavior in `TodoCard` (completed → archived) — that flow stays as-is.
- No new permission to un-archive from the dialog (the existing Restore button in `ArchiveSection` is unchanged).

### Verification

- Manual: complete a task → open from Archive → edit title, notes, add a URL, upload + delete an image; confirm changes persist after reload. Confirm recurrence section and category shortcuts remain hidden.
- Run `bunx vitest run` for any affected snapshot/unit tests.
