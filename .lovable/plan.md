

## Recurrent Tasks Implementation Plan

### Database Migration

Add 3 columns to the `todos` table:

```sql
ALTER TABLE public.todos
  ADD COLUMN recurrence text DEFAULT NULL,
  ADD COLUMN next_recurrence_at timestamptz DEFAULT NULL,
  ADD COLUMN recurring_source_id uuid DEFAULT NULL;
```

No constraints — `recurrence` values are `'daily'`, `'weekly'`, `'monthly'`, or `null`.

### New Edge Function: `process-recurring-tasks`

- Unauthenticated cron endpoint (verify_jwt = false in config.toml)
- Queries all todos where `next_recurrence_at <= now()` (regardless of completed/removed status)
- For each match:
  - Checks user has `recurrence` feature enabled (query `user_features` where `enabled = true AND (expires_at IS NULL OR expires_at > now())`)
  - If not enabled: clears `recurrence` and `next_recurrence_at` on source, skips
  - If enabled: clones a new todo (text, category, tags, notes, urls), sets `recurring_source_id` to source id, copies `recurrence` and computes fresh `next_recurrence_at`, copies `todo_images` references
  - Clears `recurrence` and `next_recurrence_at` on the source (chain moves to the clone)

### pg_cron Job (via insert tool, not migration)

Hourly schedule calling `process-recurring-tasks` edge function.

### Frontend: TodoDetailDialog.tsx

After the URLs section and before "Move to", add a **Recurrence** section (only when `!readOnly`):

- Label: "Recurrence" (translated)
- Three toggle buttons: Daily / Weekly / Monthly
- Clicking the active one deactivates (sets `recurrence` and `next_recurrence_at` to null)
- Setting recurrence computes `next_recurrence_at` from `todo.created_at + interval` and calls `onUpdate`
- Gated behind `useFeatureAccess`: if `!hasFeature('recurrence')`, show a locked/upgrade prompt instead

### Frontend: TodoCard.tsx

Add a small `Repeat` icon (from lucide) next to the date when `todo.recurrence` is set.

### Translations (src/i18n/translations.ts)

Add keys in all 4 languages:
- `detail.recurrence` — "Recurrence"
- `detail.daily` — "Daily"  
- `detail.weekly` — "Weekly"
- `detail.monthly` — "Monthly"
- `detail.recurrenceLocked` — "Upgrade to enable recurring tasks"

### Config (supabase/config.toml)

Add entry:
```toml
[functions.process-recurring-tasks]
verify_jwt = false
```

### Files to Create/Edit

| File | Action |
|------|--------|
| Migration SQL | Add 3 columns to `todos` |
| `supabase/functions/process-recurring-tasks/index.ts` | New cron handler |
| `supabase/config.toml` | Add function entry |
| `src/components/TodoDetailDialog.tsx` | Recurrence UI + feature gate |
| `src/components/TodoCard.tsx` | Repeat icon |
| `src/i18n/translations.ts` | New translation keys |
| pg_cron insert SQL | Hourly schedule (via insert tool) |

