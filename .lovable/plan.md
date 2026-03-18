## Recurrent Tasks — IMPLEMENTED

### What was done

1. **Database migration**: Added `recurrence`, `next_recurrence_at`, `recurring_source_id` columns to `todos` table.

2. **Edge function `process-recurring-tasks`**: Cron handler that queries todos where `next_recurrence_at <= now()`, checks user feature access, clones the todo (text, category, tags, notes, urls, images), chains recurrence to the clone, and clears it from the source.

3. **pg_cron job**: Hourly schedule (`0 * * * *`) calling `process-recurring-tasks`.

4. **Frontend**:
   - `TodoDetailDialog.tsx` — Recurrence section with Daily/Weekly/Monthly toggles, gated by `useFeatureAccess('recurrence')`. Shows lock icon + upgrade message when feature is disabled.
   - `TodoCard.tsx` — Repeat icon shown when `todo.recurrence` is set.
   - `translations.ts` — Added recurrence keys in EN, ES, FR, DE.

### Files Created/Edited
- Migration: `recurrence`, `next_recurrence_at`, `recurring_source_id` on `todos`
- `supabase/functions/process-recurring-tasks/index.ts` (new)
- `src/components/TodoDetailDialog.tsx` (edited)
- `src/components/TodoCard.tsx` (edited)
- `src/i18n/translations.ts` (edited)
- `src/hooks/useTodos.ts` (edited — added new columns to optimistic temp todo)
- pg_cron schedule inserted via SQL
